import gspread
from google.oauth2.service_account import Credentials
import json
import logging
from typing import List, Dict
from config import GOOGLE_SHEET_ID, GOOGLE_CREDENTIALS_JSON

logger = logging.getLogger(__name__)

class SheetsSync:
    """구글 시트와 데이터를 동기화하는 클래스"""
    def __init__(self):
        self.scopes = [
            'https://www.googleapis.com/auth/spreadsheets',
            'https://www.googleapis.com/auth/drive'
        ]
        self.client = self._get_client()

    def _get_client(self):
        try:
            # GOOGLE_CREDENTIALS_JSON이 파일 경로인지 JSON 문자열인지 확인
            if GOOGLE_CREDENTIALS_JSON.endswith('.json'):
                creds = Credentials.from_service_account_file(GOOGLE_CREDENTIALS_JSON, scopes=self.scopes)
            else:
                info = json.loads(GOOGLE_CREDENTIALS_JSON)
                creds = Credentials.from_service_account_info(info, scopes=self.scopes)
            return gspread.authorize(creds)
        except Exception as e:
            logger.error(f"Google Sheets Auth Error: {e}")
            return None

    def clear_news_tab(self):
        """분석 시작 전 '주요 뉴스' 탭을 비움 (진행 상태 표시 대용)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("주요 뉴스")
                # 헤더만 남기고 모두 삭제
                worksheet.clear()
                worksheet.append_row(['날짜', '언론사', '제목', 'AI요약', '중요도', '분야', '링크', '마지막 업데이트'])
                logger.info("시트를 비우고 분석 준비 완료.")
            except: pass
        except Exception as e:
            logger.error(f"Clear Sheet Error: {e}")

    def update_news_tab(self, news_data: List[Dict]):
        """'주요 뉴스' 탭을 업데이트 (Append 방식 또는 Overwrite 방식)"""
        if not self.client:
            return
        
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("주요 뉴스")
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title="주요 뉴스", rows="100", cols="20")
                # GAS 규격 헤더: [pubDate, source, title, summary, importance, category, link, updateTime]
                worksheet.append_row(['날짜', '언론사', '제목', 'AI요약', '중요도', '분야', '링크', '마지막 업데이트'])

            for item in news_data:
                # 사용자 예시 기반 순서: [날짜(A), 구분/중요도(B), 언론사(C), 제목(D), 요약(E), 링크(F), 업데이트시간(G)]
                rows.append([
                    item.get("pubDate", today), # A: 기사 발행일
                    "-",                         # B: 구분/중요도 (기본값)
                    item.get("source", "뉴스"),  # C: 언론사 (Naver 인링크 기반)
                    item.get("title", ""),       # D: 제목
                    item.get("ai_summary", item.get("description", "")), # E: 요약
                    item.get("link", ""),        # F: 링크
                    today                        # G: 업데이트시간
                ])
            
            # 시트의 최상단(헤더 아래 2행)에 삽입 (최근 날짜가 위로 오도록)
            worksheet.insert_rows(rows, 2)
            logger.info(f"구글 시트 상단에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Sheets Update Error: {e}")

if __name__ == "__main__":
    # 테스트용
    logging.basicConfig(level=logging.INFO)
    sync = SheetsSync()
    # sync.update_news_tab([{"title": "Test", "importance": "상"}])
