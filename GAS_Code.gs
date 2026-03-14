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
        risks: getTabData(ss, '리스크 요인'),
        questions: getTabData(ss, '예상 질문'),
        news: getTabData(ss, '최근 뉴스'),
        news_count: Math.max(0, getTabRowCount(ss, '최근 뉴스') - 1),
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

      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(baseQuery)}&display=${displayCount}&start=${start}&sort=date`;
      try {
        const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
        if (response.getResponseCode() === 200) {
          const data = JSON.parse(response.getContentText());
          if (!data.items || data.items.length === 0) break;

          console.log(`[페이지 ${start}~] ${data.items.length}건 수신...`);

          for (const item of data.items) {
            const pubDate = new Date(item.pubDate);
            const itemYM = Utilities.formatDate(pubDate, "GMT+9", "yyyy.MM");

            if (itemYM === targetMonth) {
              allItems.push(item);
            } else if (itemYM < targetMonth) {
              // 검색 결과가 대상 월보다 과거로 넘어감 -> 탐색 중단
              console.log(`[중단] 과거 데이터 발견 (${itemYM} < ${targetMonth}). 루프를 종료합니다.`);
              stopSearch = true;
              break;
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
    console.log(`[수집 완료] 총 후보 기사 ${allItems.length}건 확보 (필터링 전)`);
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

  if (allItems.length === 0) return { ok: false, error: "뉴스를 가져오지 못했습니다." };

  // 2. 데이터 정제 및 후보군 확보 (시트 대조 생략 - AI가 직접 중복 제거 수행)
  const processedItems = [];
  
  allItems.forEach(item => {
    // [핵심] 네이버 뉴스(news.naver.com) 인링크 우선 채택 (크롤링 성공률 100% 보장용)
    const link = item.link && item.link.includes('news.naver.com') ? item.link : (item.originallink || item.link);
    const title = item.title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    
    if (isTrustedMedia(link)) {
      const date = new Date(item.pubDate);
      const monthStr = Utilities.formatDate(date, "GMT+9", "yyyy.MM");
      
      let sourceName = "뉴스";
      try {
        const domain = link.split('/')[2].replace('www.', '').replace('m.', '');
        const domainMap = { 
          'chosun': '조선일보', 'joongang': '중앙일보', 'donga': '동아일보', 'yna': '연합뉴스', 
          'newsis': '뉴시스', 'news1': '뉴스1', 'sedaily': '서울경제', 'edaily': '이데일리', 
          'hankyung': '한국경제', 'mk.co.kr': '매일경제', 'hani': '한겨레', 'khan': '경향신문', 
          'kmib': '국민일보', 'segye': '세계일보', 'seoul.co.kr': '서울신문', 'munhwa': '문화일보', 
          'moneytoday': '머니투데이', 'mt.co.kr': '머니투데이', 'asiae': '아시아경제', 'ajunews': '아주경제',
          'fnnews': '파이낸셜뉴스', 'heraldcorp': '헤럴드경제', 'etnews': '전자신문', 'digitaltimes': '디지털타임스',
          'kbs': 'KBS', 'mbc': 'MBC', 'sbs': 'SBS', 'ytn': 'YTN', 'naver': '네이버뉴스'
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
        monthStr, 
        pubTimestamp: date.getTime() 
      });
    }
  });

  if (processedItems.length === 0) return { ok: true, count: 0, message: "수집된 뉴스가 없습니다." };

  // 3. AI 지능형 선별 (AI Call 1: Screening & Dedup)
  // 1,000건의 후보를 AI에게 전달하여 중복을 제거하고 정예 15건을 선발
  const initialNewsList = processedItems.map(item => ({
    date: item.monthStr,
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

  // [Stage 2, 3, 4] 고성능 병렬/배치 처리 (정면 돌파)
  console.log(`[시작] ${finalTop15.length}건 병렬 크롤링 및 배치 분석 개시...`);
  
  // (1) 병렬 크롤링 (fetchAll 사용)
  const crawledNews = crawlNewsParallel(finalTop15);
  
  // (2) 배치 전용 심층 분석 (단 1회의 AI 호출)
  const resultNews = deepAnalyzeNewsBatch(crawledNews, API_KEY);

  // (3) 시트 데이터 일괄 저장 (Bulk Insert)
  if (resultNews.length > 0) {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = getOrCreateSheet(ss, '최근 뉴스');
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
    console.log(`[완료] 총 ${resultNews.length}건이 성공적으로 저장되었습니다.`);
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
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
  
  // 1. 요청 배열 생성
  const requests = newsList.map(item => ({
    url: item.link,
    method: "GET",
    muteHttpExceptions: true,
    headers: { "User-Agent": userAgent },
    followRedirects: true
  }));

  // 2. [핵심] 병렬 실행 (fetchAll)
  console.log(`${requests.length}개 링크 동시 크롤링 중...`);
  const responses = UrlFetchApp.fetchAll(requests);

  // 3. 결과 매핑 및 AI 본문 추출
  return newsList.map((item, i) => {
    try {
      const resp = responses[i];
      if (resp.getResponseCode() === 200) {
        let html = resp.getContentText();
        html = html.replace(/<(script|style|nav|header|footer|iframe|svg|aside)[^>]*>([\s\S]*?)<\/\1>/gi, '');
        const extracted = extractTextWithAI(html, API_KEY, item.title, item.link);
        if (extracted) {
          item.fullText = extracted;
        }
      }
    } catch (e) {
      console.warn(`크롤링 실패: ${item.title}`);
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

function extractTextWithAI(textContext, apiKey, title, url) {
  if (!apiKey || !textContext) return null;
  // 정제된 텍스트에서 본문 추출 (페이로드 확보 위해 최대 40,000자)
  const slicedContext = textContext.length > 40000 ? textContext.substring(0, 40000) : textContext;
  const prompt = `뉴스 제목: ${title}\nURL: ${url}\n\n[지시사항]\n제공된 텍스트 데이터에서 기사의 "핵심 본문 전문"만 추출하세요.\n광고, 메뉴, 관련뉴스 목록 등 불필요한 정보는 모두 배제하고 기사 내용만 깨끗하게 응답하세요.\n만약 본문이 없다면 기사의 핵심 내용을 300자 내외로 요약해서 응답하세요.\n\n[데이터]\n${slicedContext}`;

  try {
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const resp = UrlFetchApp.fetch(apiURL, { 
      method: "POST", 
      contentType: "application/json", 
      payload: JSON.stringify(payload), 
      muteHttpExceptions: true 
    });
    
    if (resp.getResponseCode() === 200) {
      const content = JSON.parse(resp.getContentText());
      if (content.candidates && content.candidates[0].content && content.candidates[0].content.parts) {
        const extracted = content.candidates[0].content.parts[0].text.trim();
        if (extracted.length > 20) return extracted;
      }
    }
    return null;
  } catch (e) { 
    console.error(`추출 AI 오류: ${e.message}`);
    return null; 
  }
}

// --- 레거시 필터링 함수 삭제 ---

// --- 전수 조사 분석 엔진 (OCR 지원) ---
function runAIAnalysis(task, fileId) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parent = getOrCreateFolder();
  let aggregatedText = "";
  const contents = { parts: [] };

  if (task === 'risks') {
    const newsSheet = getOrCreateSheet(ss, '최근 뉴스');
    const context = newsSheet.getDataRange().getValues().slice(1).map(r => `[${r[0]}] ${r[2]}: ${r[3]}`).join("\n");
    var prompt = `[지시사항] 반드시 제공된 뉴스 데이터에 기반하여 리스크를 도출하세요. 없는 사실을 지어내지 마세요.
