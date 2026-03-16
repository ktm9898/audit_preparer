const FOLDER_NAME = "Audit_Preparer_Files";

// --- 보안 설정 ---
const PROPS = PropertiesService.getScriptProperties();
const ACCESS_TOKEN = PROPS.getProperty('ACCESS_TOKEN') || "audit123"; // 기본값, 사용자가 속성에서 변경 가능

function checkAuth(e) {
  const token = (e && e.parameter && e.parameter.token) || (e && e.postData && JSON.parse(e.postData.contents).token);
  if (token !== ACCESS_TOKEN) {
    throw new Error("접근 권한이 없습니다. (올바른 인증 토큰이 필요합니다)");
  }
}

function getOrCreateFolder() {
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(FOLDER_NAME);
}

function getSubFolder(parent, name) {
  const folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    // 뉴스 수집 및 분석 요청은 인증 필요
    if (['fetchNews', 'runAnalysis'].includes(action)) {
      checkAuth(e);
    }

    if (action === 'getAllData') {
      const sheets = ss.getSheets().map(s => s.getName());
      return createResponse({
        personas: getTabData(ss, '의원별 관심사'),
        risks1: getTabData(ss, '리스크 추출1'),
        risks2: getTabData(ss, '리스크 추출2'),
        questions: getTabData(ss, '예상 질문'),
        news: getTabData(ss, '주요 뉴스'),
        news_count: Math.max(0, getTabRowCount(ss, '주요 뉴스') - 1),
        debug: { availableSheets: sheets }
      });
    }

    if (action === 'listFiles') {
      const type = e.parameter.type;
      const parent = getOrCreateFolder();
      const folder = getSubFolder(parent, type === 'report' ? 'reports' : 'minutes');
      const files = folder.getFiles();
      const result = [];
      while (files.hasNext()) {
        const f = files.next();
        result.push({ id: f.getId(), name: f.getName(), size: f.getSize(), date: Utilities.formatDate(f.getDateCreated(), "GMT+9", "yyyy-MM-dd HH:mm") });
      }
      return createResponse(result);
    }

    if (action === 'fetchNews') {
      const targetMonth = e.parameter.month; // e.g. "2024.03"
      return createResponse(fetchNewsFromNaver(targetMonth));
    }

    return createResponse({ error: 'Invalid GET action' });
  } catch (err) {
    return createResponse({ ok: false, error: err.message });
  }
}

function doPost(e) {
  try {
    checkAuth(e);
    let action = e.parameter.action;
    let data = e.parameter || {};
    
    if (e.postData && e.postData.contents) {
      try {
        const jsonData = JSON.parse(e.postData.contents);
        if (jsonData) {
          data = jsonData;
          if (data.action) action = data.action;
        }
      } catch(f) {}
    }

    if (action === 'uploadFile') {
      const parent = getOrCreateFolder();
      const subFolderName = data.type === 'report' ? 'reports' : 'minutes';
      const folder = getSubFolder(parent, subFolderName);
      const decoded = Utilities.base64Decode(data.base64);
      const blob = Utilities.newBlob(decoded, data.mimeType, data.filename);
      const file = folder.createFile(blob);
      return createResponse({ ok: true, id: file.getId(), name: file.getName() });
    }

    if (action === 'runAnalysis') {
      return createResponse(runAIAnalysis(data.task, data.fileId));
    }

    if (action === 'deleteFile') {
      DriveApp.getFileById(data.fileId).setTrashed(true);
      return createResponse({ ok: true });
    }

    return createResponse({ error: 'Invalid POST action' });
  } catch (err) {
    return createResponse({ ok: false, error: err.message });
  }
}

