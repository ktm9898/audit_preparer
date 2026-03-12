import re
import html
import logging
import requests
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from difflib import SequenceMatcher

import nltk
try:
    nltk.data.find('tokenizers/punkt_tab')
except LookupError:
    nltk.download('punkt_tab', quiet=True)

from newspaper import Article

from backend.config import (
    NAVER_CLIENT_ID,
    NAVER_CLIENT_SECRET,
    NAVER_SEARCH_URL,
    SIMILARITY_THRESHOLD,
    NEWS_LOOKBACK_DAYS,
)
from backend.modules.sheets_manager import SheetsManager

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

class NewsEngine:
    """서울신용보증재단 관련 뉴스 수집 및 처리 엔진"""

    def __init__(self, sheets_manager: SheetsManager):
        self.sheets = sheets_manager
        self.headers = {
            "X-Naver-Client-Id": NAVER_CLIENT_ID,
            "X-Naver-Client-Secret": NAVER_CLIENT_SECRET,
        }

    def _clean_html(self, text: str) -> str:
        text = html.unescape(text)
        text = re.sub(r"<[^>]+>", "", text)
        return text.strip()

    def search_naver_news(self, keyword: str, display: int = 100) -> list[dict]:
        params = {
            "query": keyword,
            "display": display,
            "start": 1,
            "sort": "date",
        }
        try:
            resp = requests.get(NAVER_SEARCH_URL, headers=self.headers, params=params, timeout=10)
            resp.raise_for_status()
            return resp.json().get("items", [])
        except Exception as e:
            logger.error(f"Naver News API 검색 실패: {e}")
            return []

    def collect_incremental(self):
        """증분 뉴스 수집 실행"""
        keyword = "서울신용보증재단"
        items = self.search_naver_news(keyword)
        existing_links = self.sheets.get_existing_links()
        
        new_news = []
        now = datetime.now(KST)
        lookback_limit = now - timedelta(days=NEWS_LOOKBACK_DAYS)
        
        for item in items:
            link = item.get("originallink") or item.get("link", "")
            if link in existing_links:
                continue
            
            pub_date_str = item.get("pubDate", "")
            try:
                pub_dt = parsedate_to_datetime(pub_date_str).astimezone(KST)
            except:
                pub_dt = now # 파싱 실패 시 오늘로 간주
            
            if pub_dt < lookback_limit:
                continue

            title = self._clean_html(item.get("title", ""))
            description = self._clean_html(item.get("description", ""))
            
            if keyword not in title and keyword not in description:
                continue

            new_news.append({
                "날짜": pub_dt.strftime("%Y-%m-%d"),
                "언론사": self._extract_source(link),
                "제목": title,
                "네이버 요약": description,
                "링크": link,
                "수집일": now.strftime("%Y-%m-%d")
            })

        if new_news:
            # 제목 유사도 기반 중복 배제
            unique_new = self._deduplicate(new_news, existing_titles=self._get_existing_titles())
            self.sheets.append_news(unique_new)
            logger.info(f"신규 뉴스 {len(unique_new)}건 추가 완료")
            return unique_new
        return []

    def _extract_source(self, url: str) -> str:
        from urllib.parse import urlparse
        domain = urlparse(url).netloc.replace("www.", "")
        return domain.split('.')[0]

    def _get_existing_titles(self) -> set[str]:
        all_news = self.sheets.get_all_news_raw()
        return {n.get("제목", "") for n in all_news}

    def _deduplicate(self, news_list: list[dict], existing_titles: set[str]) -> list[dict]:
        unique = []
        for news in news_list:
            title = news.get("제목", "")
            is_dup = False
            for ext in existing_titles:
                if SequenceMatcher(None, title, ext).ratio() >= SIMILARITY_THRESHOLD:
                    is_dup = True
                    break
            if not is_dup:
                unique.append(news)
                existing_titles.add(title)
        return unique
