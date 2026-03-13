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

// --- 핵심 로직: 네이버 뉴스 수집 ---
function fetchNewsFromNaver() {
  const CLIENT_ID = PROPS.getProperty('NAVER_CLIENT_ID');
  const CLIENT_SECRET = PROPS.getProperty('NAVER_CLIENT_SECRET');
  if (!CLIENT_ID || !CLIENT_SECRET) return { ok: false, error: "네이버 API 설정이 필요합니다." };

  const query = "서울신용보증재단";
  const allItems = [];
  const searchUrls = [
    `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=100&start=1&sort=sim`,
    `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=100&start=1&sort=date`,
    `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=100&start=101&sort=sim`
  ];

  const apiHeaders = {
    "X-Naver-Client-Id": CLIENT_ID,
    "X-Naver-Client-Secret": CLIENT_SECRET
  };

  searchUrls.forEach(url => {
    try {
      const response = UrlFetchApp.fetch(url, { headers: apiHeaders, muteHttpExceptions: true });
      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());
        if (data.items) allItems.push(...data.items);
      } else {
        console.warn(`Naver API Fetch Error for URL: ${url}, Response Code: ${response.getResponseCode()}, Content: ${response.getContentText()}`);
      }
    } catch (e) {
      console.error("Naver API Fetch Error: " + e.message);
    }
  });

  if (allItems.length === 0) return { ok: false, error: "뉴스를 가져오지 못했습니다." };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = getOrCreateSheet(ss, '최근 뉴스');
  const headers = ['날짜', '주제', '언론사', '제목', '네이버요약', '본문전문', '링크', 'AI요약', '중요도'];
  
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }
  // 헤더가 다른 경우 초기화
  if (sheet.getRange(1, 1).getValue() !== '날짜' || sheet.getLastColumn() < headers.length) {
    sheet.clear().appendRow(headers);
  }
  const existingLinks = sheet.getLastRow() > 1 ? sheet.getRange("G:G").getValues().flat().map(String) : []; // 링크 컬럼이 G로 이동
  const existingTitles = sheet.getLastRow() > 1 ? sheet.getRange("D:D").getValues().flat().map(String) : []; // 제목 컬럼이 D로 이동
  
  const newNews = allItems.filter(item => {
                          const link = item.originallink || item.link;
                          const title = item.title.replace(/<[^>]+>/g, "");
                          return !existingLinks.includes(link) && !existingTitles.includes(title);
                        })
                        .map(item => ({
                          date: Utilities.formatDate(new Date(item.pubDate), "GMT+9", "yyyy-MM-dd"),
                          topic: "서울신용보증재단",
                          source: "뉴스",
                          title: item.title.replace(/<[^>]+>/g, ""),
                          naverDesc: item.description.replace(/<[^>]+>/g, ""),
                          fullText: "", // 크롤링 전
                          link: item.originallink || item.link,
                          aiSummary: "", // 크롤링/요약 전
                          importance: "-"
                        }))
                        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()); // 최신순 정렬

  if (newNews.length === 0) return { ok: true, message: "새로운 뉴스가 없습니다.", count: 0 };

  // AI 필터링을 조금 더 넉넉하게 가져가거나, 일단 다 가져온 뒤 크롤링
  const cleanedNews = cleanNewsWithAI(newNews);
  
  // 크롤링 수량을 100개로 확대
  const finalNews = crawlNewsContent(cleanedNews.slice(0, 100));

  if (finalNews.length > 0) {
    const rows = finalNews.map(n => [
      n.date, 
      n.topic, 
      n.source, 
      n.title, 
      n.naverDesc, 
      n.fullText, 
      n.link, 
      n.aiSummary || n.naverDesc, // AI 요약이 없으면 네이버 요약으로
      n.importance
    ]);
    sheet.insertRowsAfter(1, rows.length); // 헤더 아래에 새 행 삽입
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  return { ok: true, count: finalNews.length };
}

