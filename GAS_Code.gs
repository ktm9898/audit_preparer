const FOLDER_NAME = "Audit_Preparer_Files";

// --- [복원] 기존 GAS의 신뢰할 수 있는 매체 및 도메인 맵 ---
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

const DOMAIN_MAP = { 
    'chosun': '조선일보', 'joongang': '중앙일보', 'donga': '동아일보', 'yna': '연합뉴스', 
    'newsis': '뉴시스', 'news1': '뉴스1', 'sedaily': '서울경제', 'edaily': '이데일리', 
    'hankyung': '한국경제', 'mk': '매일경제', 'hani': '한겨레', 'khan': '경향신문', 
    'kmib': '국민일보', 'segye': '세계일보', 'seoul': '서울신문', 'munhwa': '문화일보', 
    'moneytoday': '머니투데이', 'mt.co.kr': '머니투데이', 'asiae': '아시아경제', 'ajunews': '아주경제',
    'fnnews': '파이낸셜뉴스', 'heraldcorp': '헤럴드경제', 'etnews': '전자신문', 'digitaltimes': '디지털타임스', 'dt.co.kr': '디지털타임스',
    'kbs': 'KBS', 'mbc': 'MBC', 'sbs': 'SBS', 'ytn': 'YTN', 'jtbc': 'JTBC', 'mbn': 'MBN', 'tvchosun': 'TV조선', 'ichannela': '채널A',
    'hankookilbo': '한국일보', 'nocutnews': '노컷뉴스', 'ohmynews': '오마이뉴스', 'pressian': '프레시안', 'vop': '민중의소리',
    'kukinews': '쿠키뉴스', 'newdaily': '뉴데일리', 'dailian': '데일리안', 'sisain': '시사인', 'dnews': '대한경제', 'bizwatch': '비즈워치'
};

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

// --- 핵심 프로세스는 이제 Python Engine에서 처리하는 것을 권장합니다 ---
// 이 코드는 UI 유지 및 간단한 수집용으로 경량화되었습니다.

function isTrustedMedia(url) {
  if (!url) return false;
  return TRUSTED_DOMAINS.some(d => url.includes(d));
}

function getSourceByUrl(url) {
  if (!url) return "뉴스";
  for (let key in DOMAIN_MAP) {
    if (url.includes(key)) return DOMAIN_MAP[key];
  }
  return "뉴스";
}

function getGeminiModel() {
  return "gemini-3-flash-preview"; 
}

// --- GitHub Actions 트리거 연동 (하이브리드 핵심) ---
function triggerGithubAction(task, payload = {}) {
  const PROPS = PropertiesService.getScriptProperties();
  const GITHUB_TOKEN = PROPS.getProperty('GITHUB_TOKEN'); // 사용자님이 입력해주셔야 하는 필수값
  const GITHUB_REPO = "ktm9898/audit_preparer"; // 저장소 정보

  if (!GITHUB_TOKEN) {
    return { ok: false, error: "GitHub 토큰(GITHUB_TOKEN)이 스크립트 속성에 설정되지 않았습니다. 실전 테스트를 위해 토큰 설정이 필요합니다." };
  }

  const url = `https://api.github.com/repos/${GITHUB_REPO}/dispatches`;
  const options = {
    method: "POST",
    headers: {
      "Authorization": `token ${GITHUB_TOKEN}`,
      "Accept": "application/vnd.github.v3+json"
    },
    payload: JSON.stringify({
      event_type: "run-task",
      client_payload: {
        task: task,
        ...payload
      }
    })
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 204) {
      return { ok: true, message: `🚀 Python 엔진에서 '${task}' 분석을 시작했습니다. 잠시 후 시트에서 결과를 확인하세요.` };
    }
    return { ok: false, error: "GitHub 호출 실패: " + response.getContentText() };
  } catch (e) {
    return { ok: false, error: "트리거 중 오류 발생: " + e.message };
  }
}

// --- 레거시 뉴스 수집 로직 -> Python 엔진 트리거로 전환 ---
function fetchNewsFromNaver(targetMonth) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const initialCount = getTabRowCount(ss, '주요 뉴스');
  
  ss.toast("Python 엔진이 업무를 시작했습니다. 완료될 때까지 잠시만 기다려 주세요...", "🚀 분석 시작", 10);
  
  const triggerResult = triggerGithubAction("news", { month: targetMonth || "" });
  if (!triggerResult.ok) return triggerResult;
  
  // Polling: 최대 5분 동안 시트 업데이트 감시 (ai_news_briefing 스타일 UX)
  const startTime = new Date().getTime();
  while (new Date().getTime() - startTime < 300000) { // 5분 타임아웃
    Utilities.sleep(10000); // 10초마다 확인
    SpreadsheetApp.flush(); // 시트 상태 강제 동기화
    
    const currentCount = getTabRowCount(ss, '주요 뉴스');
    if (currentCount > initialCount) {
      ss.toast("뉴스 수집 및 AI 분석이 성공적으로 완료되었습니다!", "✅ 완료", 5);
      return { ok: true, message: "수집 완료" };
    }
  }
  
  return { ok: false, error: "시간 초과: 엔진 응답이 늦거나 수집된 뉴스가 없습니다. 깃허브 Actions 탭을 확인해 주세요." };
}

function runAIAnalysis(task, fileId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabNameMap = {
    'risks': '리스크 추출1',
    'report_risks': '리스크 추출2',
    'persona': '의원별 관심사',
    'questions': '예상 질문'
  };
  const targetTab = tabNameMap[task] || '리스크 추출1';
  const initialRow = getTabRowCount(ss, targetTab);
  
  ss.toast(`${task} 분석을 위해 AI 엔진을 가동합니다. 잠시만 기다려 주세요...`, "🚀 분석 시작", 15);
  
  const triggerResult = triggerGithubAction(task, { fileId: fileId || "" });
  if (!triggerResult.ok) return triggerResult;

  // Polling: 최대 5분 동안 시트 업데이트 감시
  const startTime = new Date().getTime();
  while (new Date().getTime() - startTime < 300000) { 
    Utilities.sleep(10000); // 10초 대기
    SpreadsheetApp.flush();
    
    const currentCount = getTabRowCount(ss, targetTab);
    // 덮어쓰기이므로 단순히 헤더(1줄) 이상의 데이터가 생겼는지 확인
    // (기존 데이터가 있었다면 clear 후 다시 쓰이는 시점을 잡아야 하지만, 
    // 여기서는 간단하게 1줄 이상 존재하면 분석 데이터가 도착한 것으로 간주)
    if (currentCount > 1) {
      ss.toast(`${task} 분석 및 시트 저장이 완료되었습니다!`, "✅ 완료", 5);
      return { ok: true, message: "분석 완료" };
    }
  }
  
  return { ok: false, error: "시간 초과: 엔진 응답이 없거나 데이터가 생성되지 않았습니다. GitHub Actions 탭을 확인해 주세요." };
}
// --- 모든 분석 로직은 이제 GitHub Actions 파이썬 엔진에서 수행됩니다 ---

// --- 공통 유틸리티 (UI 및 데이터 브릿지용) ---
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
