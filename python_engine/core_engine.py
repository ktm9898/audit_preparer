import json
import logging
import requests
import time
import datetime
import warnings
warnings.filterwarnings("ignore", category=FutureWarning) # 구글 SDK 경고 숨김
from email.utils import parsedate_to_datetime
from typing import List, Dict, Tuple
from newspaper import Article, Config
import google.generativeai as genai
import pandas as pd
import nltk
from config import NAVER_CLIENT_ID, NAVER_CLIENT_SECRET, GEMINI_API_KEY, GEMINI_MODEL, SEARCH_QUERY, GOOGLE_SHEET_ID

# --- NLTK 리소스 사전 로드 (GitHub Actions 등 환경 대응) ---
try:
    nltk.download('punkt', quiet=True)
    nltk.download('punkt_tab', quiet=True)
except Exception as e:
    print(f"NLTK Download Warning: {e}")
from sheets_sync import SheetsSync
from drive_sync import DriveSync

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
    'hankyung': '한국경제', 'mk': '매일경제', 'hani': '한겨레', 'khan': '경향신문', 
    'kmib': '국민일보', 'segye': '세계일보', 'seoul': '서울신문', 'munhwa': '문화일보', 
    'moneytoday': '머니투데이', 'mt.co.kr': '머니투데이', 'asiae': '아시아경제', 'ajunews': '아주경제',
    'fnnews': '파이낸셜뉴스', 'heraldcorp': '헤럴드경제', 'etnews': '전자신문', 'digitaltimes': '디지털타임스', 'dt.co.kr': '디지털타임스',
    'kbs': 'KBS', 'mbc': 'MBC', 'sbs': 'SBS', 'ytn': 'YTN', 'jtbc': 'JTBC', 'mbn': 'MBN', 'tvchosun': 'TV조선', 'ichannela': '채널A',
    'hankookilbo': '한국일보', 'nocutnews': '노컷뉴스', 'ohmynews': '오마이뉴스', 'pressian': '프레시안', 'vop': '민중의소리',
    'kukinews': '쿠키뉴스', 'newdaily': '뉴데일리', 'dailian': '데일리안', 'sisain': '시사인', 'dnews': '대한경제', 'bizwatch': '비즈워치',
    '417': '머니S', '003': '뉴시스', '025': '중앙일보', '119': '데일리안', '009': '매일경제', '021': '문화일보', '018': '이데일리', '629': '더팩트', '421': '뉴스1', '001': '연합뉴스', '081': '서울신문'
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
        """인링크 및 원문 링크 분석을 통한 정확한 언론사 명칭 추출"""
        try:
            # 1. Naver News Inlink 특수 구조 처리 (인링크 우선)
            # URL 예: https://n.news.naver.com/mnews/article/001/0015956232
            if "news.naver.com" in url:
                parts = url.split('/')
                for i, part in enumerate(parts):
                    if part == "article" and i + 1 < len(parts):
                        aid = parts[i+1] # 언론사 ID (001 등)
                        if aid in DOMAIN_MAP: return DOMAIN_MAP[aid]

            # 2. 도메인 기반 검색 (원문 링크 등)
            domain = url.split('/')[2].replace('www.', '').replace('m.', '')
            for key, name in DOMAIN_MAP.items():
                if key in domain: return name
        except: pass
        return "뉴스"

    def fetch_news(self, query: str, max_count: int = 1000) -> List[Dict]:
        """네이버 API 페이징을 통해 최대 1,000건의 뉴스 수집"""
        processed = []
        display = 100
        
        # 네이버 API는 start 파라미터 최대값이 1000임
        for start in range(1, max_count + 1, display):
            url = f"https://openapi.naver.com/v1/search/news.json?query={query}&display={display}&start={start}&sort=date"
            try:
                response = requests.get(url, headers=self.headers)
                response.raise_for_status()
                items = response.json().get("items", [])
                
                if not items: break
                
                for item in items:
                    link = item.get("link")
                    if "news.naver.com" not in link:
                        link = item.get("originallink", link)
                    
                    if self.is_trusted_media(link):
                        title = item["title"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"').strip()
                        desc = item["description"].replace("<b>", "").replace("</b>", "").replace("&quot;", '"').strip()
                        
                        # 엄격한 키워드 필터링: 제목이나 설명에 재단 명칭이 반드시 포함되어야 함
                        target_keywords = ["서울신용보증재단", "서울신보"]
                        if any(kw in title or kw in desc for kw in target_keywords):
                            processed.append({
                                "title": title,
                                "link": link,
                                "pubDate": item["pubDate"],
                                "description": desc,
                                "source": self.get_source_name(item.get("originallink", link))
                            })
                
                # 너무 빠른 요청 방지
                time.sleep(0.1)
            except Exception as e:
                logger.error(f"Naver News Fetch Error at start {start}: {e}")
                break
        
        return processed

class GeminiAnalyzer:
    def __init__(self, api_key: str):
        genai.configure(api_key=api_key)
        # 사용자 요청 최신 모델 강제 고정
        self.model_id = GEMINI_MODEL or "gemini-3-flash-preview"
        self.model = genai.GenerativeModel(self.model_id)

    def screen_importance_with_ai(self, news_list: List[Dict]) -> List[Dict]:
        """[복원] 기존 GAS Stage 1: 스크리닝 및 중복 제거"""
        if not news_list: return []
        
        news_data_for_ai = "\n".join([f"[{i}] 제목: {n['title']}\n요약: {n['description']}" for i, n in enumerate(news_list)])
        
        prompt = f"""당신은 대한민국 최고의 뉴스 큐레이션 전문가입니다.
제공된 뉴스 후보군({len(news_list)}건)에서 가장 가치 있는 15건을 선발하세요.

[지시사항]
1. 중복 제거 (핵심): 동일하거나 매우 유사한 사건/이슈를 다루는 기사가 여러 개라면, 가장 포괄적인 1개만 살리고 나머지는 모두 중요도를 '하'로 매기세요.
2. 중요도 판별: 중요도는 반드시 '상', '중', '하' 중 하나만 사용하세요.
3. 분야 분류 (중요): 분야는 반드시 '정책', '지원', '경제', '금융', '의회', '기타' 중 하나만 사용하세요. (중요도 '상/중/하'를 분야 칸에 넣지 마세요!)
4. 가용성 보장: 후보군 중 가장 나은 기사들을 골라 반드시 총 15개의 기사 인덱스를 응답하세요.

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
        logger.info(f"📊 [{source_type} 리스크 분석] 대상 데이터: {len(data_list)}건")
        if not data_list:
            return []
        data_text = "\n".join([f"- {n.get('title') or n.get('제목')}: {n.get('description') or n.get('내용')}" for n in data_list])
        prompt = f"""[미션] 서울신용보증재단 {source_type} 데이터를 바탕으로 행정감사 리스크 쟁점 20개를 도출하세요. 
(JSON 형식: {{"risks": [{{"리스크 요인": "...", "세부 내용": "...", "관련 근거": "..."}}]}})

[지시사항]
1. 구체성 원칙: '운영 미흡', '관리 필요'와 같은 추상적인 표현은 지양하세요. 
2. 상세 인용: 반드시 본문에 등장하는 '특정 사업명', '예산 금액', '날짜', '지적된 문제 수치'를 포함하여 작성하세요.
3. 근거 명시: '관련 근거' 칸에는 해당 리스크가 언급된 기사 제목이나 보고서의 장/절 제목을 명시하세요.
4. 보고서 특화: 특히 {source_type}가 '보고서'인 경우, 사업의 효율성 저하나 집행률 저조 등 실질적인 지표 위주로 분석하세요.
5. 간결성 유지: 리스크 세부 내용은 너무 길지 않게 2문장 내외로 핵심만 요약하세요. 보고서 형태가 아닌 리스크 요약본임을 명심하세요.

데이터:
{data_text}"""
        return self._generate_json(prompt, "risks")

    def analyze_personas(self, minutes_text: str) -> List[Dict]:
        """[복원] 기존 GAS runAIAnalysis('persona') 원본 프롬프트"""
        logger.info(f"👤 [의원 성향 분석] 대상 텍스트 길이: {len(minutes_text)}자")
        if len(minutes_text) < 10:
            return []
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
4. 실무적 예리함: "ㅇㅇ사업 예산 집행률 70% 미달 사유는?"과 같이 구체적인 데이터나 페이지, 사업명을 인용하여 날카로운 질문을 설계하세요.
5. 답변 가이드 간결화: 답변 가이드는 대책 위주로 짧고 명확하게 작성하세요. 장황한 설명은 지양합니다.

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
            # 1. Newspaper4k 시도
            text = ""
            try:
                config = Config()
                config.browser_user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
                article = Article(url, language='ko', config=config)
                article.download()
                article.parse()
                text = article.text.strip()
            except Exception as inner_e:
                logger.warning(f"Newspaper4k Fail: {inner_e} for {url}")
            
            # 본문이 충분히 길면 성공으로 간주
            if len(text) > 400: return text
            
            # 2. BeautifulSoup 기반 백업
            from bs4 import BeautifulSoup
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"}
            resp = requests.get(url, headers=headers, timeout=10)
            soup = BeautifulSoup(resp.content, 'html.parser', from_encoding='utf-8')
            
            # 네이버 뉴스 특화 본문 선택자들
            content = soup.select_one('#newsct_article') or soup.select_one('#articleBodyContents') or soup.select_one('#dic_area') or soup.select_one('#articleBody')
            if content:
                for tag in content.select('.article_footer, .article_info, .modify_info, .img_desc, script, style'): 
                    tag.decompose()
                return content.get_text().strip()
            
            return text if text else ""
        except Exception as e:
            logger.error(f"Extract Error: {str(e)} for {url}")
            return ""

import argparse

def main():
    parser = argparse.ArgumentParser(description="Audit Preparer AI Engine")
    parser.add_argument("--task", type=str, help="Excution task: news, risks, persona, questions")
    parser.add_argument("--month", type=str, help="Target month for news (e.g., 2024.03)", default="")
    parser.add_argument("--file_id", type=str, help="Target file ID in Google Drive", default="")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
    
    collector = NaverNewsCollector(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)
    analyzer = GeminiAnalyzer(GEMINI_API_KEY)
    sync = SheetsSync()
    # 디버깅용 시트 ID 마스킹 출력
    masked_id = f"{GOOGLE_SHEET_ID[:5]}...{GOOGLE_SHEET_ID[-5:]}" if GOOGLE_SHEET_ID else "None"
    logger.info(f"📍 연결된 구글 시트 ID: {masked_id}")
    
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
                    n['pubDate'] = dt.strftime("%Y.%m.%d") # 시트 표시용 날짜 고정
                    if yyyymm == args.month:
                        filtered.append(n)
                except Exception as e:
                    logger.error(f"Date Parse Error: {e} for {n.get('pubDate')}")
            raw_news = filtered
        
        if not raw_news:
            logger.warning(f"⚠️ 검색 결과가 0건입니다. (쿼리: {SEARCH_QUERY}, 월: {args.month})")
            return

        # [교정] '지능형 중복 제거'는 AI가 수행함 (가져온 기사들끼리 비교)
        # 따라서 시트 링크 기반 강제 제외 로직을 제거하여 AI가 전체 맥락을 보도록 함
        logger.info(f"✅ {len(raw_news)}건의 뉴스 검색 완료. AI 중복 제거 및 분석 시작...")

        logger.info(f"📊 [Stage 1] AI 지권형 중복 제거 및 선별 중...")
        # 이 단계에서 AI가 비슷한 기사를 클러스터링하고 1개만 중요도를 높게 매깁니다.
        screened_news = analyzer.screen_importance_with_ai(raw_news)
        
        logger.info(f"🔍 [Stage 2] 심층 분석 중...")
        final_results = analyzer.deep_analyze_news_batch(screened_news)
        sync.update_news_tab(final_results)
        
    elif task == "risks":
        logger.info("🚩 [리스크 분석 1단계] 시작...")
        news_data = sync.get_tab_data("주요 뉴스")
        risks = analyzer.analyze_risks(news_data, source_type="뉴스")
        sync.update_risks_tab(risks, tab_name="리스크 추출1")
        
    elif task == "report_risks":
        logger.info("🚩 [리스크 분석 2단계 - 업무보고] 시작...")
        drive = DriveSync()
        target_file_id = args.file_id if args.file_id else None
        
        # 1. 파일 목록 가져오기
        files = drive.get_report_files(target_file_id)
        
        if not files:
            logger.warning("분석할 업무보고 파일이 없습니다.")
            report_data = [{"제목": "업무보고 없음", "내용": "분석할 파일이 없습니다."}]
        else:
            report_data = []
            for f in files:
                logger.info(f"📄 파일 파싱 중: {f['name']}")
                text = drive.extract_text_from_file(f['id'], f.get('mimeType', ''), f['name'])
                if text:
                    report_data.append({"제목": f['name'], "내용": text[:15000]}) # 내용이너무길면자름
            
            if not report_data:
                report_data = [{"제목": "파싱 실패", "내용": "파일에서 텍스트를 추출하지 못했습니다."}]
                
        risks2 = analyzer.analyze_risks(report_data, source_type="보고서")
        sync.update_risks_tab(risks2, tab_name="리스크 추출2")
        
    elif task == "persona":
        logger.info("👤 [의원 성향 분석] 시작...")
        drive = DriveSync()
        target_file_id = args.file_id if args.file_id else None
        
        # 1. 회의록 파일 목록 가져오기
        files = drive.get_minutes_files(target_file_id)
        
        if not files:
            logger.warning("분석할 회의록 파일이 없습니다.")
            minutes_text = "회의록 데이터가 없습니다."
        else:
            texts = []
            for f in files:
                logger.info(f"📄 회의록 파싱 중: {f['name']}")
                text = drive.extract_text_from_file(f['id'], f.get('mimeType', ''), f['name'])
                if text:
                    texts.append(text[:20000]) # 회의록은 특히 길 수 있으므로 적절히 자름
            minutes_text = "\n\n".join(texts)
            
        personas = analyzer.analyze_personas(minutes_text)
        sync.update_persona_tab(personas)
        
    elif task == "questions":
        logger.info("❓ [최종 질문 생성] 시작...")
        drive = DriveSync()
        
        # 컨텍스트 보강을 위해 업무보고 파일들 가져오기
        files = drive.get_report_files()
        context_texts = []
        for f in files:
            text = drive.extract_text_from_file(f['id'], f.get('mimeType', ''), f['name'])
            if text:
                context_texts.append(f"--- {f['name']} ---\n{text[:10000]}")
        
        source_context = "\n\n".join(context_texts) if context_texts else "업무보고 자료 없음"
        
        news_summary = str(sync.get_tab_data("주요 뉴스")[:15])
        risk_data = str(sync.get_tab_data("리스크 추출1")) + "\n" + str(sync.get_tab_data("리스크 추출2"))
        persona_data = str(sync.get_tab_data("의원별 관심사"))
        
        questions = analyzer.analyze_final_questions(news_summary, risk_data, persona_data, source_context)
        sync.update_questions_tab(questions)

    logger.info(f"✅ 작업 완료: {task}")

if __name__ == "__main__":
    main()
