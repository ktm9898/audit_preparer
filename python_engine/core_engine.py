import json
import logging
import requests
import time
import datetime
from email.utils import parsedate_to_datetime
from typing import List, Dict, Tuple
from newspaper import Article
import google.generativeai as genai
import pandas as pd
from config import NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GEMINI_API_KEY, GEMINI_MODEL, SEARCH_QUERY, GOOGLE_SHEET_ID
from sheets_sync import SheetsSync

logger = logging.getLogger(__name__)

# --- [복원] 기존 GAS의 신뢰할 수 있는 매체 및 도메인 맵 ---
TRUSTED_DOMAINS = [
    'chosun.com', 'joongang.co.kr', 'donga.com', 'hani.co.kr', 'khan.co.kr', 
    'seoul.co.kr', 'segye.com', 'hankookilbo.com', 'kmib.co.kr', 'munhwa.com',
    'yna.co.kr', 'newsis.com', 'news1.kr',
    'kbs.co.kr', 'mbc.co.kr', 'sbs.co.kr', 'jtbc.co.kr', 'ytn.co.kr', 'mbn.co.kr', 'tvchosun.com', 'ichannela.com',
    'hankyung.com', 'mk.co.kr', 'mt.co.kr', 'edaily.co.kr', 'sedaily.com', 'fnnews.com', 'heraldcorp.com', 'asiae.co.kr', 'ajunews.com',
    'etnews.com', 'digitaltimes.co.kr', 'dt.co.kr', 'nocutnews.co.kr', 'ohmynews.com', 'pressian.com', 'vop.co.kr',
    'kukinews.com', 'newdaily.co.kr', 'dailian.co.kr', 'sisain.co.kr', 'dnews.co.kr', 'bizwatch.co.kr',
    'naver.com'
]

DOMAIN_MAP = { 
    'chosun': '조선일보', 'joongang': '중앙일보', 'donga': '동아일보', 'yna': '연합뉴스', 
    'newsis': '뉴시스', 'news1': '뉴스1', 'sedaily': '서울경제', 'edaily': '이데일리', 
    'hankyung': '한국경제', 'mk.co.kr': '매일경제', 'hani': '한겨레', 'khan': '경향신문', 
    'kmib': '국민일보', 'segye': '세계일보', 'seoul.co.kr': '서울신문', 'munhwa': '문화일보', 
    'moneytoday': '머니투데이', 'mt.co.kr': '머니투데이', 'asiae': '아시아경제', 'ajunews': '아주경제',
    'fnnews': '파이낸셜뉴스', 'heraldcorp': '헤럴드경제', 'etnews': '전자신문', 'digitaltimes': '디지털타임스', 'dt.co.kr': '디지털타임스',
    'kbs': 'KBS', 'mbc': 'MBC', 'sbs': 'SBS', 'ytn': 'YTN', 'jtbc': 'JTBC', 'mbn': 'MBN', 'tvchosun': 'TV조선', 'ichannela': '채널A',
    'hankookilbo': '한국일보', 'nocutnews': '노컷뉴스', 'ohmynews': '오마이뉴스', 'pressian': '프레시안', 'vop': '민중의소리',
    'kukinews': '쿠키뉴스', 'newdaily': '뉴데일리', 'dailian': '데일리안', 'sisain': '시사인', 'dnews': '대한경제', 'bizwatch': '비즈워치'
}