// --- 신뢰할 수 있는 매체 리스트 ---
const TRUSTED_DOMAINS = [
  'chosun.com', 'joongang.co.kr', 'donga.com', 'hani.co.kr', 'khan.co.kr', 
  'seoul.co.kr', 'segye.com', 'hankookilbo.com', 'kmib.co.kr', 'munhwa.com',
  'yna.co.kr', 'newsis.com', 'news1.kr',
  'kbs.co.kr', 'mbc.co.kr', 'sbs.co.kr', 'jtbc.co.kr', 'ytn.co.kr', 'mbn.co.kr', 'tvchosun.com', 'ichannela.com',
  'hankyung.com', 'mk.co.kr', 'mt.co.kr', 'edaily.co.kr', 'sedaily.com', 'fnnews.com', 'heraldcorp.com', 'asiae.co.kr', 'ajunews.com',
  'etnews.com', 'digitaltimes.co.kr', 'dt.co.kr', 'nocutnews.co.kr', 'ohmynews.com', 'pressian.com', 'vop.co.kr',
  'kukinews.com', 'newdaily.co.kr', 'dailian.co.kr', 'sisain.co.kr', 'dnews.co.kr', 'bizwatch.co.kr',
  'naver.com'
];

function isTrustedMedia(url) {
  if (!url) return false;
  try {
    const domain = url.split('/')[2].replace('www.', '').replace('m.', '');
    return TRUSTED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
  } catch (e) { return false; }
}

function getGeminiModel() {
  return "gemini-3-flash-preview"; 
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").replace(/\s/g, "");
}