function crawlNewsContent(newsList) {
  const API_KEY = PROPS.getProperty('GEMINI_API_KEY');
  return newsList.map(item => {
    try {
      // 1. 링크가 네이버 뉴스인 경우, 더 가벼운 m.news.naver.com 등으로 전환 시도 가능하나 
      // 현재는 Gemini가 HTML 전체를 보고 판단하므로 타임아웃만 넉넉히 줌
      const response = UrlFetchApp.fetch(item.link, { 
        muteHttpExceptions: true, 
        followRedirects: true, 
        timeout: 10000, // 타임아웃 10초로 확대
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
      });
      
      if (response.getResponseCode() === 200) {
        const html = response.getContentText();
        const res = extractTextWithAI(html, API_KEY, item.title, item.link);
        if (res && res.length > 100) { 
          item.fullText = res;
          item.aiSummary = res.substring(0, 300) + "..."; // 1차 요약 (프론트 표시용)
        } else {
          item.fullText = item.naverDesc; // 추출 실패 시 네이버 요약이라도 보존
          item.aiSummary = item.naverDesc;
        }
      } else {
        console.warn(`크롤링 실패(코드 ${response.getResponseCode()}): ${item.link}`);
        item.fullText = item.naverDesc;
        item.aiSummary = item.naverDesc;
      }
    } catch (e) {
      console.warn("크롤링 예외 발생:", item.link, e.message);
      item.fullText = item.naverDesc;
      item.aiSummary = item.naverDesc;
    }
    return item;
  });
}

function extractTextWithAI(html, apiKey, title, url) {
  if (!apiKey) return null;
  
  // HTML이 너무 크면 Gemini 입력 제한에 걸릴 수 있으므로 핵심 영역 위주로 절삭
  // 보통 기사 본문은 앞부분에 위치함
  const slicedHtml = html.length > 25000 ? html.substring(0, 25000) : html;

  const prompt = `뉴스 제목: ${title}
뉴스 URL: ${url}

[지시사항]
1. 제공된 HTML 소스에서 뉴스 기사의 "본문 전문"만 깨끗하게 추출하세요.
2. 기사 내용과 무관한 요소(광고, 바닥글, 기자 이메일, 추천 기사 목록, 댓글, SNS 공유 버튼 등)는 반드시 제외하세요.
3. 기사 본문의 문맥을 유지하며, 텍스트 형태 그대로 반환하세요.
4. 만약 본문 추출이 불가능한 구조라면, HTML 내에 포함된 핵심 내용 요약이라도 찾아내어 반환하세요.
5. 응답에는 오직 추출된 본문 텍스트만 포함하세요. (설명 생략)

[HTML 데이터]
${slicedHtml}`;

  try {
    const apiURL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
    const payload = { 
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 2048
      }
    };
    const resp = UrlFetchApp.fetch(apiURL, { 
      method: "POST", 
      contentType: "application/json", 
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    if (resp.getResponseCode() !== 200) {
      console.error("Gemini API Error:", resp.getContentText());
      return null;
    }
    
    const content = JSON.parse(resp.getContentText());
    return content.candidates[0].content.parts[0].text.trim();
  } catch (e) { 
    console.error("extractTextWithAI Exception:", e.message);
    return null; 
  }
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
      generationConfig: { responseMimeType: "application/json" }
    };
    const response = UrlFetchApp.fetch(url, { method: "POST", contentType: "application/json", payload: JSON.stringify(payload) });
    const indicesStr = JSON.parse(response.getContentText()).candidates[0].content.parts[0].text;
    const selectedIndices = typeof indicesStr === 'string' ? JSON.parse(indicesStr) : indicesStr;
    
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
- '발언요약' 항목은 이 시스템의 핵심입니다. 회의록 내용을 최대한 많이 복원하여 상세히 적으십시오. 소설을 쓰지 말고 '사실에 기반한 디테일'을 채우십시오.
- '예상 감사 포인트'는 의원의 과거 질문 패턴을 분석해 이번 감사에서 공격해올 구체적인 아킬레스건을 3개 이상 제시하십시오.`;

    var prompt = task === 'persona' 
      ? `${systemInstruction}\n\n[미션] 회의록 전수 분석하여 의원별 상세 리포트 도출 (발언 요약은 최대한 길고 구체적으로 작성!)\n(JSON 형식: {"personas": [{"의원명": "...", "지역구": "...", "주요 관심사": "...", "질문 성향": "...", "예상 감사 포인트": "...", "발언요약": "..."}]})\n\n[데이터 원본]\n${aggregatedText}`
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