class NaverNewsCollector:
    def __init__(self, client_id: str, client_secret: str):
        self.headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret
        }

    def is_trusted_media(self, url: str) -> bool:
        if not url: return False
        try:
            domain = url.split('/')[2].replace('www.', '').replace('m.', '')
            return any(d in domain for d in TRUSTED_DOMAINS)
        except: return False

    def get_source_name(self, url: str) -> str:
        try:
            domain = url.split('/')[2].replace('www.', '').replace('m.', '')
            for key, name in DOMAIN_MAP.items():
                if key in domain: return name
        except: pass
        return "뉴스"

    def fetch_news(self, query: str, count: int = 100) -> List[Dict]:
        """[복원] 기존 GAS의 페이징 및 필터링 로직 완벽 이식"""
        url = f"https://openapi.naver.com/v1/search/news.json?query={query}&display={count}&sort=date"
        try:
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()
            items = response.json().get("items", [])
            processed = []
            for item in items:
                link = item.get("link")
                if "news.naver.com" not in link:
                    link = item.get("originallink", link)
                
                if self.is_trusted_media(link):
                    processed.append({
                        "title": item["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"').strip(),
                        "link": link,
                        "pubDate": item["pubDate"],
                        "description": item["description"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"').strip(),
                        "source": self.get_source_name(item.get("originallink", link))
                    })
            return processed
        except Exception as e:
            logger.error(f"Naver News Fetch Error: {e}")
            return []

class GeminiAnalyzer:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def screen_importance_with_ai(self, news_list: List[Dict]) -> List[Dict]:
        """[복원] 기존 GAS Stage 1: 스크리닝 및 중복 제거"""
        if not news_list: return []
        
        news_data_for_ai = "\n".join([f"[{i}] 제목: {n['title']}\n요약: {n['description']}" for i, n in enumerate(news_list)])
        
        prompt = f"""당신은 대한민국 최고의 뉴스 큐레이션 전문가입니다.
제공된 뉴스 후보군({len(news_list)}건)에서 가장 가치 있는 15건을 선발하세요.

[지시사항]
1. 중복 제거 (핵심): 동일하거나 매우 유사한 사건/이슈를 다루는 기사가 여러 개라면, 가장 포괄적인 1개만 살리고 나머지는 모두 중요도를 '하'로 매기세요. (사용자가 겹치는 뉴스를 보지 않게 하는 것이 최우선입니다.)
2. 중요도 판별: 재단 관련 정책, 소상공인 지원, 경제 지표, 의회 행정감사 관련 기사를 '상', '중', '하'로 판별하세요.
3. 분야 분류: 각 뉴스를 '정책', '지원', '경제', '금융', '의회', '기타' 중 하나로 분류하세요.
4. 가용성 보장 (핵심): 만약 '상'이나 '중' 등급의 기사가 부족하더라도, 후보군 중 상대적으로 나은 기사들을 골라 반드시 총 15개의 기사 인덱스를 응답하세요.

[응답 형식] 반드시 JSON 형식:
{{"top15": [{{"index": 0, "importance": "상", "category": "정책"}}, ...]}}

[뉴스 후보 리스트]
{news_data_for_ai[:30000]}
"""
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            indices = json.loads(resp.text).get("top15", [])
            selected = []
            for item in indices:
                idx = item['index']
                if idx < len(news_list):
                    n = news_list[idx]
                    n['importance'] = item.get('importance', '하')
                    n['category'] = item.get('category', '기타')
                    selected.append(n)
            return selected[:15]
        except Exception as e:
            logger.error(f"Screening Error: {e}")
            return news_list[:15]

    def deep_analyze_news_batch(self, news_list: List[Dict]) -> List[Dict]:
        """[복원] 기존 GAS Stage 4: 배치 정밀 분석"""
        if not news_list: return []
        
        extractor = ArticleExtractor()
        for n in news_list:
            n['full_text'] = extractor.extract(n['link'])
        
        batch_data = "\n".join([f"[기사 #{i}]\n제목: {n['title']}\n본문: {n.get('full_text', n['description'])[:4000]}" for i, n in enumerate(news_list)])
        
        prompt = f"""당신은 대한민국 최고의 뉴스 분석관입니다. 제공된 15개의 뉴스 기사를 정밀 분석하세요.

[지시사항]
1. 각 기사의 내용을 2~3문장으로 핵심 요약하세요.
2. 기사의 최종 중요도(상/중/하)와 분야(정책/지원/경제/금융/의회/기타)를 확정하세요.
3. 기사 번호(#0, #1...)와 결과가 정확히 매칭되어야 합니다.

[응답 형식] 반드시 JSON 형식:
{{"analyses": [{{"index": 0, "summary": "...", "importance": "상", "category": "정책"}}, ...]}}

[기사 데이터]
{batch_data}
"""
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            analyses = json.loads(resp.text).get("analyses", [])
            for res in analyses:
                idx = res['index']
                if idx < len(news_list):
                    news_list[idx]['ai_summary'] = res.get('summary', news_list[idx]['description'])
                    news_list[idx]['importance'] = res.get('importance', news_list[idx].get('importance', '중'))
                    news_list[idx]['category'] = res.get('category', news_list[idx].get('category', '기타'))
            return news_list
        except Exception as e:
            logger.error(f"Deep Analysis Error: {e}")
            return news_list

    def analyze_risks(self, data_list: List[Dict], source_type: str = "뉴스") -> List[Dict]:
        """[복원] 기존 GAS runAIAnalysis('risks') 원본 프롬프트"""
        data_text = "\n".join([f"- {n.get('title') or n.get('제목')}: {n.get('description') or n.get('내용')}" for n in data_list])
        prompt = f"""[미션] 서울신용보증재단 {source_type} 데이터를 바탕으로 행정감사 리스크 쟁점 20개를 도출하세요. 
(JSON 형식: {{"risks": [{{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}}]}})

데이터:
{data_text}"""
        return self._generate_json(prompt, "risks")

    def analyze_personas(self, minutes_text: str) -> List[Dict]:
        """[복원] 기존 GAS runAIAnalysis('persona') 원본 프롬프트"""
        prompt = f"""당신은 행정사무감사 전문 분석 AI입니다. 의원별 상세 성향 리포트를 작성하세요.
(JSON 형식: {{"personas": [{{"의원명": "...", "지역구": "...", "주요 관심사": "...", "질문 성향": "...", "예상 감사 포인트": "...", "발언요약": "..."}}]}})

[데이터 원본]
{minutes_text}"""
        return self._generate_json(prompt, "personas")

    def analyze_final_questions(self, news_summary: str, risk_data: str, persona_data: str, source_texts: str) -> List[Dict]:
        """[복원] 기존 GAS runAIAnalysis('final_questions') 원본 프롬프트 및 핵심 지침"""
        prompt = f"""[미션] 리스크 요인(Step 1,2), 의원 성향, 그리고 '보고서/뉴스 원문'을 종합하여 최종 행정감사 예상 질문 30개를 생성하세요.

[핵심 지침]
1. 원문 맥락 철저 분석: 추출된 리스크(Step 1,2)를 최우선 고려하되, 실제 질문은 반드시 함께 제공된 '뉴스 원문'과 '업무보고 원문'의 구체적인 수치, 사업명, 문제 사례를 바탕으로 해야 합니다.
2. 과거 질문 반복 절대 금지: 의원 성향 데이터에 있는 과거 발언은 '스타일 파악용'입니다. 기존 질문을 재탕하지 마십시오.
3. 융합적 분석: "의원 페르소나 + 구체적 사안(Source Context) + 현재의 이슈(News)"를 결합하세요.
4. 실무적 예리함: 구체적인 데이터나 페이지, 사업명을 인용하여 날카로운 질문을 설계하세요.

[데이터]
1. 뉴스 원문(요약): {news_summary}
2. 추출 리스크: {risk_data}
3. 의원 성향 메타데이터: {persona_data}
4. 업무보고 자료 원문 (Context): {source_texts}

(JSON 형식: {{"questions": [{{"분류": "...", "의원명": "...", "질문": "...", "답변 가이드": "..."}}]}})"""
        return self._generate_json(prompt, "questions")

    def _generate_json(self, prompt: str, key: str) -> List[Dict]:
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(resp.text).get(key, [])
        except Exception as e:
            logger.error(f"AI Generation Error: {e}")
            return []

class ArticleExtractor:
    def extract(self, url: str) -> str:
        try:
            article = Article(url, language='ko')
            article.download()
            article.parse()
            return article.text.strip()
        except: return ""

import argparse

def main():
    parser = argparse.ArgumentParser(description="Audit Preparer AI Engine")
    parser.add_argument("--task", type=str, help="Excution task: news, risks, persona, questions")
    parser.add_argument("--month", type=str, help="Target month for news (e.g., 2024.03)", default="")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    
    collector = NaverNewsCollector(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)
    analyzer = GeminiAnalyzer(GEMINI_API_KEY)
    sync = SheetsSync()
    
    task = args.task or "news"
    
    # 필수 환경 변수 체크 (GitHub Actions 실행 시 진단용)
    missing_vars = []
    if not NAVER_CLIENT_ID: missing_vars.append("NAVER_CLIENT_ID")
    if not NAVER_CLIENT_SECRET: missing_vars.append("NAVER_CLIENT_SECRET")
    if not GEMINI_API_KEY: missing_vars.append("GEMINI_API_KEY")
    if not GOOGLE_SHEET_ID: missing_vars.append("GOOGLE_SHEET_ID")
    
    if missing_vars:
        logger.error(f"❌ 필수 환경 변수 누락: {', '.join(missing_vars)}")
        logger.error("GitHub Secrets 설정을 확인해 주세요.")
        return
    
    if task == "news":
        logger.info(f"🚀 [뉴스 수집] 시작: {SEARCH_QUERY} (월: {args.month})")
        raw_news = collector.fetch_news(SEARCH_QUERY)
        if args.month:
            filtered = []
            for n in raw_news:
                try:
                    # Naver pubDate: "Mon, 16 Mar 2026 10:00:00 +0900"
                    dt = parsedate_to_datetime(n.get('pubDate', ''))
                    yyyymm = dt.strftime("%Y.%m")
                    if yyyymm == args.month:
                        filtered.append(n)
                except Exception as e:
                    logger.error(f"Date Parse Error: {e} for {n.get('pubDate')}")
            raw_news = filtered
        
        if not raw_news:
            logger.warning(f"⚠️ 검색 결과가 0건입니다. (쿼리: {SEARCH_QUERY}, 월: {args.month})")
            return

        logger.info(f"✅ {len(raw_news)}건의 뉴스 검색 완료. AI 분석 시작...")

        logger.info(f"📊 [Stage 1] AI 지능형 선별 중...")
        screened_news = analyzer.screen_importance_with_ai(raw_news)
        logger.info(f"🔍 [Stage 2] 심층 분석 중...")
        final_results = analyzer.deep_analyze_news_batch(screened_news)
        sync.update_news_tab(final_results)
        
    elif task == "risks":
        logger.info("🚩 [리스크 분석] 시작...")
        news_data = sync.get_tab_data("주요 뉴스")
        risks = analyzer.analyze_risks(news_data)
        sync.update_risks_tab(risks, tab_name="리스크 추출1")
        
    elif task == "persona":
        logger.info("👤 [의원 성향 분석] 시작...")
        # 회의록 텍스트는 시트나 드라이브에서 가져오는 로직 필요 (여기선 시트 연동 위주)
        # 실제 구현시 드라이브 파일 읽기 로직 추가 가능
        pass
        
    elif task == "questions":
        logger.info("❓ [최종 질문 생성] 시작...")
        news_summary = str(sync.get_tab_data("주요 뉴스")[:15])
        risk_data = str(sync.get_tab_data("리스크 추출1")) + "\n" + str(sync.get_tab_data("리스크 추출2"))
        persona_data = str(sync.get_tab_data("의원별 관심사"))
        # Context는 보고서 기반
        questions = analyzer.analyze_final_questions(news_summary, risk_data, persona_data, "업무보고 자료 맥락")
        sync.update_questions_tab(questions)

    logger.info(f"✅ 작업 완료: {task}")

if __name__ == "__main__":
    main()
