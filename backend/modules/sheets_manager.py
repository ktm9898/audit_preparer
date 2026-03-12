"""
sheets_manager.py - Google Sheets CRUD 관리 모듈

Settings 탭: 주제-키워드 설정 관리
News_Data 탭: 수집된 뉴스 통합 저장소

인증 방식:
  - 로컬: credentials/service_account.json 파일
  - GitHub Actions: GOOGLE_CREDENTIALS_JSON 환경변수 (base64)
"""

import os
import json
import base64
import tempfile
import gspread
from google.oauth2.service_account import Credentials

from config import (
    GOOGLE_CREDENTIALS_PATH,
    GOOGLE_SHEET_ID,
    TAB_PERSONA,
    TAB_NEWS,
    TAB_RISKS,
    TAB_QUESTIONS,
    HEADERS_PERSONA,
    HEADERS_NEWS,
    HEADERS_RISKS,
    HEADERS_QUESTIONS,
)


import logging
logger = logging.getLogger(__name__)

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
]


def _get_credentials():
    """
    환경에 따라 적절한 인증 방법 선택.
    1순위: GOOGLE_CREDENTIALS_JSON 환경변수 (base64 인코딩된 서비스 계정 JSON)
    2순위: 로컬 JSON 파일
    """
    creds_raw = os.getenv("GOOGLE_CREDENTIALS_JSON", "").strip()
    if creds_raw:
        try:
            if creds_raw.startswith("{"):
                creds_dict = json.loads(creds_raw)
            else:
                creds_json = base64.b64decode(creds_raw).decode("utf-8")
                creds_dict = json.loads(creds_json)
            
            creds = Credentials.from_service_account_info(creds_dict, scopes=SCOPES)
            return creds
        except Exception as e:
            logger.error(f"환경변수 인증 정보 로드 실패: {e}")

    if os.path.exists(GOOGLE_CREDENTIALS_PATH):
        creds = Credentials.from_service_account_file(
            GOOGLE_CREDENTIALS_PATH, scopes=SCOPES
        )
        return creds

    raise FileNotFoundError(
        "Google 인증 정보를 찾을 수 없습니다.\n"
        "로컬: credentials/service_account.json 파일을 배치하세요.\n"
        "GitHub Actions: GOOGLE_CREDENTIALS_JSON 시크릿을 설정하세요."
    )


class SheetsManager:
    """Google Sheets 읽기/쓰기 관리자 (Audit Preparer 버전)"""

    def __init__(self):
        try:
            creds = _get_credentials()
            self.client = gspread.authorize(creds)
            self.spreadsheet = self.client.open_by_key(GOOGLE_SHEET_ID)
            self._ensure_tabs()
        except Exception as e:
            logger.error(f"SheetsManager 초기화 실패: {e}")
            raise

    # ── 초기화 ────────────────────────────────────────

    def _ensure_tabs(self):
        """필요한 탭이 없으면 자동 생성"""
        existing = [ws.title for ws in self.spreadsheet.worksheets()]
        
        tab_configs = [
            (TAB_PERSONA, HEADERS_PERSONA),
            (TAB_NEWS, HEADERS_NEWS),
            (TAB_RISKS, HEADERS_RISKS),
            (TAB_QUESTIONS, HEADERS_QUESTIONS),
        ]

        for title, headers in tab_configs:
            if title not in existing:
                ws = self.spreadsheet.add_worksheet(title=title, rows=1000, cols=len(headers) + 2)
                ws.append_row(headers)
                logger.info(f"시트 생성 완료: {title}")

    # ── 의원별 페르소나 ────────────────────────────────

    def get_all_personas(self) -> list[dict]:
        """모든 의원 페르소나 데이터 반환"""
        ws = self.spreadsheet.worksheet(TAB_PERSONA)
        return ws.get_all_records()

    def update_persona(self, persona_data: dict):
        """의원 페르소나 업데이트 또는 추가"""
        ws = self.spreadsheet.worksheet(TAB_PERSONA)
        records = ws.get_all_records()
        name = persona_data.get("의원명")
        
        found_row = -1
        for idx, row in enumerate(records):
            if row.get("의원명") == name:
                found_row = idx + 2
                break
        
        row_values = [persona_data.get(h, "") for h in HEADERS_PERSONA]
        if found_row != -1:
            ws.update(f"A{found_row}", [row_values])
        else:
            ws.append_row(row_values)

    # ── 최근 뉴스 ─────────────────────────────────────

    def get_existing_links(self) -> set[str]:
        """중복 방지를 위해 이미 저장된 뉴스 링크 가져오기"""
        ws = self.spreadsheet.worksheet(TAB_NEWS)
        try:
            link_col = HEADERS_NEWS.index("링크") + 1
            links = ws.col_values(link_col)
            return set(links[1:])
        except Exception:
            return set()

    def append_news(self, news_list: list[dict]):
        """새로운 뉴스 기사 추가"""
        if not news_list:
            return
        ws = self.spreadsheet.worksheet(TAB_NEWS)
        rows = []
        for news in news_list:
            rows.append([news.get(h, "") for h in HEADERS_NEWS])
        ws.append_rows(rows, value_input_option="USER_ENTERED")

    def get_all_news_raw(self) -> list[dict]:
        """모든 뉴스 원시 데이터 반환"""
        ws = self.spreadsheet.worksheet(TAB_NEWS)
        return ws.get_all_records()

    # ── 리스크 요인 ───────────────────────────────────

    def get_all_risks(self) -> list[dict]:
        """분석된 리스크 요인 목록 반환"""
        ws = self.spreadsheet.worksheet(TAB_RISKS)
        return ws.get_all_records()

    def update_risks(self, risks_list: list[dict]):
        """리스크 요인 전체 업데이트 (기존 내용 유지하며 갱신하거나 덮어쓰기)"""
        ws = self.spreadsheet.worksheet(TAB_RISKS)
        ws.clear()
        ws.append_row(HEADERS_RISKS)
        rows = []
        for risk in risks_list:
            rows.append([risk.get(h, "") for h in HEADERS_RISKS])
        ws.append_rows(rows, value_input_option="USER_ENTERED")

    # ── 예상 질문 ─────────────────────────────────────

    def save_questions(self, questions: list[dict]):
        """생성된 예상 질문 저장"""
        ws = self.spreadsheet.worksheet(TAB_QUESTIONS)
        rows = []
        for q in questions:
            rows.append([q.get(h, "") for h in HEADERS_QUESTIONS])
        ws.append_rows(rows, value_input_option="USER_ENTERED")

    def get_past_questions(self) -> list[dict]:
        """과거 생성된 질문 이력 반환"""
        ws = self.spreadsheet.worksheet(TAB_QUESTIONS)
        return ws.get_all_records()

