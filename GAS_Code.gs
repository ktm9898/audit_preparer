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
      return createResponse(fetchNewsFromNaver());
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
  'hankyung.com', 'mk.co.kr', 'mt.co.kr', 'edaily.co.kr', 'sedaily.com', 'fnnews.com', 'heraldcorp.com', 'asiae.co.kr', 'ajunews.com'
];

function isTrustedMedia(url) {
  if (!url) return false;
  try {
    const domain = url.split('/')[2].replace('www.', '').replace('m.', '');
    return TRUSTED_DOMAINS.some(d => domain === d || domain.endsWith('.' + d));
  } catch (e) { return false; }
}

function getGeminiModel() {
  return "gemini-1.5-flash"; 
}

function normalizeTitle(title) {
  if (!title) return "";
  return title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").replace(/\s/g, "");
}

// --- 핵심 로직: 네이버 뉴스 수집 ---
function fetchNewsFromNaver() {
  const CLIENT_ID = PROPS.getProperty('NAVER_CLIENT_ID');
  const CLIENT_SECRET = PROPS.getProperty('NAVER_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return { ok: false, error: "네이버 API 설정이 필요합니다." };

  const baseQuery = "서울신용보증재단";
  const allItems = [];
  const apiHeaders = { "X-Naver-Client-Id": CLIENT_ID, "X-Naver-Client-Secret": CLIENT_SECRET };

  // 1. 월별 강제 분배 수집 (최근 12개월)
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const targetDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const yearMonth = Utilities.formatDate(targetDate, "GMT+9", "yyyy.MM");
    const query = `${baseQuery} ${yearMonth}`;
    
    try {
      // 월별로 제목 유사도가 높은(sim) 뉴스 위주로 수집
      const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=50&start=1&sort=sim`;
      const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        if (data.items) allItems.push(...data.items);
      }
    } catch (e) { console.error(`Naver API Fetch Error (${yearMonth}): ${e.message}`); }
  }

  // 보험: 최신순(date)으로도 100개 추가 확보
  try {
    const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(baseQuery)}&display=100&start=1&sort=date`;
    const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
    if (response.getResponseCode() === 200) {
      const data = JSON.parse(response.getContentText());
      if (data.items) allItems.push(...data.items);
    }
  } catch (e) {}

  if (allItems.length === 0) return { ok: false, error: "뉴스를 가져오지 못했습니다." };

  // 2. 데이터 정제 및 강력한 중복 제거
  const visitedLinks = new Set();
  const visitedNormalizedTitles = new Set();
  const processedItems = [];

  allItems.forEach(item => {
    const link = item.originallink || item.link;
    const title = item.title.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&apos;/g, "'").trim();
    const normalized = normalizeTitle(title);
    
    if (!visitedLinks.has(link) && !visitedNormalizedTitles.has(normalized) && isTrustedMedia(link)) {
      const date = new Date(item.pubDate);
      const dateStr = Utilities.formatDate(date, "GMT+9", "yyyy-MM-dd");
      const monthStr = Utilities.formatDate(date, "GMT+9", "yyyy-MM");
      
      // 언론사 이름 추출 개선 (Naver API는 description에 언론사가 섞여 나오기도 함. 여기서는 도메인 기반 추정 후 AI가 보강하도록 함)
      let sourceName = "뉴스";
      try {
        const domain = link.split('/')[2].replace('www.', '').replace('m.', '');
        if (domain.includes('chosun')) sourceName = "조선일보";
        else if (domain.includes('joongang')) sourceName = "중앙일보";
        else if (domain.includes('donga')) sourceName = "동아일보";
        else if (domain.includes('yna') || domain.includes('yna.co.kr')) sourceName = "연합뉴스";
        else if (domain.includes('newsis')) sourceName = "뉴시스";
        else if (domain.includes('news1')) sourceName = "뉴스1";
        else if (domain.includes('sedaily')) sourceName = "서울경제";
        else if (domain.includes('edaily')) sourceName = "이데일리";
        else if (domain.includes('hankyung')) sourceName = "한국경제";
        else if (domain.includes('mk.co.kr')) sourceName = "매일경제";
        else if (domain.includes('hani')) sourceName = "한겨레";
        else if (domain.includes('khan')) sourceName = "경향신문";
        else if (domain.includes('kbs')) sourceName = "KBS";
        else if (domain.includes('mbc')) sourceName = "MBC";
        else if (domain.includes('sbs')) sourceName = "SBS";
      } catch(e) {}

      visitedLinks.add(link);
      visitedNormalizedTitles.add(normalized);
      processedItems.push({ 
        ...item, 
        cleanTitle: title, 
        cleanLink: link, 
        sourceName,
        dateStr, 
        monthStr,
        pubTimestamp: date.getTime()
      });
    }
  });

  // 월별 루프 돌며 균등 배분 (각 월별 약 8~10건 목표)
  const monthlyGroups = {};
  processedItems.forEach(item => {
    if (!monthlyGroups[item.monthStr]) monthlyGroups[item.monthStr] = [];
    monthlyGroups[item.monthStr].push(item);
  });

  const finalPool = [];
  Object.keys(monthlyGroups).sort((a,b) => b.localeCompare(a)).forEach(month => {
    const monthItems = monthlyGroups[month]
      .sort((a, b) => b.pubTimestamp - a.pubTimestamp)
      .slice(0, 10); // 월당 10개로 제한하여 12개월분 확보 시 100~120개
    finalPool.push(...monthItems);
  });

  // --- 시트 준비 (헤더 제외 초기화) ---
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, '최근 뉴스');
  const headers = ['날짜', '분야', '언론사', '제목', '네이버요약', '본문전문', '링크', 'AI요약', '중요도'];
  
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const initialNewsList = finalPool.map(item => ({
    date: item.dateStr,
    category: "일반", // 초기값
    source: item.sourceName,
    title: item.cleanTitle,
    naverDesc: item.description.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').trim(),
    fullText: "", 
    link: item.cleanLink,
    aiSummary: "", 
    importance: "-",
    pubTimestamp: item.pubTimestamp
  })).sort((a, b) => b.pubTimestamp - a.pubTimestamp);

  // --- AI 파이프라인 ---
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');

  // Stage 1: 스크리닝 (AI 기반 중요도 및 분야 판별 + 중복 제거)
  console.log(`Stage 1 시작: 뉴스 ${initialNewsList.length}건 선별 및 분류 중...`);
  const screenedNews = screenImportanceWithAI(initialNewsList, API_KEY);
  
  // 중요도 순 정렬 (상 > 중 > 하) + 최신순
  const importanceMap = { '상': 3, '중': 2, '하': 1, '-': 0 };
  const sortedNewsList = screenedNews.sort((a, b) => {
    const impDiff = (importanceMap[b.importance] || 0) - (importanceMap[a.importance] || 0);
    if (impDiff !== 0) return impDiff;
    return b.pubTimestamp - a.pubTimestamp;
  });

  // 정확히 Top 100 선별
  const finalTop100 = sortedNewsList.slice(0, 100);
  
  // Stage 2 & 3: 상위 30건에 대해서만 전문 분석 수행
  const top30 = finalTop100.slice(0, 30);
  console.log(`Stage 2 & 3 시작: 상위 ${top30.length}건 본문 추출 및 정밀 분석 중...`);
  const crawledNews = crawlNewsContent(top30);
  const deepAnalyzedNews = deepAnalyzeNewsWithAI(crawledNews, API_KEY);
  
  // 결과 합치기
  const resultNews = [
    ...deepAnalyzedNews,
    ...finalTop100.slice(deepAnalyzedNews.length)
  ];

  if (resultNews.length > 0) {
    const rows = resultNews.map(n => [
      n.date, 
      n.category || "일반", 
      n.source, 
      n.title, 
      n.naverDesc, 
      n.fullText || "", 
      n.link, 
      n.aiSummary || n.naverDesc,
      n.importance
    ]);
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { ok: true, count: resultNews.length };
}

