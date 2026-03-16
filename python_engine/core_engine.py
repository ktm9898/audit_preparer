import json
import logging
import requests
import time
from typing import List, Dict, Tuple
from newspaper import Article
import google.generativeai as genai
import pandas as pd
from config import NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GEMINI_API_KEY, GEMINI_MODEL, SEARCH_QUERY

logger = logging.getLogger(__name__)

class NaverNewsCollector:
    """네이버 뉴스 검색 API 수집기"""
    def __init__(self, client_id: str, client_secret: str):
        self.headers = {
            "X-Naver-Client-Id": client_id,
            "X-Naver-Client-Secret": client_secret
        }

    def fetch_news(self, query: str, count: int = 50) -> List[Dict]:
        """네이버 뉴스 검색 결과 반환"""
        url = f"https://openapi.naver.com/v1/search/news.json?query={query}&display={count}&sort=date"
        try:
            response = requests.get(url, headers=self.headers)
            response.raise_for_status()
            items = response.json().get("items", [])
            processed = []
            for item in items:
                # 네이버 인링크 우선
                link = item.get("link")
                if "news.naver.com" not in link:
                    link = item.get("originallink", link)
                
                processed.append({
                    "title": item["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"'),
                    "link": link,
                    "pubDate": item["pubDate"],
                    "description": item["description"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"')
                })
            return processed
        except Exception as e:
            logger.error(f"Naver News Fetch Error: {e}")
            return []

class ContentExtractor:
    """뉴스 본문 추출기 (newspaper4k)"""
    def extract(self, url: str) -> str:
        try:
            article = Article(url, language='ko')
            article.download()
            article.parse()
            return article.text.strip()
        except Exception as e:
            logger.warning(f"Content Extract Error ({url}): {e}")
            return ""

class GeminiAnalyzer:
    """Gemini를 이용한 뉴스 분석기"""
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def screen_and_analyze(self, news_list: List[Dict]) -> List[Dict]:
        """1단계: 스크리닝(중복 제거 및 선별) + 2단계: 심층분석(요약, 중요도, 카테고리)"""
        if not news_list:
            return []

        # 1단계용 텍스트 구성
        screening_text = "\n".join([f"[{i}] {n['title']}\n요약: {n['description']}" for i, n in enumerate(news_list)])
        
        prompt_screen = f"""당신은 행정사무감사 준비를 위한 뉴스 전문가입니다. 
제공된 뉴스 리스트에서 '서울신용보증재단'과 직접 관련이 있거나 소상공인 지원 정책, 행정사무감사 쟁점이 될만한 핵심 기사 15개를 선발하세요.
유사한 내용의 기사는 중복을 제거하고 가장 상세한 것 하나만 선택하세요.

반드시 JSON 형식으로 응답:
{{"top15_indices": [0, 3, 5, ...]}}

[뉴스 리스트]
{screening_text}
"""
        try:
            response = self.model.generate_content(prompt_screen, generation_config={"response_mime_type": "application/json"})
            indices = json.loads(response.text).get("top15_indices", [])
            selected_news = [news_list[i] for i in indices if i < len(news_list)]
        except Exception as e:
            logger.error(f"Screening Error: {e}")
            selected_news = news_list[:15]

        # 2단계: 심층 분석 (본문 기반)
        extractor = ContentExtractor()
        results = []
        
        for news in selected_news:
            body = extractor.extract(news['link'])
            content = body if len(body) > 100 else news['description']
            
            prompt_analyze = f"""아래 뉴스 본문을 분석하여 3문장 이내로 핵심 요약하고, 중요도(상, 중, 하)와 카테고리(정책, 지원, 경제, 금융, 의회, 기타)를 판별하세요.

제목: {news['title']}
본문: {content}

반드시 JSON 형식으로 응답:
{{"summary": "...", "importance": "상/중/하", "category": "정책/지원/..."}}
"""
            try:
                # 배치 처리를 위해 묶어서 호출하는 것이 좋으나, 여기서는 개별 호출로 단순화 (나중에 최적화 가능)
                resp = self.model.generate_content(prompt_analyze, generation_config={"response_mime_type": "application/json"})
                analysis = json.loads(resp.text)
                news.update({
                    "ai_summary": analysis.get("summary", ""),
                    "importance": analysis.get("importance", "중"),
                    "category": analysis.get("category", "기타"),
                    "full_text": body
                })
            except Exception as e:
                logger.error(f"Analysis Error for {news['title']}: {e}")
                news.update({"ai_summary": news['description'], "importance": "중", "category": "기타", "full_text": body})
            
            results.append(news)
            time.sleep(1) # Rate limit 방지
            
    def analyze_risks(self, news_list: List[Dict], source_type: str = "news") -> List[Dict]:
        """행정감사 리스크 쟁점 도출 (기존 GAS 정밀 프롬프트 복원)"""
        data_text = "\n".join([f"[{n.get('date', '')}] {n.get('title', '')}" for n in news_list])
        
        prompt = f"""[미션] 서울신용보증재단 {source_type} 데이터를 바탕으로 행정감사 리스크 쟁점 20개를 도출하세요. 

[지시사항]
1. 단순 나열이 아닌, 실제 행정사무감사에서 질의가 가능한 '쟁점' 위주로 도출하세요.
2. 각 리스크별로 구체적인 '세부 내용'과 근거가 되는 '관련 뉴스/문서'를 명시하세요.
3. 예상되는 파급력과 재단의 대응 필요성을 고려하여 선정하세요.

반드시 JSON 형식으로 응답:
{{"risks": [{{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}}]}}

[데이터]
{data_text}
"""
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(resp.text).get("risks", [])
        except Exception as e:
            logger.error(f"Risk Analysis Error: {e}")
            return []

    def analyze_personas(self, minutes_text: str) -> List[Dict]:
        """의원별 상세 성향 리포트 작성 (기존 GAS 정밀 프롬프트 복원)"""
        prompt = f"""당신은 행정사무감사 전문 분석 AI입니다. 제공된 회의록을 분석하여 의원별 상세 성향 리포트를 작성하세요.

[지시사항]
1. 의원별로 주요 관심 분야, 질문의 날카로움(성향), 주로 공격하는 포인트 등을 정밀하게 파악하세요.
2. '발언 요약'은 해당 의원의 핵심 주장을 한눈에 알 수 있게 작성하세요.
3. 재단 입장에서는 어떤 대응 논리가 필요할지도 염두에 두어 '예상 감사 포인트'를 도출하세요.

반드시 JSON 형식으로 응답:
{{"personas": [{{
    "의원명": "...", 
    "지역구": "...", 
    "주요 관심사": "...", 
    "질문 성향": "...", 
    "예상 감사 포인트": "...", 
    "발언요약": "..."
}}]}}

[회의록 데이터]
{minutes_text}
"""
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(resp.text).get("personas", [])
        except Exception as e:
            logger.error(f"Persona Analysis Error: {e}")
            return []

    def analyze_final_questions(self, news_data: str, risk_data: str, persona_data: str, report_context: str) -> List[Dict]:
        """최종 행정감사 예상 질문 생성 (기존 GAS 정밀 프롬프트 및 핵심 지침 완벽 복원)"""
        prompt = f"""[미션] 리스크 요인(Step 1,2), 의원 성향, 그리고 '보고서/뉴스 원문'을 종합하여 최종 행정감사 예상 질문 30개를 생성하세요.

[핵심 지침]
1. 원문 맥락 철저 분석: 추출된 리스크를 최우선 고려하되, 실제 질문은 반드시 함께 제공된 '뉴스 원문'과 '업무보고 원문'의 구체적인 수치, 사업명, 문제 사례를 바탕으로 해야 합니다.
2. 과거 질문 반복 절대 금지: 의원 성향 데이터에 있는 과거 발언은 '스타일 파악용'입니다. 기존 질문을 재탕하지 마십시오.
3. 융합적 분석: "의원 페르소나 + 구체적 사안(Source Context) + 현재의 이슈(News)"를 결합하세요.
4. 실무적 예리함: 구체적인 데이터나 페이지, 사업명을 인용하여 날카로운 질문을 설계하세요.

[데이터]
1. 뉴스 원문(요약): {news_data}
2. 추출 리스크: {risk_data}
3. 의원 성향 메타데이터: {persona_data}
4. 업무보고 자료 원문 (Context): {report_context}

반드시 JSON 형식으로 응답:
{{"questions": [{{
    "분류": "...", 
    "의원명": "...", 
    "질문": "...", 
    "답변 가이드": "..."
}}]}}
"""
        try:
            resp = self.model.generate_content(prompt, generation_config={"response_mime_type": "application/json"})
            return json.loads(resp.text).get("questions", [])
        except Exception as e:
            logger.error(f"Question Analysis Error: {e}")
            return []

from sheets_sync import SheetsSync

def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    
    if not all([NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GEMINI_API_KEY, GOOGLE_SHEET_ID]):
        logger.error("환경 변수가 설정되지 않았습니다. .env 파일을 확인하세요.")
        return

    collector = NaverNewsCollector(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)
    analyzer = GeminiAnalyzer(GEMINI_API_KEY)
    sync = SheetsSync()
    
    logger.info(f"🚀 뉴스 수집 및 분석 파이프라인 시작: {SEARCH_QUERY}")
    news = collector.fetch_news(SEARCH_QUERY)
    
    if not news:
        logger.warning("수집된 뉴스가 없습니다.")
        return

    logger.info(f"📊 {len(news)}건 수집 완료. AI 분석 및 본문 추출 시작...")
    final_results = analyzer.screen_and_analyze(news)
    
    logger.info(f"💾 분석 완료: {len(final_results)}건. 구글 시트 '주요 뉴스' 탭 업로드 중...")
    sync.update_news_tab(final_results)
    
    logger.info("✅ 모든 작업이 성공적으로 완료되었습니다.")

if __name__ == "__main__":
    main()
