import os
from dotenv import load_dotenv

load_dotenv()

# API Keys
NAVER_CLIENT_ID = os.environ.get("NAVER_CLIENT_ID")
NAVER_CLIENT_SECRET = os.environ.get("NAVER_CLIENT_SECRET")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")

# Google Sheets
GOOGLE_SHEET_ID = os.environ.get("GOOGLE_SHEET_ID")
# service_account.json 경로 또는 JSON 문자열
GOOGLE_CREDENTIALS_JSON = os.environ.get("GOOGLE_CREDENTIALS_JSON")

# Google Drive
GOOGLE_DRIVE_FOLDER_ID = os.environ.get("GOOGLE_DRIVE_FOLDER_ID") # 이름 검색 실패 시 대비용 폴더 ID

# Search Settings
SEARCH_QUERY = "서울신용보증재단"
MAX_NEWS_COUNT = 15

# Gemini Settings
# Gemini Settings
GEMINI_MODEL = "gemini-3-flash-preview" # 사용자 요청 최신 모델