// --- 핵심 로직: 네이버 뉴스 수집 ---
function fetchNewsFromNaver(targetMonth) {
  const CLIENT_ID = PROPS.getProperty('NAVER_CLIENT_ID');
  const CLIENT_SECRET = PROPS.getProperty('NAVER_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return { ok: false, error: "네이버 API 설정이 필요합니다." };

  const baseQuery = "서울신용보증재단";
  const allItems = [];
  const apiHeaders = { "X-Naver-Client-Id": CLIENT_ID, "X-Naver-Client-Secret": CLIENT_SECRET };

  // 1. 기간 설정 및 심층 수집 (Paging 적용)
  if (targetMonth) {
    console.log(`[심층 수집 시작] 대상 연월: ${targetMonth}`);
    const displayCount = 100; // 한 번에 가져올 최대 개수
    let stopSearch = false;

    // 최대 1,000건까지 페이지를 넘기며 탐색
    for (let start = 1; start <= 1000; start += displayCount) {
      if (stopSearch) break;

      const query = `${baseQuery} ${targetMonth}`;
      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=${displayCount}&start=${start}&sort=sim`;
      try {
        const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
        // 디버깅을 위한 상세 로그 기록
        console.log(`[네이버 응답] URL: ${url}, Code: ${response.getResponseCode()}`);
        if (response.getResponseCode() === 200) {
          const data = JSON.parse(response.getContentText());
          if (!data.items || data.items.length === 0) break;

          console.log(`[페이지 ${start}~] ${data.items.length}건 수신...`);

          for (const item of data.items) {
            const pubDate = new Date(item.pubDate);
            const itemYM = Utilities.formatDate(pubDate, "GMT+9", "yyyy.MM");

            if (itemYM === targetMonth) {
              allItems.push(item);
            }
          }
        } else {
          console.error(`Naver API 페이지 호출 실패 (Code: ${response.getResponseCode()})`);
          break;
        }
      } catch (e) {
        console.error(`Fetch API Error: ${e.message}`);
        break;
      }
    }
    console.log(`[수집 완료] 대상 월(${targetMonth}) 후보 기사 ${allItems.length}건 확보 (필터링 전)`);
  } else {
    // 월 지정이 없으면 전체 흐름 (최근 12개월 루프)
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const yearMonth = Utilities.formatDate(targetDate, "GMT+9", "yyyy.MM");
      const query = `${baseQuery} ${yearMonth}`;
      try {
        const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=50&start=1&sort=sim`;
        const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
        if (response.getResponseCode() === 200) {
          const data = JSON.parse(response.getContentText());
          if (data.items) allItems.push(...data.items);
        }
      } catch (e) {}
    }
  }

  if (allItems.length === 0) {
    const errorMsg = targetMonth ? `${targetMonth}월에 해당하는 뉴스가 네이버 검색 결과에 없습니다.` : "뉴스를 가져오지 못했습니다. 네이버 API 응답을 확인하세요.";
    return { ok: false, error: errorMsg };
  }

  // 2. 데이터 정제 및 후보군 확보 (시트 대조 생략 - AI가 직접 중복 제거 수행)
  const processedItems = [];
  
  allItems.forEach(item => {
    // [핵심] 네이버 뉴스(news.naver.com) 인링크 우선 채택 (크롤링 성공률 100% 보장용)
    const link = item.link && item.link.includes('news.naver.com') ? item.link : (item.originallink || item.link);
    const title = item.title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    
    if (isTrustedMedia(link)) {
      const date = new Date(item.pubDate);
      const dateStr = Utilities.formatDate(date, "GMT+9", "yyyy.MM.dd");
      
      let sourceName = "뉴스";
      try {
        // [안내] 실제 수집 및 저장용 링크(link)는 네이버 인링크를 유지하여 크롤링 안정성을 확보합니다.
        // 다만 언론사 명칭(sourceName)을 정확히 찾기 위해서만 원본 링크(originallink)를 도메인 판별용으로 참조합니다.
        const sourceUrl = item.originallink || link;
        const domain = sourceUrl.split('/')[2].replace('www.', '').replace('m.', '');
        const domainMap = { 
          'chosun': '조선일보', 'joongang': '중앙일보', 'donga': '동아일보', 'yna': '연합뉴스', 
          'newsis': '뉴시스', 'news1': '뉴스1', 'sedaily': '서울경제', 'edaily': '이데일리', 
          'hankyung': '한국경제', 'mk.co.kr': '매일경제', 'hani': '한겨레', 'khan': '경향신문', 
          'kmib': '국민일보', 'segye': '세계일보', 'seoul.co.kr': '서울신문', 'munhwa': '문화일보', 
          'moneytoday': '머니투데이', 'mt.co.kr': '머니투데이', 'asiae': '아시아경제', 'ajunews': '아주경제',
          'fnnews': '파이낸셜뉴스', 'heraldcorp': '헤럴드경제', 'etnews': '전자신문', 'digitaltimes': '디지털타임스', 'dt.co.kr': '디지털타임스',
          'kbs': 'KBS', 'mbc': 'MBC', 'sbs': 'SBS', 'ytn': 'YTN', 'jtbc': 'JTBC', 'mbn': 'MBN', 'tvchosun': 'TV조선', 'ichannela': '채널A',
          'hankookilbo': '한국일보', 'nocutnews': '노컷뉴스', 'ohmynews': '오마이뉴스', 'pressian': '프레시안', 'vop': '민중의소리',
          'kukinews': '쿠키뉴스', 'newdaily': '뉴데일리', 'dailian': '데일리안', 'sisain': '시사인', 'dnews': '대한경제', 'bizwatch': '비즈워치'
        };
        for (const keyInMap in domainMap) {
          if (domain.includes(keyInMap)) { sourceName = domainMap[keyInMap]; break; }
        }
      } catch(e) {}

      processedItems.push({ 
        ...item, 
        cleanTitle: title, 
        cleanLink: link, 
        sourceName, 
        dateStr, 
        pubTimestamp: date.getTime() 
      });
    }
  });

  if (processedItems.length === 0) return { ok: true, count: 0, message: "수집된 뉴스가 없습니다." };

  // 3. AI 지능형 선별 (AI Call 1: Screening & Dedup)
  // 1,000건의 후보를 AI에게 전달하여 중복을 제거하고 정예 15건을 선발
  const initialNewsList = processedItems.map(item => ({
    date: item.dateStr,
    category: "-", 
    source: item.sourceName || "뉴스",
    title: item.cleanTitle,
    naverDesc: item.description.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').trim(),
    fullText: "", 
    link: item.cleanLink,
    aiSummary: "", 
    importance: "-", 
    pubTimestamp: item.pubTimestamp
  }));

  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  
  // [Stage 1] 스크리닝: 대량 후보군에서 15건 선별
  console.log(`[스크리닝 시작] 총 ${initialNewsList.length}건 후보를 Gemini에게 전달합니다...`);
  let screenedNews = screenImportanceWithAI(initialNewsList, API_KEY);
  
  if (!screenedNews || screenedNews.length === 0) {
    console.warn("[경고] AI 스크리닝 결과가 비어 있습니다. 기본 15건으로 강제 진행합니다.");
    screenedNews = initialNewsList.slice(0, 15);
  }

  // 중요도 가중치 설정
  const importanceWeight = { '상': 3, '중': 2, '하': 1, '-': 0 };
  const finalTop15 = screenedNews
    .sort((a, b) => {
      const wA = importanceWeight[a.importance] || 0;
      const wB = importanceWeight[b.importance] || 0;
      if (wA !== wB) return wB - wA;
      return b.pubTimestamp - a.pubTimestamp;
    })
    .slice(0, 15);

  // 3. 본문 수집 및 분석 (AI 호출 최소화 전략)
  // (1) 병렬 크롤링 (코드 기반 추출로 AI 호출 0회)
  console.log(`[크롤링] ${finalTop15.length}건 기사 본문을 코드로 추출합니다...`);
  const crawledNews = crawlNewsParallel(finalTop15);
  
  // (2) 배치 심층 분석 (단 1회의 AI 호출로 15건 동시 처리)
  console.log(`[분석] Gemini를 통해 15건의 기사를 일괄 요약/분석합니다...`);
  const resultNews = deepAnalyzeNewsBatch(crawledNews, API_KEY);

  // (3) 시트 데이터 일괄 저장 (Bulk Insert)
  if (resultNews.length > 0) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, '주요 뉴스');
    const rows = resultNews.map(n => [
      n.date, 
      n.category || "-", 
      n.source || "뉴스", 
      n.title, 
      n.naverDesc, 
      n.fullText || "", 
      n.link, 
      n.aiSummary || n.naverDesc,
      n.importance || "-"
    ]);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
    console.log(`[완료] 총 ${resultNews.length}건 저장 완료.`);
  }

  return { ok: true, count: resultNews.length };
}

