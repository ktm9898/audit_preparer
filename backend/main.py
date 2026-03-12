import os
import logging
from typing import List, Optional
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.modules.sheets_manager import SheetsManager
from backend.modules.news_engine import NewsEngine
from backend.modules.risk_analyzer import RiskAnalyzer
from backend.modules.persona import PersonaAnalyzer 
from backend.modules.generator import QuestionGenerator

# Logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Audit Preparer API")

# CORS setup for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize modules
sheets = SheetsManager()
news_engine = NewsEngine(sheets)
risk_analyzer = RiskAnalyzer(sheets)
persona_analyzer = PersonaAnalyzer(sheets)
question_generator = QuestionGenerator(sheets)

class UpdateResponse(BaseModel):
    status: str
    message: str
    count: Optional[int] = 0

@app.get("/")
def read_root():
    return {"message": "Audit Preparer API is running"}

@app.post("/analyze-persona", response_model=UpdateResponse)
async def analyze_persona(file: UploadFile = File(...)):
    """행감 회의록 업로드 및 페르소나 분석"""
    content = await file.read()
    file_type = "pdf" if file.filename.endswith(".pdf") else "text"
    
    personas = persona_analyzer.analyze_persona(content, file_type)
    if personas:
        return {"status": "success", "message": f"{len(personas)}명의 의원 페르소나 분석 및 저장 완료", "count": len(personas)}
    else:
        raise HTTPException(status_code=500, detail="페르소나 분석에 실패했습니다.")

@app.post("/refresh-news", response_model=UpdateResponse)
async def refresh_news():
    """뉴스 증분 수집"""
    new_news = news_engine.collect_incremental()
    return {"status": "success", "message": f"{len(new_news)}건의 신규 뉴스 수집 완료", "count": len(new_news)}

@app.post("/analyze-risks", response_model=UpdateResponse)
async def analyze_risks():
    """1년치 뉴스 기반 리스크 분석"""
    risks = risk_analyzer.analyze_risks()
    if risks:
        return {"status": "success", "message": f"{len(risks)}건의 핵심 리스크 도출 완료", "count": len(risks)}
    else:
        raise HTTPException(status_code=500, detail="리스크 분석에 실패했습니다.")

@app.post("/generate-questions", response_model=UpdateResponse)
async def generate_questions(report: UploadFile = File(...)):
    """업무보고서 기반 최종 질문 생성"""
    content = await report.read()
    # 업무보고서 텍스트 추출 (PDF 지원)
    report_text = persona_analyzer.extract_text_from_pdf(content) if report.filename.endswith(".pdf") else content.decode("utf-8")
    
    questions = question_generator.generate_questions(report_text)
    if questions:
        return {"status": "success", "message": f"{len(questions)}개의 예상 질문 생성 및 시트 저장 완료", "count": len(questions)}
    else:
        raise HTTPException(status_code=500, detail="질문 생성에 실패했습니다. 페르소나와 리스크 데이터가 있는지 확인해 주세요.")

@app.get("/data")
def get_all_data():
    """현재 시트의 모든 데이터 요약 반환"""
    return {
        "personas": sheets.get_all_personas(),
        "risks": sheets.get_all_risks(),
        "news_count": len(sheets.get_all_news_raw()),
        "questions": sheets.get_past_questions()
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
