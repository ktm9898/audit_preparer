import json
import logging
import io
from datetime import datetime, timezone, timedelta
import google.generativeai as genai
import PyPDF2

from backend.config import GEMINI_API_KEY, TAB_PERSONA, HEADERS_PERSONA
from backend.modules.sheets_manager import SheetsManager

logger = logging.getLogger(__name__)
KST = timezone(timedelta(hours=9))

class PersonaAnalyzer:
    """행정사무감사 회의록을 분석하여 시의원별 페르소나를 추출하는 모듈"""

    def __init__(self, sheets_manager: SheetsManager):
        self.sheets = sheets_manager
        genai.configure(api_key=GEMINI_API_KEY)
        self.model = genai.GenerativeModel('gemini-2.0-flash')

    def extract_text_from_pdf(self, file_content: bytes) -> str:
        """PDF 파일에서 텍스트 추출"""
        try:
            pdf_reader = PyPDF2.PdfReader(io.BytesIO(file_content))
            text = ""
            for page in pdf_reader.pages:
                text += page.extract_text()
            return text
        except Exception as e:
            logger.error(f"PDF 텍스트 추출 실패: {e}")
            return ""

    def analyze_persona(self, file_content: bytes, file_type: str = "pdf"):
        """회의록 데이터를 분석하여 의원별 성향 추출 및 시트 저장"""
        if file_type == "pdf":
            text = self.extract_text_from_pdf(file_content)
        else:
            text = file_content.decode("utf-8")

        if not text:
            logger.warning("분석할 텍스트 내용이 없습니다.")
            return []

        prompt = """당신은 행정사무감사 회의록을 분석하는 전문가입니다.
제공된 회의록 텍스트를 분석하여, 질문을 던진 시의원들의 '페르소나'를 다음 항목에 맞춰 요약해 주세요.

[분석 항목]
1. 의원명
2. 소속 (위원회 등)
3. 주요 관심사 (주로 어떤 사업이나 수치에 대해 질문하는가)
4. 질문 스타일 (예: 수치 중심의 날카로운 질문, 정책의 실효성 강조, 소상공인 민원 대변 등)
5. 공격 포인트 (주로 어떤 약점을 파고드는가)

응답은 반드시 아래 JSON 형식을 지켜주세요:
{
  "personas": [
    {
      "의원명": "...",
      "소속": "...",
      "주요 관심사": "...",
      "질문 스타일": "...",
      "공격 포인트": "..."
    },
    ...
  ]
}

[회의록 텍스트]
""" + text[:30000] # LLM 컨텍스트 한계 고려하여 일부만 전달 (필요 시 청크 분할 필요)

        try:
            response = self.model.generate_content(
                prompt,
                generation_config=genai.types.GenerationConfig(response_mime_type="application/json")
            )
            result = json.loads(response.text)
            personas = result.get("personas", [])
            
            now_str = datetime.now(KST).strftime("%Y-%m-%d %H:%M")
            for p in personas:
                p["마지막 업데이트"] = now_str
                self.sheets.update_persona(p)
            
            logger.info(f"페르소나 분석 완료: {len(personas)}명 추출")
            return personas
        except Exception as e:
            logger.error(f"페르소나 분석 중 오류 발생: {e}")
            return []
