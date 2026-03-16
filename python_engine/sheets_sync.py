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

            # 데이터 변환 (GAS 규격에 맞춤)
            rows = []
            import datetime
            today = datetime.datetime.now().strftime("%Y.%m.%d")
            
            for item in news_data:
                rows.append([
                    item.get("pubDate", today), # 날짜 (네이버 제공 날짜 우선)
                    item.get("source", "뉴스"),  # 언론사
                    item.get("title", ""),      # 제목
                    item.get("ai_summary", item.get("description", "")), # 요약 (AI요약 우선)
                    item.get("importance", "-"), # 중요도
                    item.get("category", "-"),   # 분야
                    item.get("link", ""),        # 링크
                    today                        # 마지막 업데이트 (현재 시간)
                ])
            
            # 시트의 맨 아래에 추가
            worksheet.append_rows(rows)
            logger.info(f"구글 시트 '주요 뉴스' 탭에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Sheets Update Error: {e}")

if __name__ == "__main__":
    # 테스트용
    logging.basicConfig(level=logging.INFO)
    sync = SheetsSync()
    # sync.update_news_tab([{"title": "Test", "importance": "상"}])
