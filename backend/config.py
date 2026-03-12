import os
from dotenv import load_dotenv

load_dotenv()

# API Keys
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
NAVER_CLIENT_ID = os.getenv("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET")
NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/news.json"

# Google Sheets
GOOGLE_SHEET_ID = os.getenv("GOOGLE_SHEET_ID")
GOOGLE_CREDENTIALS_PATH = os.getenv("GOOGLE_CREDENTIALS_PATH", "credentials/service_account.json")

# Tabs
TAB_PERSONA = "의원별 페르소나"
TAB_NEWS = "최근 뉴스"
TAB_RISKS = "리스크 요인"
TAB_QUESTIONS = "예상 질문"

# Headers
HEADERS_PERSONA = ["의원명", "소속", "주요 관심사", "질문 스타일", "공격 포인트", "마지막 업데이트"]
HEADERS_NEWS = ["날짜", "언론사", "제목", "네이버 요약", "링크", "수집일"]
HEADERS_RISKS = ["리스크 요인", "세부 내용", "관련 근거", "마지막 업데이트"]
HEADERS_QUESTIONS = ["의원명", "질문", "답변(모범답안)", "근거(뉴스/보고서)", "공격포인트", "관련 리스크", "생성일"]

# Analysis Settings
NEWS_LOOKBACK_DAYS = 365
MIN_RISK_FACTORS = 10
QUESTION_COUNT = 25
SIMILARITY_THRESHOLD = 0.8
