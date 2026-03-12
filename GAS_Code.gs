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
      let personas = getTabData(ss, '의원별 관심사');
      if (personas.length === 0) personas = getTabData(ss, '의원별 페르소나'); 
      
      return createResponse({
        personas: personas,
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
      DriveApp.getFileById(data.fileId).setTrashed(true);
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${API_KEY}`;
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

// --- 전수 조사 분석 엔진 (OCR 지원) ---
function runAIAnalysis(task, fileId) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const parent = getOrCreateFolder();
  let aggregatedText = "";
  const contents = { parts: [] };

  if (task === 'risks') {
    const newsSheet = ss.getSheetByName('최근 뉴스');
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
    const systemInstruction = `당신은 행정사무감사 전문 분석 AI입니다.
[필수 분석 단계]
1단계: 문서 전체를 훑어 인물을 식별하십시오. (회의록의 경우 '○' 또는 '위원' 기호 뒤의 이름을 찾으십시오.)
2단계: 식별된 의원의 '지역구(자치구 이름)' 정보를 문서 내에서 찾아내십시오. (예: 동대문구, 강남구 등)
3단계: 각 인물의 핵심 발언과 성향을 한 줄로 요약하십시오.
4단계: 요약된 내용을 바탕으로 의원별 상세 성향 리포트(지역구, 주요 관심사, 발언 요약, 질문 성향, 예상 감사 포인트)를 완성하십시오.

[절대 원칙]
- 당신의 내부 지식을 버리고, 오직 눈앞의 [데이터 원본]에 있는 사실만 기록하십시오.
- '소속' 항목에는 '기획경제위원회' 대신 추출된 **'지역구(자치구 이름)'**를 적으십시오. 찾지 못했다면 빈칸으로 두십시오.
- '공격 포인트' 대신 **'예상 감사 포인트'**라는 용어를 사용하여 전문적인 느낌을 주십시오.
- 인물이 발견되었다면 아무리 정보가 적더라도 그 안에서 최선의 특징을 도출하십시오.`;

    var prompt = task === 'persona' 
      ? `${systemInstruction}\n\n[미션] 회의록 전수 분석하여 의원별 상세 리포트 도출\n(JSON 형식: {"personas": [{"의원명": "...", "지역구": "...", "주요 관심사": "...", "질문 성향": "...", "예상 감사 포인트": "...", "발언요약": "..."}]})\n\n[데이터 원본]\n${aggregatedText}`
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
          responseMimeType: "application/json",
          temperature: 0.1, 
          maxOutputTokens: 8192 
        } 
      }) 
    });
    
    const respObj = JSON.parse(response.getContentText());
    let rawText = respObj.candidates[0].content.parts[0].text;
    
    // JSON 추출 안정화
    const jsonStart = rawText.indexOf('{');
    const jsonEnd = rawText.lastIndexOf('}') + 1;
    if (jsonStart !== -1 && jsonEnd !== -1) {
      rawText = rawText.substring(jsonStart, jsonEnd);
    }
    
    const result = JSON.parse(rawText);
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