// --- 추가: 기사 본문 수집 함수 (crawlNewsContent) ---
function crawlNewsContent(newsList) {
  const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  return newsList.map(item => {
    try {
      const response = UrlFetchApp.fetch(item.link, { muteHttpExceptions: true, timeoutSeconds: 30 });
      if (response.getResponseCode() === 200) {
        const html = response.getContentText();
        const extracted = extractTextWithAI(html, API_KEY, item.title, item.link);
        if (extracted) {
          item.fullText = extracted;
        }
      }
    } catch (e) {
      console.warn(`기사 본문 수집 실패: ${item.link}, ${e.message}`);
    }
    return item;
  });
}

// --- 1단계: AI 뉴스 스크리닝 (제목/요약 기반) ---
function screenImportanceWithAI(newsList, apiKey) {
  if (!apiKey || newsList.length === 0) return newsList;

  const newsDataForAI = newsList.map((n, i) => `[${i}] 제목: ${n.title}\n요약: ${n.naverDesc}`).join('\n---\n');
  const prompt = `당신은 업무 효율을 극대화하는 지능형 뉴스 에디터입니다.
아래 뉴스 리스트를 분석하여 3가지 작업을 수행하세요.

[수행 작업]
1. 중요도 판별: '서울신용보증재단', '소상공인 지원정책', '금융지원', '상권분석', '의회/행정감사'와의 연관성에 따라 '상', '중', '하'를 매기세요. 재단에 대한 비판적이거나 이슈가 될 만한 뉴스는 반드시 '상'으로 분류하세요.
2. 분야 분류: 각 뉴스를 '정책', '지원', '경제', '금융', '의회', '기타' 중 하나로 분류하세요.
3. 중복 및 유사 내용 제거: 동일하거나 사실상 같은 사건을 다루는 뉴스가 여러 개라면, 가장 내용이 상세한 1개만 '상' 또는 '중'으로 남기고 나머지는 모두 '하'로 처리하세요. 제목만 조금 바꾼 어뷰징 기사들을 매우 엄격하게 걸러내어 사용자에게 단 하나의 기사만 보여주도록 하세요.

[응답 형식]
반드시 아래 JSON 형식으로만 답변하세요.
{
  "results": [
    {"index": 0, "importance": "상", "category": "정책"},
    {"index": 1, "importance": "중", "category": "금융"},
    ...
  ]
}

[뉴스 리스트]
${newsDataForAI}`;

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
      
      // JSON 추출 안정화
      if (feedback.startsWith('```')) {
        feedback = feedback.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
      }
      const jsonStart = feedback.indexOf('{');
      const jsonEnd = feedback.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd !== -1) {
        feedback = feedback.substring(jsonStart, jsonEnd);
      }
      
      const parsed = JSON.parse(feedback);
      parsed.results.forEach(item => {
        if (newsList[item.index]) {
          newsList[item.index].importance = item.importance;
          newsList[item.index].category = item.category;
        }
      });
    }
  } catch (e) { console.error("Screening AI Error:", e.message); }
  return newsList;
}

