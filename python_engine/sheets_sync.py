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

    def get_existing_links(self) -> List[str]:
        """시트에 이미 존재하는 기사 링크들을 가져옴 (중복 수집 방지용)"""
        if not self.client: return []
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            worksheet = sh.worksheet("주요 뉴스")
            # F열(6번째)이 링크 컬럼. 2행부터 끝까지 가져옴
            return worksheet.col_values(6)[1:]
        except Exception as e:
            logger.error(f"Get Links Error: {e}")
            return []

    def clear_news_tab(self):
        """분석 시작 전 '주요 뉴스' 탭을 비움 (진행 상태 표시 대용)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("주요 뉴스")
                worksheet.clear()
                # UI 대응 헤더: [날짜, 중요도, 언론사, 제목, AI요약, 분야, 링크, 업데이트시간]
                worksheet.append_row(['날짜', '중요도', '언론사', '제목', 'AI요약', '분야', '링크', '업데이트시간'])
                logger.info("시트를 비우고 분석 준비 완료.")
            except: pass
        except Exception as e:
            logger.error(f"Clear Sheet Error: {e}")

    def update_news_tab(self, news_data: List[Dict]):
        """'주요 뉴스' 탭을 업데이트 (Append 방식)"""
        if not self.client: return
            try:
                worksheet = sh.worksheet("주요 뉴스")
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title="주요 뉴스", rows="100", cols="20")
                worksheet.append_row(['날짜', '중요도', '언론사', '제목', 'AI요약', '분야', '링크', '업데이트시간'])

            import datetime
            today = datetime.datetime.now().strftime("%Y.%m.%d")
            
            rows = []
            for item in news_data:
                # App.jsx 필드 매핑 대응: [날짜, 중요도, 언론사, 제목, AI요약, 분야, 링크, 업데이트시간]
                rows.append([
                    item.get("pubDate", today), 
                    item.get("importance", "하"), 
                    item.get("source", "뉴스"), 
                    item.get("title", ""), 
                    item.get("ai_summary", item.get("description", "")), 
                    item.get("category", "기타"),
                    item.get("link", ""), 
                    today
                ])
            
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"구글 시트에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Sheets Update Error: {e}")
        except Exception as e:
            logger.error(f"Sheets Update Error: {e}")

if __name__ == "__main__":
    # 테스트용
    logging.basicConfig(level=logging.INFO)
    sync = SheetsSync()
    # sync.update_news_tab([{"title": "Test", "importance": "상"}])