// --- 불필요한 보정 로직 삭제 (사용자 요청 반영) ---

function cleanTextForAI(text) {
  if (!text) return "";
  return text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s가-힣ㄱ-ㅎㅏ-ㅣ.,!?"']/g, ' ') // 특수문자 제거로 UTF-8 오류 방지
    .trim()
    .substring(0, 30000);
}

// --- 3단계: 병렬 크롤링 엔진 ---
function crawlNewsParallel(newsList) {
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  
  const requests = newsList.map(item => ({
    url: item.link,
    method: "GET",
    muteHttpExceptions: true,
    headers: { "User-Agent": userAgent },
    followRedirects: true
  }));

  console.log(`${requests.length}개 링크 동시 연결 중...`);
  const responses = UrlFetchApp.fetchAll(requests);

  return newsList.map((item, i) => {
    try {
      const resp = responses[i];
      if (resp.getResponseCode() === 200) {
        let html = resp.getContentText();
        // [변경] AI 호출 대신 Regex로 본문 정적 추출
        const extracted = extractTextByCode(html);
        if (extracted && extracted.length > 100) {
          item.fullText = extracted;
        } else {
          item.fullText = item.naverDesc; // 추출 실패 시 네이버 요약 활용
        }
      }
    } catch (e) {
      console.warn(`수집 실패: ${item.title}`);
      item.fullText = item.naverDesc;
    }
    return item;
  });
}

