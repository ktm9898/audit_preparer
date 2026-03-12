import argparse
import sys
import os
import logging
from backend.modules.sheets_manager import SheetsManager
from backend.modules.news_engine import NewsEngine
from backend.modules.risk_analyzer import RiskAnalyzer
from backend.modules.persona import PersonaAnalyzer
from backend.modules.generator import QuestionGenerator

# Logging setup
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def main():
    parser = argparse.ArgumentParser(description="Audit Preparer Pipeline CLI")
    parser.add_argument("--task", choices=["news", "risks", "persona", "questions"], required=True, help="작업 종류")
    parser.add_argument("--file", help="분석할 파일 경로 (persona 또는 questions 작업 시 필요)")
    
    args = parser.parse_args()
    
    sheets = SheetsManager()
    
    if args.task == "news":
        engine = NewsEngine(sheets)
        new_news = engine.collect_incremental()
        logger.info(f"뉴스 수집 완료: {len(new_news)}건 추가")
        
    elif args.task == "risks":
        analyzer = RiskAnalyzer(sheets)
        risks = analyzer.analyze_risks()
        logger.info(f"리스크 분석 완료: {len(risks)}건 도출")
        
    elif args.task == "persona":
        if not args.file or not os.path.exists(args.file):
            logger.error("분석할 파일 경로(--file)가 올바르지 않습니다.")
            sys.exit(1)
        
        analyzer = PersonaAnalyzer(sheets)
        with open(args.file, "rb") as f:
            content = f.read()
        file_type = "pdf" if args.file.lower().endswith(".pdf") else "text"
        personas = analyzer.analyze_persona(content, file_type)
        logger.info(f"페르소나 분석 완료: {len(personas)}명 추출")
        
    elif args.task == "questions":
        if not args.file or not os.path.exists(args.file):
            logger.error("분석할 보고서 파일 경로(--file)가 올바르지 않습니다.")
            sys.exit(1)
            
        generator = QuestionGenerator(sheets)
        analyzer = PersonaAnalyzer(sheets) # To extract text from PDF
        with open(args.file, "rb") as f:
            content = f.read()
        
        report_text = analyzer.extract_text_from_pdf(content) if args.file.lower().endswith(".pdf") else content.decode("utf-8")
        questions = generator.generate_questions(report_text)
        logger.info(f"질문 생성 완료: {len(questions)}개 생성")

if __name__ == "__main__":
    main()
