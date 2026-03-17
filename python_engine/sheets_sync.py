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
        """분석 시작 전 '주요 뉴스' 탭을 비움 (사용자 요청에 따라 수동 실행 전용)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("주요 뉴스")
                worksheet.clear()
                # 사용자 정의 컬럼 순서: [날짜, 분야, 언론사, 제목, 네이버요약, 본문전문, 링크, AI요약, 중요도]
                worksheet.append_row(['날짜', '분야', '언론사', '제목', '네이버요약', '본문전문', '링크', 'AI요약', '중요도'])
                logger.info("시트를 비우고 분석 준비 완료.")
            except: pass
        except Exception as e:
            logger.error(f"Clear Sheet Error: {e}")

    def update_news_tab(self, news_data: List[Dict]):
        """'주요 뉴스' 탭을 업데이트 (Append 방식)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("주요 뉴스")
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title="주요 뉴스", rows="100", cols="20")
                worksheet.append_row(['날짜', '분야', '언론사', '제목', '네이버요약', '본문전문', '링크', 'AI요약', '중요도'])

            import datetime
            today = datetime.datetime.now().strftime("%Y.%m.%d")
            
            rows = []
            for item in news_data:
                # 사용자 정의 컬럼 매핑: [날짜, 분야, 언론사, 제목, 네이버요약, 본문전문, 링크, AI요약, 중요도]
                rows.append([
                    item.get("pubDate", today), 
                    item.get("category", "기타"),
                    item.get("source", "뉴스"), 
                    item.get("title", ""), 
                    item.get("description", ""), # 네이버요약
                    item.get("full_text", ""),    # 본문전문
                    item.get("link", ""), 
                    item.get("ai_summary", ""),   # AI요약
                    item.get("importance", "하")
                ])
            
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"구글 시트에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Sheets Update Error: {e}")

    def get_tab_data(self, tab_name: str) -> List[Dict]:
        """특정 탭의 데이터를 읽어옴 (첫 행은 헤더)"""
        if not self.client: return []
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet(tab_name)
            except gspread.exceptions.WorksheetNotFound:
                logger.warning(f"탭 '{tab_name}'을 찾을 수 없습니다.")
                return []
            
            records = worksheet.get_all_records()
            return records
        except Exception as e:
            logger.error(f"Get Tab Data Error ({tab_name}): {e}")
            return []

    def update_risks_tab(self, risk_data: List[Dict], tab_name: str = "리스크 추출1"):
        """리스크 추출 결과를 시트에 저장 (덮어쓰기)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet(tab_name)
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title=tab_name, rows="100", cols="10")
            
            worksheet.clear()
            worksheet.append_row(['리스크 요인', '세부 내용', '관련 근거'])
            
            rows = []
            for item in risk_data:
                rows.append([
                    item.get("리스크 요인", item.get("요인", "")),
                    item.get("세부 내용", item.get("내용", "")),
                    item.get("관련 근거", item.get("근거", ""))
                ])
                
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"구글 시트 '{tab_name}' 탭에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Update Risks Tab Error ({tab_name}): {e}")

    def update_questions_tab(self, questions_data: List[Dict]):
        """최종 예상 질문 결과를 시트에 저장 (덮어쓰기)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("예상 질문")
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title="예상 질문", rows="100", cols="10")
            
            worksheet.clear()
            worksheet.append_row(['분류', '의원명', '질문', '답변 가이드'])
            
            rows = []
            for item in questions_data:
                rows.append([
                    item.get("분류", ""),
                    item.get("의원명", ""),
                    item.get("질문", item.get("예상 질문", "")),
                    item.get("답변 가이드", item.get("답변 방향", item.get("대응방안", "")))
                ])
                
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"구글 시트 '예상 질문' 탭에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Update Questions Tab Error: {e}")

    def update_persona_tab(self, persona_data: List[Dict]):
        """의원 별 관심사 탭을 업데이트 (덮어쓰기)"""
        if not self.client: return
        try:
            sh = self.client.open_by_key(GOOGLE_SHEET_ID)
            try:
                worksheet = sh.worksheet("의원별 관심사")
            except gspread.exceptions.WorksheetNotFound:
                worksheet = sh.add_worksheet(title="의원별 관심사", rows="100", cols="10")
            
            worksheet.clear()
            worksheet.append_row(['의원명', '지역구', '주요 관심사', '질문 성향', '예상 감사 포인트', '발언요약'])
            
            rows = []
            for item in persona_data:
                rows.append([
                    item.get("의원명", item.get("이름", "")),
                    item.get("지역구", item.get("소속", "")),
                    item.get("주요 관심사", item.get("관심사", "")),
                    item.get("질문 성향", item.get("성향", "")),
                    item.get("예상 감사 포인트", item.get("감사 포인트", "")),
                    item.get("발언요약", item.get("상세발언", ""))
                ])
                
            if rows:
                worksheet.append_rows(rows)
                logger.info(f"구글 시트 '의원별 관심사' 탭에 {len(rows)}건 저장 완료.")
        except Exception as e:
            logger.error(f"Update Persona Tab Error: {e}")

if __name__ == "__main__":
    # 테스트용
    logging.basicConfig(level=logging.INFO)
    sync = SheetsSync()