// --- 1단계: AI 뉴스 스크리닝 (제목/요약 기반) ---
function screenImportanceWithAI(newsList, apiKey) {
  if (!apiKey || newsList.length === 0) return newsList;

  const newsDataForAI = newsList.map((n, i) => `[${i}] 제목: ${n.title}\n요약: ${n.naverDesc}`).join('\n---\n');
  const prompt = `당신은 대한민국 최고의 뉴스 큐레이션 전문가입니다.
제공된 뉴스 후보군(${newsList.length}건)에서 가장 가치 있는 15건을 선발하세요.

[지시사항]
1. 중복 제거 (핵심): 동일하거나 매우 유사한 사건/이슈를 다루는 기사가 여러 개라면, 가장 포괄적인 1개만 살리고 나머지는 모두 중요도를 '하'로 매기세요. (사용자가 겹치는 뉴스를 보지 않게 하는 것이 최우선입니다.)
2. 중요도 판별: 재단 관련 정책, 소상공인 지원, 경제 지표, 의회 행정감사 관련 기사를 '상', '중', '하'로 판별하세요.
3. 분야 분류: 각 뉴스를 '정책', '지원', '경제', '금융', '의회', '기타' 중 하나로 분류하세요.
4. 가용성 보장 (핵심): 만약 '상'이나 '중' 등급의 기사가 부족하더라도, 후보군 중 상대적으로 나은 기사들을 골라 **반드시 총 15개의 기사 인덱스를 응답**하세요. 절대로 15개 미만으로 응답하지 마세요.

[응답 형식]
반드시 JSON 형식으로만 답변하세요:
{
  "top15": [
    {"index": 0, "importance": "상", "category": "정책"},
    ...
  ]
}

[뉴스 후보 리스트]
${newsDataForAI.substring(0, 500000)}`; // [수정] 5만자 -> 50만자로 확장하여 1,000건 전수조사 실현

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${apiKey}`;
    const resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }),
      muteHttpExceptions: true
    });
    
    if (resp.getResponseCode() === 200) {
      const resJson = JSON.parse(resp.getContentText());
      let feedback = resJson.candidates[0].content.parts[0].text.trim();
      
      if (feedback.startsWith('```')) {
        feedback = feedback.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const jsonStart = feedback.indexOf('{');
      const jsonEnd = feedback.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd !== -1) {
        feedback = feedback.substring(jsonStart, jsonEnd);
      }
      
      const parsed = JSON.parse(feedback);
      const final15 = [];
      parsed.top15.forEach(item => {
        if (newsList[item.index]) {
          const newsItem = newsList[item.index];
          newsItem.importance = item.importance || "하";
          newsItem.category = item.category || "기타";
          final15.push(newsItem);
        }
      });
      return final15;
    }
  } catch (e) { console.error("Screening AI Error:", e.message); }
  return newsList.slice(0, 15);
}

// --- 3단계: AI 전문 정밀 분석 (본문 기반) ---
// --- 4단계: AI 배치 정밀 분석 (단 1회 호출로 15건 처리) ---
function deepAnalyzeNewsBatch(newsList, apiKey) {
  if (!apiKey || newsList.length === 0) return newsList;

  // 15개 기사의 본문을 하나의 컨텍스트로 결합
  const batchData = newsList.map((n, i) => {
    const text = (n.fullText && n.fullText.length > 100) ? n.fullText.substring(0, 4000) : n.naverDesc;
    return `[기사 #${i}]\n제목: ${n.title}\n본문: ${text}`;
  }).join('\n===\n');

  const prompt = `당신은 대한민국 최고의 뉴스 분석관입니다.
제공된 15개의 뉴스 기사를 정밀 분석하여 결과를 반환하세요.

[지시사항]
1. 각 기사의 내용을 2~3문장으로 핵심 요약하세요.
2. 기사의 최종 중요도(상/중/하)와 분야(정책/지원/경제/금융/의회/기타)를 확정하세요.
3. 기사 번호(#0, #1...)와 결과가 정확히 매칭되어야 합니다.

[응답 형식]
반드시 아래 JSON 형식으로만 답변하세요:
{
  "analyses": [
    {"index": 0, "summary": "...", "importance": "상", "category": "정책"},
    ...
  ]
}

[기사 데이터]
${batchData}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${apiKey}`;
    const resp = UrlFetchApp.fetch(url, {
      method: 'POST',
      contentType: 'application/json',
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { response_mime_type: "application/json" } }),
      muteHttpExceptions: true
    });
    
    if (resp.getResponseCode() === 200) {
      const resJson = JSON.parse(resp.getContentText());
      let feedback = resJson.candidates[0].content.parts[0].text.trim();
      
      if (feedback.startsWith('```')) {
        feedback = feedback.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const jsonStart = feedback.indexOf('{');
      const jsonEnd = feedback.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd !== -1) {
        feedback = feedback.substring(jsonStart, jsonEnd);
      }
      
      const parsed = JSON.parse(feedback);
      parsed.analyses.forEach(res => {
        if (newsList[res.index]) {
          const item = newsList[res.index];
          item.aiSummary = res.summary || item.naverDesc;
          item.importance = res.importance || item.importance;
          item.category = res.category || item.category;
        }
      });
    }
  } catch (e) {
    console.error("Batch Analysis Error:", e.message);
  }
  return newsList;
}

// 기존 deepAnalyzeNewsWithAI 삭제 (배치로 대체됨)