[미션] 서울신용보증재단 뉴스 데이터를 바탕으로 행정감사 리스크 쟁점 10개를 도출하세요. 
(JSON 형식: {"risks": [{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}]})

데이터:
${context}`;
  } else {
    // 1. 데이터 취합 및 파일 전송 준비 (멀티모달 대응)

    if (fileId) {
      const file = DriveApp.getFileById(fileId);
      const blob = file.getBlob();
      const mimeType = blob.getContentType();
      
      if (mimeType === "application/pdf") {
        contents.parts.push({ inlineData: { data: Utilities.base64Encode(blob.getBytes()), mimeType: "application/pdf" } });
        aggregatedText = `[단일 PDF 분석] 파일명: ${file.getName()}`;
      } else {
        const txt = blob.getDataAsString();
        contents.parts.push({ text: `[단일 텍스트 분석] 파일명: ${file.getName()}\n${txt}` });
        aggregatedText = txt;
      }
    } else {
      const folderName = task === 'persona' ? 'minutes' : 'reports';
      const folder = getSubFolder(parent, folderName);
      const files = folder.getFiles();
      let fileIndex = 1;
      
      while (files.hasNext()) {
        const f = files.next();
        const blob = f.getBlob();
        const mimeType = blob.getContentType();
        
        if (mimeType === "application/pdf") {
          contents.parts.push({ inlineData: { data: Utilities.base64Encode(blob.getBytes()), mimeType: "application/pdf" } });
          aggregatedText += `\n[문서 #${fileIndex}] 파일명: ${f.getName()} (PDF 원본 전달)`;
        } else {
          const txt = blob.getDataAsString();
          contents.parts.push({ text: `\n[문서 #${fileIndex}] 파일명: ${f.getName()}\n---내용 시작---\n${txt}\n---내용 끝---\n` });
          aggregatedText += txt;
        }
        fileIndex++;
      }
    }

    if (contents.parts.length === 0) return { ok: false, error: "분석할 파일이 없습니다." };
    
    // 2. 고도화된 프롬프트 작성 (3단계 인지 프로세스 도입)
    const systemInstruction = `당신은 대한민국 지방의회 행정사무감사 전문 분석 AI입니다.
[필수 분석 단계]
1단계: 문서(회의록) 전체를 훑어 발언 인물을 정확히 식별하십시오.
2단계: 식별된 의원의 '지역구' 정보를 문서 내에서 찾아내십시오. (못 찾으면 '지역구 미확인')
3단계: 각 인물의 핵심 발언과 성향을 '상세하고 논리적으로' 요약하십시오. (약 700~1000자 내외로 상세 분석)
   - 단순히 "질문했다"가 아니라, 질문의 배경, 의원이 사용한 구체적인 데이터/수치, 비판의 논조, 재단측 답변에 대한 재반박 내용 등을 모두 포함하십시오.
   - 의원이 주로 사용하는 단어나 말투의 특징도 반영하십시오.
4단계: 요약된 내용을 바탕으로 실무자가 '즉시 대응' 가능한 의원별 상세 성향 리포트를 완성하십시오.

[절대 원칙]
- **누락 제로**: 회의록에 등장하여 질문이나 발언을 한 의원은 **단 한 명도 누락해서는 안 됩니다.** 질문이 단 하나인 의원이라도 반드시 포함하십시오.
- **전수 식별**: 분석 시작 전, 회의록 전체에서 발언한 모든 의원의 명단을 먼저 추출하고, 그 명단에 있는 모든 인물에 대해 리포트를 작성하십시오.
- **디테일 유지**: '발언요약' 항목은 이 시스템의 핵심입니다. 회의록 내용을 최대한 많이 복원하여 상세히 적으십시오. 소설을 쓰지 말고 '사실에 기반한 디테일'을 채우십시오.
- **입력 규모 대응**: 분석해야 할 의원이 많을 경우, 개별 요약의 길이를 핵심 위주로 소폭 조정하더라도 **인원수를 줄여서는 절대 안 됩니다.**
- '예상 감사 포인트'는 의원의 과거 질문 패턴을 분석해 이번 감사에서 공격해올 구체적인 아킬레스건을 3개 이상 제시하십시오.`;

    var prompt = task === 'persona' 
      ? `${systemInstruction}\n\n[미션] 회의록 내 발언 의원 **전수(100%)** 분석하여 의원별 상세 리포트 도출 (단 한 명의 누락도 허용하지 않음!)\n(JSON 형식: {"personas": [{"의원명": "...", "지역구": "...", "주요 관심사": "...", "질문 성향": "...", "예상 감사 포인트": "...", "발언요약": "..."}]})\n\n[데이터 원본]\n${aggregatedText}`
      : `${systemInstruction}\n\n[미션] 보고서 전수 분석하여 예상질문 생성\n(JSON 형식: {"questions": [{"분류": "...", "의원명": "...", "질문": "...", "답변 가이드": "..."}]})\n\n[데이터 원본]\n${aggregatedText}`;

    // [디버그 로그] 시트에 추출된 텍스트 기록 (추후 확인용)
    try {
      const debugSheet = getOrCreateSheet(ss, 'Debug_Log');
      debugSheet.clearContents().appendRow(['시간', '추출된 텍스트 샘플(5000자)']);
      
      const textToLog = String(aggregatedText || "추출된 텍스트가 없습니다.");
      const sampleText = textToLog.length > 5000 
        ? textToLog.substring(0, 2500) + "\n\n... (중략) ...\n\n" + textToLog.substring(textToLog.length - 2500)
        : textToLog;
      debugSheet.appendRow([new Date(), sampleText]);
    } catch(e) {
      console.error("로깅 오류:", e);
    }
  }

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
      const sheet = getOrCreateSheet(ss, '리스크 요인');
      sheet.clearContents().appendRow(['리스크 요인', '세부 내용', '관련 근거', '마지막 업데이트']);
      const risks = result.risks || result.data || [];
      risks.forEach(r => sheet.appendRow([r['리스크 요인'] || r['요인'], r['세부 내용'] || r['내용'], r['관련 근거'] || r['근거'], now]));
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