// --- 3단계: AI 전문 정밀 분석 (본문 기반) ---
function deepAnalyzeNewsWithAI(newsList, apiKey) {
  if (!apiKey || newsList.length === 0) return newsList;

  return newsList.map(item => {
    if (!item.fullText || item.fullText.length < 200) {
      item.aiSummary = item.naverDesc;
      return item;
    }

    const prompt = `뉴스 제목: ${item.title}
본문 전문:
${item.fullText.substring(0, 5000)}

[지시사항]
1. 위 기사 본문을 분석하여 핵심 내용을 2~3문장의 명확한 문체로 요약하세요.
2. 기사의 최종 중요도를 '상', '중', '하' 중에서 다시 판단하세요.
3. 기사의 분야를 '정책', '지원', '경제', '금융', '의회', '기타' 중 가장 적합한 것으로 최종 확정하세요.
4. 응답은 반드시 JSON 형식으로 하세요: {"summary": "요약내용", "importance": "상/중/하", "category": "분야"}

응답 형식 엄수.`;

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
        
        // JSON 추출 안정화
        if (feedback.startsWith('```')) {
          feedback = feedback.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const jsonStart = feedback.indexOf('{');
        const jsonEnd = feedback.lastIndexOf('}') + 1;
        if (jsonStart !== -1 && jsonEnd !== -1) {
          feedback = feedback.substring(jsonStart, jsonEnd);
        }
        
        const parsed = JSON.parse(feedback);
        item.aiSummary = parsed.summary;
        item.importance = parsed.importance;
        item.category = parsed.category;
      }
    } catch (e) { console.error("Deep Analysis AI Error:", e.message); }
    return item;
  });
}

function extractTextWithAI(html, apiKey, title, url) {
  if (!apiKey) return null;
  const slicedHtml = html.length > 25000 ? html.substring(0, 25000) : html;
  const prompt = `뉴스 제목: ${title}\nURL: ${url}\n\n[지시사항]\n제공된 HTML에서 기사 "본문"만 깨끗하게 추출하세요. 광고/메뉴/댓글 지우고 텍스트만. 추출 불가능하면 핵심 요약이라도 찾으세요.\n\n[HTML]\n${slicedHtml}`;

  try {
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${apiKey}`;
    const payload = { contents: [{ parts: [{ text: prompt }] }] };
    const resp = UrlFetchApp.fetch(apiURL, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true });
    if (resp.getResponseCode() !== 200) return null;
    const content = JSON.parse(resp.getContentText());
    return content.candidates[0].content.parts[0].text.trim();
  } catch (e) { return null; }
}

// --- Gemini AI를 이용한 뉴스 정제 ---
function cleanNewsWithAI(newsList) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  if (!API_KEY) return newsList.slice(0, 100); 

  const context = newsList.map((n, i) => `${i}. [${n.title}] ${n.desc}`).join("\n");
  const prompt = `당신은 뉴스 편집자입니다. 아래 '서울신용보증재단' 관련 뉴스 목록에서 중복 이슈를 제거하고 중요 뉴스 약 100개를 골라주세요. 
항목이 부족하면 최대한 많이 선택하세요. 홍보성이라도 재단 관련이면 포함하세요.
응답은 반드시 JSON 배열로 선택한 인덱스 번호만 주세요. 예: [0, 1, 2, ...]

목록:
${context.substring(0, 30000)}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { response_mime_type: "application/json" }
    };
    const response = UrlFetchApp.fetch(url, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload) });
    const fullContent = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
    
    // JSON 추출 안정화
    let cleanJson = fullContent;
    const jsonStart = cleanJson.indexOf('[');
    const jsonEnd = cleanJson.lastIndexOf(']') + 1;
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleanJson = cleanJson.substring(jsonStart, jsonEnd);
    }
    const selectedIndices = JSON.parse(cleanJson);
    
    return newsList.filter((_, i) => selectedIndices.includes(i));
  } catch (e) {
    console.warn("AI 필터링 실패, 단순 슬라이싱으로 대체:", e.message);
    return newsList.slice(0, 100);
  }
}

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
