import os
import io
import json
import logging
import tempfile
from typing import List, Dict

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

from config import GOOGLE_CREDENTIALS_JSON

logger = logging.getLogger(__name__)

class DriveSync:
    """Google Drive 파일 다운로드 및 텍스트 추출 클래스"""
    def __init__(self):
        self.scopes = ['https://www.googleapis.com/auth/drive.readonly']
        self.creds = self._get_credentials()
        self.service = build('drive', 'v3', credentials=self.creds) if self.creds else None

    def _get_credentials(self):
        try:
            if GOOGLE_CREDENTIALS_JSON.endswith('.json'):
                return Credentials.from_service_account_file(GOOGLE_CREDENTIALS_JSON, scopes=self.scopes)
            else:
                info = json.loads(GOOGLE_CREDENTIALS_JSON)
                return Credentials.from_service_account_info(info, scopes=self.scopes)
        except Exception as e:
            logger.error(f"Google Drive Auth Error: {e}")
            return None

    def _get_folder_id(self, folder_name: str, parent_id: str = None) -> str:
        """이름으로 폴더 ID 찾기 (공유 드라이브 및 모든 항목 검색 포함)"""
        if not self.service: return None
        query = f"name='{folder_name}' and mimeType='application/vnd.google-apps.folder' and trashed=false"
        if parent_id:
            query += f" and '{parent_id}' in parents"
            
        try:
            results = self.service.files().list(
                q=query, 
                fields="files(id, name)",
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            files = results.get('files', [])
            if files:
                logger.info(f"📁 폴더 발견: {folder_name} (ID: {files[0]['id']})")
                return files[0]['id']
            logger.warning(f"⚠️ 폴더를 찾을 수 없음: {folder_name}")
            return None
        except Exception as e:
            logger.error(f"Folder Search Error ({folder_name}): {e}")
            return None

    def get_files_from_folder(self, subfolder_name: str, specific_file_id: str = None) -> List[Dict]:
        """지정된 보관함 폴더(reports 또는 minutes)의 파일 목록 또는 특정 파일 정보 반환"""
        if not self.service: return []
        
        if specific_file_id:
            try:
                file_meta = self.service.files().get(
                    fileId=specific_file_id, 
                    fields="id, name, mimeType",
                    supportsAllDrives=True
                ).execute()
                return [file_meta]
            except Exception as e:
                logger.error(f"Get Specific File Error: {e}")
                return []
                
        # "Audit_Preparer_Files" 폴더 찾기
        parent_id = self._get_folder_id("Audit_Preparer_Files")
        if not parent_id:
            logger.error("Audit_Preparer_Files 폴더를 찾을 수 없습니다. 서비스 계정에 폴더가 공유되었는지 확인하세요.")
            return []
            
        target_folder_id = self._get_folder_id(subfolder_name, parent_id)
        if not target_folder_id:
            logger.error(f"{subfolder_name} 폴더를 찾을 수 없습니다. (상위 폴더 ID: {parent_id})")
            return []
            
        # 해당 폴더 내의 모든 파일
        query = f"'{target_folder_id}' in parents and mimeType!='application/vnd.google-apps.folder' and trashed=false"
        try:
            results = self.service.files().list(
                q=query, 
                fields="files(id, name, mimeType)",
                pageSize=1000,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True
            ).execute()
            all_files = results.get('files', [])
            logger.info(f"📂 {subfolder_name} 폴더 내 파일 {len(all_files)}개 발견")
            return all_files
        except Exception as e:
            logger.error(f"List Files Error ({subfolder_name}): {e}")
            return []

    def get_report_files(self, specific_file_id: str = None) -> List[Dict]:
        return self.get_files_from_folder("reports", specific_file_id)

    def get_minutes_files(self, specific_file_id: str = None) -> List[Dict]:
        return self.get_files_from_folder("minutes", specific_file_id)

    def extract_text_from_file(self, file_id: str, mime_type: str, file_name: str) -> str:
        """파일을 다운로드하고 텍스트를 추출"""
        if not self.service: return ""
        try:
            # 1. Google Docs 등 구글 문서 포맷은 바로 텍스트로 export 처리
            if "application/vnd.google-apps.document" in mime_type:
                request = self.service.files().export_media(fileId=file_id, mimeType='text/plain')
                return request.execute().decode('utf-8')
                
            # 2. 일반 파일 다운로드
            request = self.service.files().get_media(fileId=file_id)
            fh = io.BytesIO()
            downloader = MediaIoBaseDownload(fh, request)
            done = False
            while done is False:
                status, done = downloader.next_chunk()
                
            fh.seek(0)
            file_bytes = fh.read()
            
            # 임시 파일로 저장 후 파싱
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file_name)[1]) as tmp:
                tmp.write(file_bytes)
                tmp_path = tmp.name
                
            text = ""
            ext = file_name.lower().split('.')[-1]
            
            if ext == 'pdf':
                try:
                    import fitz  # PyMuPDF
                    doc = fitz.open(tmp_path)
                    text = "\n".join([page.get_text() for page in doc])
                except ImportError:
                    logger.warning("PyMuPDF (fitz) is not installed. PDF parsing skipped.")
            elif ext in ['docx', 'doc']:
                try:
                    import docx
                    doc = docx.Document(tmp_path)
                    text = "\n".join([p.text for p in doc.paragraphs])
                except ImportError:
                    logger.warning("python-docx is not installed. DOCX parsing skipped.")
            elif ext in ['txt', 'csv']:
                try:
                    text = file_bytes.decode('utf-8')
                except UnicodeDecodeError:
                    text = file_bytes.decode('euc-kr', errors='ignore')
            else:
                # hwp 등 지원하지 않는 포맷
                logger.warning(f"지원하지 않는 파일 포맷: {ext}")
                text = f"[{file_name}] 텍스트 추출 불가 형식"
                
            os.remove(tmp_path)
            return text.strip()
            
        except Exception as e:
            logger.error(f"Extract Text Error for {file_name}: {e}")
            return ""