/**
 * [신규] 네이버 뉴스 전용 코드 기반 본문 추출기 (AI 호출 없음)
 */
function extractTextByCode(html) {
  if (!html) return "";
  
  try {
    // 1. 뉴스 본문 영역 매칭 (네이버 뉴스의 대표적 본문 ID들)
    const patterns = [
      /<div id="dic_area".*?>([\s\S]*?)<\/div>/i,        // 최신 네이버 뉴스
      /<div id="articleBodyContents".*?>([\s\S]*?)<\/div>/i, // 구형 네이버 뉴스
      /<article.*?>([\s\S]*?)<\/article>/i,              // 일반적인 article 태그
      /<div class="article_body".*?>([\s\S]*?)<\/div>/i   // 기타
    ];

    let content = "";
    for (const p of patterns) {
      const match = html.match(p);
      if (match && match[1]) {
        content = match[1];
        break;
      }
    }

    if (!content) return "";

    // 2. 불필요한 태그 및 요소 정제
    content = content
      .replace(/<(script|style|nav|header|footer|iframe|svg|aside|button)[^>]*>([\s\S]*?)<\/\1>/gi, '') // UI 요소 제거
      .replace(/<br\s*\/?>/gi, '\n') // 줄바꿈 보존
      .replace(/<[^>]+>/g, ' ')      // 모든 HTML 태그 제거
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')          // 연속 공백 제거
      .trim();

    // 3. 기사 끝부분 주석 및 광고성 문구 제거 (기본적 처리)
    content = content.split('▶')[0].split('ⓒ')[0].split('무단 전재')[0];

    return content;
  } catch (e) {
    console.error("추출 코드 오류:", e.message);
    return "";
  }
}
function runAIAnalysis(task, fileId) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parent = getOrCreateFolder();
  let aggregatedText = "";
  const contents = { parts: [] };
  let prompt = "";

  if (task === 'risks') {
    const newsSheet = getOrCreateSheet(ss, '주요 뉴스');
    const newsData = newsSheet.getDataRange().getValues().slice(1).map(r => `[${r[0]}] ${r[2]}: ${r[3]}`).join("\n");
    prompt = `[미션] 서울신용보증재단 뉴스 데이터를 바탕으로 행정감사 리스크 쟁점 20개를 도출하세요. 
(JSON 형식: {"risks": [{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}]})

데이터:
${newsData}`;
  } else if (task === 'report_risks') {
    const folder = getSubFolder(parent, 'reports');
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const blob = f.getBlob();
      if (blob.getContentType() === "application/pdf") {
        contents.parts.push({ inlineData: { data: Utilities.base64Encode(blob.getBytes()), mimeType: "application/pdf" } });
        aggregatedText += `\n[문서] ${f.getName()} (PDF 원본)`;
      } else {
        const txt = blob.getDataAsString();
        contents.parts.push({ text: `\n[문서] ${f.getName()}\n${txt}\n` });
        aggregatedText += txt;
      }
    }
    if (contents.parts.length === 0) return { ok: false, error: "분석할 업무보고 자료가 없습니다." };
    prompt = `[미션] 업로드된 업무보고 자료를 분석하여 행정감사 리스크 쟁점 20개를 도출하세요.
(JSON 형식: {"risks": [{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}]})

[데이터 원본]
${aggregatedText}`;
  } else if (task === 'final_questions') {
    const risk1 = getTabData(ss, '리스크 추출1').map(r => `- ${r['리스크 요인']}: ${r['세부 내용']}`).join("\n");
    const risk2 = getTabData(ss, '리스크 추출2').map(r => `- ${r['리스크 요인']}: ${r['세부 내용']}`).join("\n");
    const personas = getTabData(ss, '의원별 관심사').map(p => `- ${p['의원명']}(${p['지역구']}): 관심사[${p['주요 관심사']}], 성향[${p['질문 성향']}]`).join("\n");
    const newsData = getTabData(ss, '주요 뉴스').slice(0, 20).map(n => `[뉴스] ${n['제목']}\n- 요약: ${n['AI요약']}`).join("\n\n");

    const reportsFolder = getSubFolder(parent, 'reports');
    const rFiles = reportsFolder.getFiles();
    let sourceTexts = "";
    while (rFiles.hasNext()) {
      const f = rFiles.next();
      const blob = f.getBlob();
      if (blob.getContentType() === "application/pdf") {
        contents.parts.push({ inlineData: { data: Utilities.base64Encode(blob.getBytes()), mimeType: "application/pdf" } });
        sourceTexts += `\n[업무보고 원문] ${f.getName()} (PDF)`;
      } else {
        const txt = blob.getDataAsString();
        contents.parts.push({ text: `\n[업무보고 원문] ${f.getName()}\n${txt}\n` });
        sourceTexts += txt;
      }
    }

    prompt = `[미션] 리스크 요인(Step 1,2), 의원 성향, 그리고 '보고서/뉴스 원문'을 종합하여 최종 행정감사 예상 질문 30개를 생성하세요.

[핵심 지침]
1. 원문 맥락 철저 분석: 추출된 리스크(Step 1,2)를 최우선 고려하되, 실제 질문은 반드시 함께 제공된 '뉴스 원문'과 '업무보고 원문'의 구체적인 수치, 사업명, 문제 사례를 바탕으로 해야 합니다.
2. 과거 질문 반복 절대 금지: 의원 성향 데이터에 있는 과거 발언은 '스타일 파악용'입니다. 기존 질문을 재탕하지 마십시오.
3. 융합적 분석: "의원 페르소나 + 구체적 사안(Source Context) + 현재의 이슈(News)"를 결합하세요.
4. 실무적 예리함: 구체적인 데이터나 페이지, 사업명을 인용하여 날카로운 질문을 설계하세요.

[데이터]
1. 뉴스 원문(요약): ${newsData}
2. 추출 리스크: (Step 1) ${risk1} / (Step 2) ${risk2}
3. 의원 성향 메타데이터: ${personas}
4. 업무보고 자료 원문 (Context): ${sourceTexts}

(JSON 형식: {"questions": [{"분류": "...", "의원명": "...", "질문": "...", "답변 가이드": "..."}]})`;
    aggregatedText = sourceTexts; // For logging
  } else if (task === 'persona') {
    const folder = getSubFolder(parent, 'minutes');
    const files = folder.getFiles();
    while (files.hasNext()) {
      const f = files.next();
      const blob = f.getBlob();
      if (blob.getContentType() === "application/pdf") {
        contents.parts.push({ inlineData: { data: Utilities.base64Encode(blob.getBytes()), mimeType: "application/pdf" } });
        aggregatedText += `\n[회의록] ${f.getName()} (PDF)`;
      } else {
        const txt = blob.getDataAsString();
        contents.parts.push({ text: `\n[회의록] ${f.getName()}\n${txt}\n` });
        aggregatedText += txt;
      }
    }
    if (contents.parts.length === 0) return { ok: false, error: "분석할 회의록 파일이 없습니다." };
    prompt = `당신은 행정사무감사 전문 분석 AI입니다. 의원별 상세 성향 리포트를 작성하세요.
(JSON 형식: {"personas": [{"의원명": "...", "지역구": "...", "주요 관심사": "...", "질문 성향": "...", "예상 감사 포인트": "...", "발언요약": "..."}]})

[데이터 원본]
${aggregatedText}`;
  }

  // [디버그 로그]
  try {
    const debugSheet = getOrCreateSheet(ss, 'Debug_Log');
    debugSheet.clearContents().appendRow(['시간', '추출된 텍스트 샘플(5000자)']);
    const textToLog = String(aggregatedText || "추출된 텍스트가 없거나 멀티모달 파일만 전송됨.");
    const sampleText = textToLog.length > 5000 
      ? textToLog.substring(0, 2500) + "\n\n... (중략) ...\n\n" + textToLog.substring(textToLog.length - 2500)
      : textToLog;
    debugSheet.appendRow([new Date(), sampleText]);
  } catch(e) {}

  // 3. API 호출
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;
    
    // 시스템 지침과 사용자 미션을 통합하여 메시지 구성
    const userMessage = {
      role: "user",
      parts: [
        { text: prompt },
        ...contents.parts
      ]
    };

    const response = UrlFetchApp.fetch(url, { 
      method: "POST", 
      contentType: "application/json", 
      payload: JSON.stringify({ 
        contents: [userMessage], 
        generationConfig: { 
          response_mime_type: "application/json",
          temperature: 0.1, 
          max_output_tokens: 8192 
        } 
      }) 
    });
    
    const respObj = JSON.parse(response.getContentText());
    let rawText = respObj.candidates[0].content.parts[0].text;
    
    // JSON 추출 안정화 (더욱 강력하게)
    let cleanJson = rawText.trim();
    // 마크다운 블록 제거
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const jsonStart = cleanJson.indexOf('{');
    const jsonEnd = cleanJson.lastIndexOf('}') + 1;
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanJson = cleanJson.substring(jsonStart, jsonEnd);
    }
    
    const result = JSON.parse(cleanJson);
    const now = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");
    
    // 4. 시트 기록
    if (task === 'risks') {
      const sheet = getOrCreateSheet(ss, '리스크 추출1');
      sheet.clearContents().appendRow(['리스크 요인', '세부 내용', '관련 근거', '마지막 업데이트']);
      const risks = result.risks || result.data || [];
      risks.forEach(r => sheet.appendRow([r['리스크 요인'] || r['요인'], r['세부 내용'] || r['내용'], r['관련 근거'] || r['근거'], now]));
    } else if (task === 'report_risks') {
      const sheet = getOrCreateSheet(ss, '리스크 추출2');
      sheet.clearContents().appendRow(['리스크 요인', '세부 내용', '관련 근거', '마지막 업데이트']);
      const risks = result.risks || result.data || [];
      risks.forEach(r => sheet.appendRow([r['리스크 요인'] || r['요인'], r['세부 내용'] || r['내용'], r['관련 근거'] || r['근거'], now]));
    } else if (task === 'final_questions' || task === 'questions') {
      const sheet = getOrCreateSheet(ss, '예상 질문');
      sheet.clearContents().appendRow(['분류', '의원명', '질문', '답변 가이드', '마지막 업데이트']);
      const questions = result.questions || result.data || [];
      questions.forEach(q => sheet.appendRow([q['분류'], q['의원명'], q['질문'] || q['예상 질문'], q['답변 가이드'] || q['답변'], now]));
    } else if (task === 'persona') {
      const sheet = getOrCreateSheet(ss, '의원별 관심사');
      sheet.clearContents().appendRow(['의원명', '지역구', '주요 관심사', '발언 요약', '질문 성향', '예상 감사 포인트', '마지막 업데이트']);
      const personas = result.personas || result.data || [];
      personas.forEach(p => {
        sheet.appendRow([
          p['의원명'] || p['이름'], 
          p['지역구'] || p['소속'] || "", 
          p['주요 관심사'] || p['관심사'] || "", 
          p['발언요약'] || p['요약'] || "",
          p['질문 성향'] || p['질문 스타일'] || p['성향'] || p['스타일'] || "", 
          p['예상 감사 포인트'] || p['공격 포인트'] || p['포인트'] || "", 
          now
        ]);
      });
    } else if (task === 'questions') {
      const sheet = getOrCreateSheet(ss, '예상 질문');
      sheet.clearContents().appendRow(['분류', '의원명', '질문', '답변 가이드', '마지막 업데이트']);
      const questions = result.questions || result.data || [];
      questions.forEach(q => sheet.appendRow([q['분류'], q['의원명'], q['질문'], q['답변 가이드'] || q['답변'], now]));
    }
    
    const count = (result.risks || result.personas || result.questions || []).length;
    return { ok: true, count: count };
  } catch (e) {
    console.error("분석 상세 오류:", e);
    return { ok: false, error: "AI 분석 도중 문제가 발생했습니다: " + e.message };
  }
}

// --- PDF 추출 로직 제거 (Gemini 네이티브 분석으로 대체) ---
// 이제 PDF를 직접 전송하므로 별도의 OCR 함수가 필요하지 않습니다.

function getOrCreateSheet(ss, name) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  return sheet;
}

function getTabData(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).filter(row => row[0]).map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (val instanceof Date) val = Utilities.formatDate(val, "GMT+9", "yyyy-MM-dd HH:mm");
      obj[h] = val;
    });
    return obj;
  });
}

function getTabRowCount(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  return sheet ? sheet.getLastRow() : 0;
}

function createResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
