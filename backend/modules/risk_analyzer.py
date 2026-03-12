import json
import logging
from datetime import datetime, timezone, timedelta
import google.generativeai as genai

from backend.config import GEMINI_API_KEY, MIN_RISK_FACTORS, HEADERS_RISKS
from backend.modules.sheets_manager import SheetsManager

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

class RiskAnalyzer:
    """1년치 뉴스 데이터를 분석하여 리스크 요인을 도출하는 모듈"""

    def __init__(self, sheets_manager: SheetsManager):
        self.sheets = sheets_manager
        genai.configure(api_key=GEMINI_API_KEY)
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def analyze_risks(self):
        """최근 1년치 뉴스를 분석하여 리스크 요인 10개 이상 도출"""
        all_news = self.sheets.get_all_news_raw()
        if not all_news:
            logger.warning("분석할 뉴스 데이터가 없습니다.")
            return []

        # 뉴스 데이터를 텍스트로 변환
        news_context = "\n".join([
            f"[{n.get('날짜')}] {n.get('제목')}: {n.get('네이버 요약')}"
            for n in all_news
        ])

        prompt = f"""당신은 공공기관 행정사무감사를 대비하는 전략 컨설턴트입니다.
아래는 '서울신용보증재단'과 관련된 지난 1년간의 뉴스 데이터입니다.
이 데이터를 바탕으로 이번 행정사무감사에서 시의원들이 지적할만한 '핵심 리스크 및 쟁점'을 최소 {MIN_RISK_FACTORS}개 이상 도출해 주세요.

[분석 지침]
1. 단순 홍보성 기사는 제외하고, 비판 가능성이 있거나 사회적 논란, 수치적 부진(연체율 등), 소상공인 민원 등을 집중적으로 분석하십시오.
2. 각 리스크에 대해 '리스크 요인(제목)', '세부 내용', '관련 근거(기사 제목 등)'를 명확히 제시하십시오.
3. 중복된 이슈는 하나로 통합하되, 구체적인 사례를 포함시키십시오.

응답은 반드시 아래 JSON 형식을 지켜주세요:
{{
  "risks": [
    {{
      "리스크 요인": "...",
      "세부 내용": "...",
      "관련 근거": "..."
    }},
    ...
  ]
}}

[뉴스 데이터]
{news_context}
"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
            )
            result = json.loads(response.text)
            risks = result.get("risks", [])
            
            # 마지막 업데이트 일자 추가
            now_str = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
            for r in risks:
                r["마지막 업데이트"] = now_str
            
            # 시트에 저장 (전체 덮어쓰기)
            self.sheets.update_risks(risks)
            logger.info(f"리스크 분석 완료: {len(risks)}건 도출")
            return risks
        except Exception as e:
            logger.error(f"리스크 분석 중 오류 발생: {e}")
            return []
