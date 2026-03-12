import json
import logging
from datetime import datetime, timezone, timedelta
import google.generativeai as genai

from backend.config import GEMINI_API_KEY, QUESTION_COUNT
from backend.modules.sheets_manager import SheetsManager

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

class QuestionGenerator:
    """모든 데이터를 종합하여 최종 예상 질문을 생성하는 모듈"""

    def __init__(self, sheets_manager: SheetsManager):
        self.sheets = sheets_manager
        genai.configure(api_key=GEMINI_API_KEY)
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def generate_questions(self, report_text: str):
        """페르소나, 리스크, 보고서를 결합하여 예상 질문 생성"""
        personas = self.sheets.get_all_personas()
        risks = self.sheets.get_all_risks()
        
        if not personas or not risks:
            logger.warning("페르소나 또는 리스크 데이터가 부족하여 질문 생성을 수행할 수 없습니다.")
            return []

        personas_json = json.dumps(personas, ensure_ascii=False)
        risks_json = json.dumps(risks, ensure_ascii=False)

        prompt = f"""당신은 '서울신용보증재단' 행정사무감사를 완벽하게 대비하는 전략 AI입니다.
아래의 3가지 데이터를 교차 분석하여, 실제 감사장에서 나올법한 '날카로운 예상 질문과 답변'을 총 {QUESTION_COUNT}개 생성해 주세요.

[제공 데이터]
1. 시의원 페르소나 (질문 스타일 및 관심사): 
{personas_json}

2. 최근 1년 뉴스 기반 리스크 요인:
{risks_json}

3. 올해 업무보고 자료 (핵심 사업 현황):
{report_text[:15000]}

[생성 지침]
- 특정 의원이 자신의 스타일에 맞춰 특정 리스크 요인을 바탕으로 업무보고서의 수치를 지적하는 시나리오로 질문을 만드십시오.
- 질문은 아주 구체적이고 공격적이어야 하며(수치 인용 등), 답변은 재단의 입장에서 최선의 모범 답안을 제시하십시오.
- 각 질문마다 '의원명', '질문', '답변(모범답안)', '근거(뉴스/보고서)', '공격포인트', '관련 리스크'를 포함하십시오.

응답은 반드시 아래 JSON 형식을 지켜주세요:
{{
  "questions": [
    {{
      "의원명": "...",
      "질문": "...",
      "답변(모범답안)": "...",
      "근거(뉴스/보고서)": "...",
      "공격포인트": "...",
      "관련 리스크": "..."
    }},
    ...
  ]
}}
"""

        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
            )
            result = json.loads(response.text)
            questions = result.get("questions", [])
            
            now_str = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
            for q in questions:
                q["생성일"] = now_str
            
            # 시트에 저장
            self.sheets.save_questions(questions)
            logger.info(f"예상 질문 {len(questions)}개 생성 완료")
            return questions
        except Exception as e:
            logger.error(f"질문 생성 중 오류 발생: {e}")
            return []
