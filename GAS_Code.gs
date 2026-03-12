/**
 * Google Apps Script for Audit Preparer (Read-only API for Frontend)
 * 
 * Features:
 * - doGet: 시트 데이터 조회 (의원별 페르소나, 최근 뉴스, 리스크 요인, 예상 질문)
 */

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tab = e.parameter.tab;
  const action = e.parameter.action;

  // 1. 전체 데이터 요약 조회 (대시보드용)
  if (action === 'getAllData') {
    return createResponse({
      personas: getTabData(ss, '의원별 페르소나'),
      risks: getTabData(ss, '리스크 요인'),
      questions: getTabData(ss, '예상 질문'),
      news_count: getTabRowCount(ss, '최근 뉴스') - 1 // 헤더 제외
    });
  }

  // 2. GitHub Actions 워크플로우 트리거
  if (action === 'triggerWorkflow') {
    const props = PropertiesService.getScriptProperties();
    const GITHUB_PAT = props.getProperty('GITHUB_PAT');
    const REPO_OWNER = props.getProperty('REPO_OWNER'); // 예: ktm9898
    const REPO_NAME = props.getProperty('REPO_NAME');   // 예: audit_preparer
    
    if (!GITHUB_PAT || !REPO_OWNER || !REPO_NAME) {
      return createResponse({ error: 'GITHUB_PAT, REPO_OWNER, REPO_NAME이 GAS 스크립트 속성에 설정되지 않았습니다.', ok: false });
    }

    const task = e.parameter.task || 'news';
    const filePath = e.parameter.file_path || '';
    
    const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/audit_pipeline.yml/dispatches`;
    const options = {
      method: 'post',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': 'Bearer ' + GITHUB_PAT
      },
      payload: JSON.stringify({ 
        ref: 'master', // 또는 main
        inputs: { task: task, file_path: filePath }
      }),
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch(url, options);
      if (response.getResponseCode() >= 200 && response.getResponseCode() < 300) {
        return createResponse({ ok: true, success: true, message: `${task} 작업 요청 성공` });
      } else {
        return createResponse({ error: 'GitHub API 오류: ' + response.getContentText(), ok: false });
      }
    } catch (err) {
      return createResponse({ error: '요청 실패: ' + err.toString(), ok: false });
    }
  }

  // 2. 특정 탭 데이터 조회
  if (tab) {
    const data = getTabData(ss, tab);
    return createResponse(data);
  }

  return createResponse({ error: 'Invalid parameters' });
}

function getTabData(ss, tabName) {
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  const headers = data[0];
  const rows = data.slice(1);

  return rows.filter(row => row[0]).map(row => {
    let obj = {};
    headers.forEach((h, i) => {
      let val = row[i];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, "GMT+9", "yyyy-MM-dd HH:mm");
      }
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
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
