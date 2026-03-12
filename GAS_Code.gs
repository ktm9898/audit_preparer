const FOLDER_NAME = "Audit_Preparer_Files";

// --- 보안 설정 ---
const PROPS = PropertiesService.getScriptProperties();
const ACCESS_TOKEN = PROPS.getProperty('ACCESS_TOKEN') || "audit123"; // 기본값, 사용자가 속성에서 변경 가능

function checkAuth(e) {
  const token = e.parameter.token || (e.postData && JSON.parse(e.postData.contents).token);
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
      return createResponse({
        personas: getTabData(ss, '의원별 페르소나'),
        risks: getTabData(ss, '리스크 요인'),
        questions: getTabData(ss, '예상 질문'),
        news_count: getTabRowCount(ss, '최근 뉴스') - 1
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
      DriveApp.getFileById(data.id).setTrashed(true);
      return createResponse({ ok: true });
    }

    return createResponse({ error: 'Invalid POST action' });
  } catch (err) {
    return createResponse({ ok: false, error: err.message });
  }
}

// --- 핵심 로직: 네이버 뉴스 수집 ---
function fetchNewsFromNaver() {
  const CLIENT_ID = PROPS.getProperty('NAVER_CLIENT_ID');
  const CLIENT_SECRET = PROPS.getProperty('NAVER_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return { ok: false, error: "네이버 API 설정이 필요합니다." };

  const query = "서울신용보증재단";
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=50&sort=date`;
  
  const response = UrlFetchApp.fetch(url, {
    headers: { "X-Naver-Client-Id": CLIENT_ID, "X-Naver-Client-Secret": CLIENT_SECRET }
  });
  const items = JSON.parse(response.getContentText()).items;
  
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('최근 뉴스');
  const existingLinks = sheet.getRange("E:E").getValues().flat();
  
  const newNews = items.filter(item => !existingLinks.includes(item.originallink || item.link))
                       .map(item => ({
                         date: Utilities.formatDate(new Date(item.pubDate), "GMT+9", "yyyy-MM-dd"),
                         source: item.originallink ? "언론사" : "네이버",
                         title: item.title.replace(/<[^>]+>/g, ""),
                         desc: item.description.replace(/<[^>]+>/g, ""),
                         link: item.originallink || item.link
                       }));

  if (newNews.length === 0) return { ok: true, message: "새로운 뉴스가 없습니다.", count: 0 };

  // Gemini를 이용한 중복 제거 및 중요도 필터링
  const cleanedNews = cleanNewsWithAI(newNews);
  
  if (cleanedNews.length > 0) {
    const lastRow = sheet.getLastRow();
    const rows = cleanedNews.map(n => [n.date, n.source, n.title, n.desc, n.link, Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd")]);
    sheet.getRange(lastRow + 1, 1, rows.length, 6).setValues(rows);
  }

  return { ok: true, count: cleanedNews.length };
}

// --- Gemini AI를 이용한 뉴스 정제 ---
function cleanNewsWithAI(newsList) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  if (!API_KEY) return newsList; // 키 없으면 그냥 반환

  const context = newsList.map((n, i) => `${i}. [${n.title}] ${n.desc}`).join("\n");
  const prompt = `당신은 뉴스 편집자입니다. 아래 '서울신용보증재단' 관련 뉴스 목록에서 중복된 이슈를 제거하고, 행정감사 관점에서 중요한 뉴스만 골라주세요.
중요도가 낮은 홍보성 기사는 제외하세요.
응답은 반드시 JSON 배열로, 선택한 뉴스의 인덱스 번호만 주세요. 예: [0, 2, 5]

목록:
${context}`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: "application/json" }
    };
    const response = UrlFetchApp.fetch(url, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload) });
    const indices = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
    const selectedIndices = typeof indices === 'string' ? JSON.parse(indices) : indices;
    
    return newsList.filter((_, i) => selectedIndices.includes(i));
  } catch (e) {
    return newsList.slice(0, 10); // 에러 시 상위 10개만
  }
}

// --- Gemini AI 분석 엔진 (리스크/페르소나/질문) ---
function runAIAnalysis(task, fileId) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  let prompt = "";
  if (task === 'risks') {
    const news = ss.getSheetByName('최근 뉴스').getDataRange().getValues().slice(1);
    const context = news.map(r => `[${r[0]}] ${r[2]}: ${r[3]}`).join("\n");
    prompt = `서울신용보증재단 뉴스 데이터를 바탕으로 행정감사 리스크 쟁점 10개를 도출하세요. JSON 형식: {"risks": [{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}]}\n\n데이터:\n${context}`;
  } else if (task === 'persona') {
    const file = DriveApp.getFileById(fileId);
    const blob = file.getBlob();
    // Gemini 1.5/2.0은 PDF 직접 처리가 가능하지만 GAS에서는 텍스트 추출이 안전함
    const text = blob.getDataAsString() || "PDF 텍스트 추출 필요"; 
    prompt = `회의록을 분석하여 의원별 페르소나를 추출하세요. JSON 형식: {"personas": [{"의원명": "...", "소속": "...", "주요 관심사": "...", "질문 스타일": "...", "공격 포인트": "..."}]}\n\n회의록:\n${text}`;
  } else if (task === 'questions') {
    const file = DriveApp.getFileById(fileId);
    const text = file.getBlob().getDataAsString();
    prompt = `업무보고서를 바탕으로 행정감사 예상 질문과 답변을 생성하세요. JSON 형식: {"questions": [{"분류": "...", "의원명": "...", "질문": "...", "답변 가이드": "..."}]}\n\n보고서:\n${text}`;
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${API_KEY}`;
    const response = UrlFetchApp.fetch(url, {
      method: "POST", contentType: "application/json",
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: "application/json" } })
    });
    const result = JSON.parse(JSON.parse(response.getContentText()).candidates[0].content.parts[0].text);

    const now = Utilities.formatDate(new Date(), "GMT+9", "yyyy-MM-dd HH:mm");
    if (task === 'risks') {
      const sheet = ss.getSheetByName('리스크 요인');
      sheet.clearContents().appendRow(['리스크 요인', '세부 내용', '관련 근거', '마지막 업데이트']);
      result.risks.forEach(r => sheet.appendRow([r['리스크 요인'], r['세부 내용'], r['관련 근거'], now]));
    } else if (task === 'persona') {
      const sheet = ss.getSheetByName('의원별 페르소나');
      result.personas.forEach(p => sheet.appendRow([p['의원명'], p['소속'], p['주요 관심사'], p['질문 스타일'], p['공격 포인트'], now]));
    } else if (task === 'questions') {
      const sheet = ss.getSheetByName('예상 질문');
      result.questions.forEach(q => sheet.appendRow([q['분류'], q['의원명'], q['질문'], q['답변 가이드'], now]));
    }
    return { ok: true, count: (result.risks || result.personas || result.questions).length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
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
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.TEXT);
}
