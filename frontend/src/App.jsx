import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  FileText, Search, AlertTriangle, HelpCircle, 
  Upload, RefreshCw, Database, Users, CheckCircle2,
  Menu, X, ChevronRight, LayoutDashboard, UserCheck, ShieldAlert, MessageSquare,
  Settings, ArrowUpRight, Trash2, Newspaper, ExternalLink, Star, User
} from 'lucide-react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const IS_GAS = API_BASE.includes('script.google.com');

// ── 공통 컴포넌트 ────────────────────────────────────────────────────────

const MiniFileManager = ({ files, type, label, onUpload, onDelete }) => (
  <div className="mini-fm">
    <div className="mf-header">
      <div className="mf-title">
        <Database size={16} />
        <span>{label} 보관함</span>
      </div>
      <label className="mf-add">
        <Upload size={14}/> <span>파일 추가</span>
        <input type="file" hidden onChange={e => onUpload(e, type)}/>
      </label>
    </div>
    <div className="mf-list">
      {!Array.isArray(files) || files.length === 0 ? (
        <div className="mf-empty">등록된 파일이 없습니다.</div>
      ) : (
        files.map(f => (
          <div key={f.id} className="mf-item" title={f.name}>
            <div className="item-info">
              <FileText size={14} className="icon-doc" />
              <span className="name">{f.name}</span>
            </div>
            <button className="del-btn" onClick={() => onDelete(f.id, type, f.name)} title="파일 삭제">
              <Trash2 size={12} />
            </button>
          </div>
        ))
      )}
    </div>
  </div>
);

const StatCard = ({ title, value, icon: Icon, color, onClick }) => (
  <div className={`stat-card ${color}`} onClick={onClick}>
    <div className="stat-icon-box">
      {Icon && <Icon size={24} />}
    </div>
    <div className="stat-info">
      <div className="stat-label">{title}</div>
      <div className="stat-value">{value}</div>
    </div>
    <ChevronRight size={18} className="stat-arrow" />
  </div>
);

// ── 메인 앱 ──────────────────────────────────────────────────────────────

function App() {
  const [personas, setPersonas] = useState([]);
  const [risks, setRisks] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [news, setNews] = useState([]);
  const [newsCount, setNewsCount] = useState(0);
  const [selectedPersona, setSelectedPersona] = useState(null);
  const [minutesFiles, setMinutesFiles] = useState([]);
  const [reportFiles, setReportFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [passcode, setPasscode] = useState(localStorage.getItem('audit_passcode') || 'audit123');
  const [showSettings, setShowSettings] = useState(false);

  const fetchInitialData = async () => {
    setLoading(true);
    setStatus('데이터를 불러오는 중...');
    try {
      const res = await axios.get(`${API_BASE}?action=getAllData&token=${passcode}`);
      setPersonas(res.data.personas || []);
      setRisks(res.data.risks || []);
      setQuestions(res.data.questions || []);
      setNews(res.data.news || []);
      setNewsCount(res.data.news_count || 0);

      const mRes = await axios.get(`${API_BASE}?action=listFiles&type=minutes&token=${passcode}`);
      if (Array.isArray(mRes.data)) setMinutesFiles(mRes.data);
      const rRes = await axios.get(`${API_BASE}?action=listFiles&type=report&token=${passcode}`);
      if (Array.isArray(rRes.data)) setReportFiles(rRes.data);
      
      setStatus('');
    } catch (err) { 
      console.error('데이터 로드 오류:', err); 
      setStatus('연결 확인 필요 (비밀번호나 주소를 확인해 주세요)'); 
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchInitialData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passcode]);

  const savePasscode = (code) => {
    setPasscode(code);
    localStorage.setItem('audit_passcode', code);
    setShowSettings(false);
    setStatus('비밀번호가 저장되었습니다.');
    setTimeout(() => setStatus(''), 3000);
  };

  const handleAction = async (task, fileId = null) => {
    setLoading(true);
    setStatus(fileId ? '선택한 파일을 분석 중입니다...' : '보관함의 모든 파일을 취합하여 AI 분석 중입니다... (약 1분 소요)');
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ 
          action: 'runAnalysis', 
          task, 
          fileId,
          token: passcode 
        })
      });
      const result = await response.json();
      
      if (result.ok) {
        setStatus('분석 완료! 데이터를 새로고침합니다.');
        await fetchInitialData();
      } else {
        throw new Error(result.error || '분석 중 서버 오류');
      }
    } catch (err) { 
      console.error('분석 요청 에러:', err);
      setStatus(`요청 실패: ${err.message}`); 
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 8000);
    }
  };

  const fetchNews = async () => {
    setLoading(true);
    setStatus('최신 뉴스를 수집 및 검토 중입니다...');
    try {
      const res = await axios.get(`${API_BASE}?action=fetchNews&token=${passcode}`);
      if (res.data.ok) {
        setStatus(`뉴스 수집 완료: ${res.data.count || 0}건의 주요 뉴스 추가`);
        await fetchInitialData();
      } else {
        throw new Error(res.data.error || '수집 실패');
      }
    } catch (err) {
      console.error('뉴스 수집 실패:', err);
      setStatus(`수집 실패: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 8000);
    }
  };

  const handleFileUpload = async (e, type) => {
    const file = e.target.files[0];
    if (!file) return;

    const MAX_SIZE = 15 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      alert(`파일이 너무 큽니다. 15MB 이하만 가능합니다.`);
      return;
    }
    
    const mimeType = file.type || (file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
    setLoading(true); 
    setStatus(`'${file.name}' 업로드 중...`);
    
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1];
        const payload = JSON.stringify({ 
          action: 'uploadFile',
          filename: file.name, 
          mimeType: mimeType, 
          base64: base64, 
          type: type,
          token: passcode
        });

        const response = await fetch(API_BASE, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain' },
          body: payload
        });

        if (!response.ok) {
          throw new Error(`통신 오류 (Http ${response.status})`);
        }

        const text = await response.text();
        let result;
        try {
          result = JSON.parse(text);
        } catch (parseErr) {
          console.error('JSON 파싱 실패:', text, parseErr);
          throw new Error('서버가 올바른 응답을 주지 않았습니다. (GAS 배포 업데이트 필요)');
        }

        if (result.ok) {
          setStatus('업로드 성공!');
          const res = await axios.get(`${API_BASE}?action=listFiles&type=${type}`);
          if (type === 'minutes') setMinutesFiles(res.data); else setReportFiles(res.data);
        } else {
          throw new Error(result.error || '업로드 처리 중 서버 오류');
        }
      } catch (err) { 
        console.error('업로드 실패 원인:', err);
        let msg = err.message;
        if (msg === 'Failed to fetch') {
          msg = '연결 차단됨 (보통 여러 구글 계정 로그인 또는 브라우저 보안 때문). 시크릿 창에서 시도하거나 GAS의 [새 배포]를 다시 해주세요.';
        }
        setStatus(`업로드 실패: ${msg}`); 
      } finally {
        setLoading(false);
        setTimeout(() => setStatus(''), 8000);
      }
    };
  };

  const handleDeleteFile = async (fileId, type, filename) => {
    if (!window.confirm(`'${filename}' 파일을 삭제하시겠습니까?`)) return;

    setLoading(true);
    setStatus(`'${filename}' 삭제 중...`);
    try {
      const response = await fetch(API_BASE, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify({ 
          action: 'deleteFile',
          fileId,
          token: passcode
        })
      });

      const result = await response.json();
      if (result.ok) {
        setStatus('삭제 성공!');
        const res = await axios.get(`${API_BASE}?action=listFiles&type=${type}&token=${passcode}`);
        if (type === 'minutes') setMinutesFiles(res.data); else setReportFiles(res.data);
      } else {
        throw new Error(result.error || '삭제 중 서버 오류');
      }
    } catch (err) {
      console.error('삭제 실패:', err);
      setStatus(`삭제 실패: ${err.message}`);
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 5000);
    }
  };

  const checkConnection = async () => {
    setStatus('서버 연결 확인 중...');
    try {
      const res = await fetch(`${API_BASE}?action=getAllData&token=${passcode}`);
      if (res.ok) {
        setStatus('서버 연결 상태: 양호 ✅');
      } else {
        setStatus(`서버 연결 실패: 오류 코드 ${res.status} ❌`);
      }
    } catch (err) {
      console.error('연결 확인 실패:', err);
      setStatus('연결 확인 실패: 주소나 비밀번호를 확인해 주세요. ❌');
    }
    setTimeout(() => setStatus(''), 5000);
  };

  return (
    <div className="audit-app">
      {/* 배경 장식 */}
      <div className="bg-decoration"></div>
      
      {/* 설정 모달 */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="settings-modal fade-in">
            <div className="modal-header">
              <h3>시스템 설정</h3>
              <button className="close-btn" onClick={() => setShowSettings(false)}><X size={20} /></button>
            </div>
            <div className="modal-body">
              <div className="form-group">
                <label>GAS 보안 비밀번호 (ACCESS_TOKEN)</label>
                <input 
                  type="password" 
                  value={passcode} 
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="GAS 스크립트 속성에 설정된 토큰 입력"
                />
                <p className="help-text">이 비밀번호는 브라우저에만 저장되며 통신 시 암호로 사용됩니다.</p>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setShowSettings(false)}>취소</button>
              <button className="btn-primary" onClick={() => savePasscode(passcode)}>저장하기</button>
            </div>
          </div>
        </div>
      )}
      
      {/* 네비게이션 */}
      <header className="main-header">
        <div className="header-container">
          <div className="brand" onClick={() => setActiveTab('summary')}>
            <div className="logo-box">AP</div>
            <div className="brand-text">
              <span className="title">Audit Preparer</span>
              <span className="sub">서울신용보증재단 행정감사 대비</span>
            </div>
          </div>
          <div className="header-right">
            <button className="diag-btn" onClick={() => setShowSettings(true)}>
              <Settings size={14} /> 설정
            </button>
            <button className="diag-btn" onClick={checkConnection}>
              <RefreshCw size={14} className={loading ? 'spin' : ''} /> 서버 연결 확인
            </button>
            <nav className="nav-menu">
              <button className={activeTab === 'summary' ? 'active' : ''} onClick={() => setActiveTab('summary')}>
                <LayoutDashboard size={18} /> <span>대시보드</span>
              </button>
              <button className={activeTab === 'personas' ? 'active' : ''} onClick={() => setActiveTab('personas')}>
                <UserCheck size={18} /> <span>의원 관심사</span>
              </button>
              <button className={activeTab === 'risks' ? 'active' : ''} onClick={() => setActiveTab('risks')}>
                <ShieldAlert size={18} /> <span>이슈/리스크</span>
              </button>
              <button className={activeTab === 'questions' ? 'active' : ''} onClick={() => setActiveTab('questions')}>
                <MessageSquare size={18} /> <span>예상 질문</span>
              </button>
              <button className={activeTab === 'news' ? 'active' : ''} onClick={() => setActiveTab('news')}>
                <Newspaper size={18} /> <span>최근 뉴스</span>
              </button>
            </nav>
          </div>
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="content-area">
        <div className="container">
          {activeTab === 'summary' && (
            <div className="view-summary fade-in">
              <div className="welcome-banner">
                <div className="banner-txt">
                  <h1>안녕하세요, 관리자님 👋</h1>
                  <p>오늘의 감사 대비 현황을 한눈에 확인하세요.</p>
                </div>
                <button className="refresh-btn" onClick={fetchInitialData}>
                  <RefreshCw size={18} className={loading ? 'spin' : ''} />
                  새로고침
                </button>
              </div>
              
              <div className="stats-grid">
                <StatCard 
                  title="등록된 의원 관심사" 
                  value={`${personas.length}명`} 
                  icon={Users} 
                  color="blue"
                  onClick={() => setActiveTab('personas')}
                />
                <StatCard 
                  title="분석된 리스크 요인" 
                  value={`${risks.length}건`} 
                  icon={ShieldAlert} 
                  color="red"
                  onClick={() => setActiveTab('risks')}
                />
                <StatCard 
                  title="수집된 관련 뉴스" 
                  value={`${newsCount}건`} 
                  icon={RefreshCw} 
                  color="green"
                  onClick={fetchNews}
                />
                <StatCard 
                  title="최종 대비 예상 질문" 
                  value={`${questions.length}개`} 
                  icon={HelpCircle} 
                  color="purple"
                  onClick={() => setActiveTab('questions')}
                />
              </div>

              <div className="dashboard-footer">
                <div className="system-status">
                  <div className="status-dot"></div>
                  <span>시스템 정상 작동 중</span>
                  <span className="update-time">마지막 업데이트: {new Date().toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'personas' && (
            <div className="view-tab fade-in">
              <div className="section-header">
                <div className="title-row">
                  <UserCheck size={24} className="title-icon" />
                  <h2>의원 관심사 분석 현황</h2>
                </div>
                <button className="action-btn primary" onClick={() => handleAction('persona')}>
                  <Search size={18} /> 분석 파이프라인 실행
                </button>
              </div>
              
              <div className="layout-with-sidebar">
                <div className="main-content">
                  <div className="card-grid">
                    {personas.map((p, i) => (
                      <div key={i} className="content-card persona">
                        <div className="card-top">
                          <span className="party-badge">{p.지역구 || p.소속 || "지역구 미지정"}</span>
                          <span className="name">{p.의원명 || p.이름} 의원</span>
                        </div>
                        <div className="card-body">
                          <div className="info-row">
                            <div className="info-group">
                              <label>주요 관심사</label>
                              <p className="line-clamp-1">{p["주요 관심사"] || p["관심사"] || p["주요 관심 포인트"] || "-"}</p>
                            </div>
                            <div className="info-group">
                              <label>질문 성향</label>
                              <p className="line-clamp-1">{p["질문 성향"] || p["성향"] || p["스타일"] || p["질문 스타일"] || "-"}</p>
                            </div>
                          </div>
                          <div className="info-group">
                            <label>상세 발언 요약</label>
                            <p className="summary-text line-clamp-3">{p["발언 요약"] || p["발언요약"] || "-"}</p>
                          </div>
                          <div className="info-group danger">
                            <label>핵심 감사 포인트</label>
                            <p className="line-clamp-2">{p["예상 감사 포인트"] || p["감사 포인트"] || p["공격 포인트"] || p["예상 공격 전략"] || "-"}</p>
                          </div>
                        </div>
                        <button className="card-more-btn" onClick={() => setSelectedPersona(p)}>
                          상세보기 <ChevronRight size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                  {personas.length === 0 && (
                    <div className="empty-state">데이터가 없습니다. 분석을 실행해 주세요.</div>
                  )}
                </div>
                <aside className="sidebar">
                  <MiniFileManager 
                    files={minutesFiles} 
                    type="minutes" 
                    label="시의회 회의록" 
                    onUpload={handleFileUpload} 
                    onDelete={handleDeleteFile}
                  />
                </aside>
              </div>
            </div>
          )}

          {activeTab === 'risks' && (
            <div className="view-tab fade-in">
              <div className="section-header">
                <div className="title-row">
                  <ShieldAlert size={24} className="title-icon" />
                  <h2>실시간 이슈 및 리스크 분석</h2>
                </div>
                <div className="btn-group">
                  <button className="action-btn" onClick={fetchNews}>
                    <RefreshCw size={16} /> 뉴스 수집
                  </button>
                  <button className="action-btn primary" onClick={() => handleAction('risks')}>
                    <AlertTriangle size={16} /> 리스크 추출
                  </button>
                </div>
              </div>
              
              <div className="list-container">
                {risks.map((r, i) => (
                  <div key={i} className="list-item-card">
                    <div className="item-icon"><ShieldAlert size={20} /></div>
                    <div className="item-content">
                      <h3>{r["리스크 요인"]}</h3>
                      <p>{r["세부 내용"]}</p>
                      <div className="item-meta">근거 데이터: {r["관련 근거"]}</div>
                    </div>
                    <CheckCircle2 size={24} className="check-icon" />
                  </div>
                ))}
                {risks.length === 0 && (
                  <div className="empty-state">분석된 리스크 요인이 없습니다.</div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'news' && (
            <div className="view-tab fade-in">
              <div className="section-header">
                <div className="title-row">
                  <Newspaper size={24} className="title-icon" />
                  <h2>수집된 최근 뉴스 목록</h2>
                </div>
                <button className="action-btn" onClick={fetchNews}>
                  <RefreshCw size={16} /> 뉴스 수집 실행
                </button>
              </div>
              
              <div className="news-list-grid">
                {news.map((item, i) => (
                  <a key={i} href={item.link || item.링크} target="_blank" rel="noreferrer" className="news-item-card">
                    <div className="news-date">{item.date || item.날짜}</div>
                    <h3 className="news-title">{item.title || item.제목}</h3>
                    <p className="news-desc">{item.desc || item.본문내용 || item.내용 || "내용 요약 중..."}</p>
                    <div className="news-footer">
                      <span className="source-tag">{item.source || item.언론사 || "뉴스"}</span>
                      <ExternalLink size={12} />
                    </div>
                  </a>
                ))}
                {news.length === 0 && (
                  <div className="empty-state">수집된 뉴스가 없습니다. '뉴스 수집'을 실행해 주세요.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 상세보기 모달 */}
      {selectedPersona && (
        <div className="modal-overlay fade-in" onClick={() => setSelectedPersona(null)}>
          <div className="modal-content detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div className="persona-title">
                <span className="name">{selectedPersona.의원명 || selectedPersona.이름} 의원</span>
                <span className="party-badge">{selectedPersona.지역구 || selectedPersona.소속}</span>
              </div>
              <button className="close-btn" onClick={() => setSelectedPersona(null)}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-body">
              <div className="detail-section">
                <label><Star size={14} /> 주요 관심 영역</label>
                <div className="tag-cloud">
                  {(selectedPersona["주요 관심사"] || selectedPersona["관심사"] || "").split(',').map((t, i) => (
                    <span key={i} className="interest-tag">{t.trim()}</span>
                  ))}
                </div>
              </div>
              
              <div className="detail-grid">
                <div className="detail-section">
                  <label><User size={14} /> 질문 및 상담 성향</label>
                  <p>{selectedPersona["질문 성향"] || selectedPersona["성향"] || "-"}</p>
                </div>
                <div className="detail-section danger">
                  <label><AlertTriangle size={14} /> 핵심 감사 포인트</label>
                  <p>{selectedPersona["예상 감사 포인트"] || selectedPersona["감사 포인트"] || "-"}</p>
                </div>
              </div>

              <div className="detail-section full">
                <label><MessageSquare size={14} /> 상세 발언 기록 및 요약</label>
                <div className="long-text">
                  {selectedPersona["발언 요약"] || selectedPersona["발언요약"] || "기록된 발언이 없습니다."}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-primary" onClick={() => setSelectedPersona(null)}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 상태 토스트 */}
      {status && (
        <div className="toast-message fade-in">
          {loading && <RefreshCw size={16} className="spin" />}
          <span>{status}</span>
        </div>
      )}

      {/* 스타일 시스템 */}
      <style>{`
        @import url('https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css');

        :root {
          --primary: #4f46e5;
          --primary-light: #eef2ff;
          --secondary: #0ea5e9;
          --success: #10b981;
          --danger: #ef4444;
          --warning: #f59e0b;
          --bg: #f8fafc;
          --card: #ffffff;
          --text: #1e293b;
          --text-muted: #64748b;
          --border: #e2e8f0;
          --shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
          --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
        }

        * { box-sizing: border-box; }
        body { 
          background-color: var(--bg); 
          color: var(--text); 
          font-family: 'Pretendard', sans-serif; 
          margin: 0; 
          line-height: 1.5;
        }

        .audit-app { min-height: 100vh; padding-top: 5rem; position: relative; }
        
        .bg-decoration {
          position: fixed; top: 0; left: 0; right: 0; height: 300px;
          background: linear-gradient(180deg, #eef2ff 0%, #f8fafc 100%);
          z-index: -1;
        }

        .container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; }

        /* Header & Nav */
        .main-header {
          position: fixed; top: 0; left: 0; right: 0;
          background: rgba(255, 255, 255, 0.9);
          backdrop-filter: blur(10px);
          border-bottom: 1px solid var(--border);
          height: 4.5rem; z-index: 1000;
        }
        .header-container {
          max-width: 1200px; margin: 0 auto; height: 100%;
          display: flex; align-items: center; justify-content: space-between; padding: 0 1.5rem;
        }
        .header-right { display: flex; align-items: center; gap: 1rem; }
        .diag-btn {
          background: none; border: 1px solid var(--border); padding: 0.4rem 0.8rem;
          border-radius: 0.5rem; font-size: 0.75rem; font-weight: 700; color: var(--text-muted);
          cursor: pointer; display: flex; align-items: center; gap: 0.4rem;
        }
        .diag-btn:hover { background: #f1f5f9; color: var(--primary); }
        .brand { display: flex; align-items: center; gap: 0.75rem; cursor: pointer; }
        .logo-box {
          width: 2.5rem; height: 2.5rem; border-radius: 0.6rem;
          background: var(--primary); color: white;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 1rem;
        }
        .brand-text .title { display: block; font-size: 1.1rem; font-weight: 800; color: var(--text); }
        .brand-text .sub { font-size: 0.75rem; color: var(--text-muted); }

        .nav-menu { display: flex; gap: 0.5rem; }
        .nav-menu button {
          border: none; background: none; padding: 0.6rem 1rem;
          border-radius: 0.5rem; color: var(--text-muted);
          font-weight: 600; font-size: 0.9rem;
          display: flex; align-items: center; gap: 0.5rem;
          transition: all 0.2s; cursor: pointer;
        }
        .nav-menu button:hover { background: var(--primary-light); color: var(--primary); }
        .nav-menu button.active { background: var(--primary); color: white; box-shadow: var(--shadow); }

        /* Modal & Settings */
        .modal-overlay {
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
          background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(8px);
          display: flex; align-items: center; justify-content: center;
          z-index: 2000; animation: fadeIn 0.3s ease;
        }
        .settings-modal {
          background: var(--card); border-radius: 1.25rem; width: 420px;
          box-shadow: var(--shadow-lg); overflow: hidden;
          border: 1px solid var(--border);
        }
        .modal-header {
          padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--border);
          display: flex; align-items: center; justify-content: space-between;
          background: #f8fafc;
        }
        .modal-header h3 { margin: 0; font-size: 1.1rem; font-weight: 800; color: var(--text); }
        .close-btn { 
          background: none; border: none; cursor: pointer; color: var(--text-muted); 
          display: flex; align-items: center; justify-content: center; padding: 4px; border-radius: 4px;
        }
        .close-btn:hover { background: #e2e8f0; color: var(--danger); }
        .modal-body { padding: 1.75rem 1.5rem; }
        .modal-footer {
          padding: 1.25rem 1.5rem; background: #f8fafc;
          border-top: 1px solid var(--border);
          display: flex; justify-content: flex-end; gap: 0.75rem;
        }
        .form-group label { display: block; font-size: 0.85rem; font-weight: 700; color: var(--text); margin-bottom: 0.5rem; }
        .form-group input { 
          width: 100%; padding: 0.75rem 1rem; border: 1px solid var(--border); 
          border-radius: 0.75rem; font-size: 0.95rem; outline: none; transition: border-color 0.2s;
        }
        .form-group input:focus { border-color: var(--primary); }
        .help-text { font-size: 0.75rem; color: var(--text-muted); margin-top: 0.75rem; line-height: 1.4; }
        
        .btn-primary { 
          background: var(--primary); color: white; border: none; 
          padding: 0.75rem 1.5rem; border-radius: 0.6rem; font-weight: 700; cursor: pointer;
          transition: transform 0.1s;
        }
        .btn-primary:active { transform: scale(0.98); }
        .btn-secondary {
          background: white; border: 1px solid var(--border);
          padding: 0.75rem 1.5rem; border-radius: 0.6rem; font-weight: 700; cursor: pointer;
          color: var(--text-muted);
        }
        .btn-secondary:hover { background: #f1f5f9; color: var(--text); }

        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* Summary View */
        .welcome-banner {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 2.5rem; padding: 1rem 0;
        }
        .welcome-banner h1 { font-size: 1.8rem; font-weight: 800; margin: 0; margin-bottom: 0.5rem; }
        .welcome-banner p { color: var(--text-muted); margin: 0; }
        .refresh-btn {
          display: flex; align-items: center; gap: 0.5rem;
          background: white; border: 1px solid var(--border);
          padding: 0.6rem 1.2rem; border-radius: 0.75rem;
          font-weight: 700; font-size: 0.9rem; cursor: pointer;
          transition: all 0.2s;
        }
        .refresh-btn:hover { background: #f1f5f9; }

        .stats-grid { 
          display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); 
          gap: 1.5rem; margin-bottom: 3rem;
        }
        .stat-card {
          background: var(--card); padding: 1.5rem; border-radius: 1.25rem;
          border: 1px solid var(--border); shadow: var(--shadow);
          display: flex; align-items: center; gap: 1rem; cursor: pointer;
          transition: all 0.3s; position: relative; overflow: hidden;
        }
        .stat-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); border-color: var(--primary); }
        .stat-icon-box {
          width: 3.5rem; height: 3.5rem; border-radius: 1rem;
          display: flex; align-items: center; justify-content: center;
        }
        .stat-card.blue .stat-icon-box { background: #e0e7ff; color: #4338ca; }
        .stat-card.orange .stat-icon-box { background: #ffedd5; color: #c2410c; }
        .stat-card.indigo .stat-icon-box { background: #e0e7ff; color: #3730a3; }
        .stat-card.purple .stat-icon-box { background: #f3e8ff; color: #7e22ce; }
        
        .stat-info { flex: 1; }
        .stat-label { font-size: 0.85rem; color: var(--text-muted); font-weight: 600; margin-bottom: 0.25rem; }
        .stat-value { font-size: 1.75rem; font-weight: 800; }
        .stat-arrow { color: var(--border); transition: transform 0.2s; }
        .stat-card:hover .stat-arrow { transform: translateX(3px); color: var(--primary); }

        .dashboard-footer { 
          margin-top: 4rem; padding-top: 2rem; border-top: 1px solid var(--border); 
        }
        .system-status { display: flex; align-items: center; gap: 0.75rem; font-size: 0.85rem; color: var(--text-muted); }
        .status-dot { width: 8px; height: 8px; background: var(--success); border-radius: 50%; box-shadow: 0 0 10px var(--success); }
        .update-time { margin-left: auto; }

        /* Tab Views */
        .section-header {
          display: flex; justify-content: space-between; align-items: flex-end;
          margin-bottom: 2rem; padding-bottom: 1rem; border-bottom: 2px solid var(--border);
        }
        .title-row { display: flex; align-items: center; gap: 0.75rem; }
        .title-icon { color: var(--primary); }
        .section-header h2 { font-size: 1.5rem; font-weight: 800; margin: 0; }
        
        .layout-with-sidebar { display: grid; grid-template-columns: 1fr 300px; gap: 2rem; }
        .sidebar { position: sticky; top: 6.5rem; height: fit-content; }

        .action-btn {
          display: flex; align-items: center; gap: 0.5rem;
          padding: 0.75rem 1.25rem; border-radius: 0.75rem;
          font-weight: 700; font-size: 0.9rem; cursor: pointer;
          border: 1px solid var(--border); background: white;
          transition: all 0.2s;
        }
        .action-btn.primary { background: var(--primary); color: white; border: none; shadow: var(--shadow); }
        .action-btn.primary:hover { background: #4338ca; transform: translateY(-1px); }
        .action-btn:active { transform: translateY(0); }

        .btn-group { display: flex; gap: 0.5rem; }

        /* Cards & Content */
        .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; }
        .content-card {
          background: white; border: 1px solid var(--border);
          border-radius: 1.25rem; padding: 1.5rem; shadow: var(--shadow);
          transition: border-color 0.2s;
        }
        .content-card:hover { border-color: var(--primary); }
        .card-top { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
        .card-top .name { font-size: 1.1rem; font-weight: 800; }
        .party-badge { 
          background: var(--primary-light); color: var(--primary);
          font-size: 0.7rem; font-weight: 800; padding: 0.25rem 0.6rem; border-radius: 2rem;
        }
        .info-group { margin-bottom: 1rem; }
        .info-group label { display: block; font-size: 0.8rem; font-weight: 700; color: var(--text-muted); margin-bottom: 0.4rem; }
        .info-group p { font-size: 0.95rem; margin: 0; line-height: 1.6; }
        .info-group.danger p { color: var(--danger); font-weight: 600; }

        .list-container { display: flex; flex-direction: column; gap: 1rem; }
        .list-item-card {
          background: white; border: 1px solid var(--border);
          border-radius: 1rem; padding: 1.5rem; display: flex; align-items: center; gap: 1.5rem;
          transition: transform 0.2s;
        }
        .list-item-card:hover { transform: scale(1.005); border-color: var(--primary); }
        .item-icon {
          width: 3rem; height: 3rem; border-radius: 0.75rem;
          background: #eff6ff; color: var(--primary);
          display: flex; align-items: center; justify-content: center;
        }
        .item-content { flex: 1; }
        .item-content h3 { font-size: 1.1rem; font-weight: 800; margin: 0; margin-bottom: 0.4rem; }
        .item-content p { color: var(--text-muted); font-size: 0.9rem; margin: 0; }
        .item-meta { font-size: 0.75rem; color: var(--secondary); margin-top: 0.75rem; font-weight: 600; }
        .check-icon { color: var(--success); opacity: 0.3; }

        /* QA Style */
        .qa-list { display: flex; flex-direction: column; gap: 1.5rem; }
        .qa-card { 
          background: white; border: 1px solid var(--border); 
          border-radius: 1.25rem; padding: 2rem; 
        }
        .qa-header { 
          display: flex; justify-content: space-between; 
          margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #f1f5f9;
        }
        .qa-header .tag { font-weight: 900; color: var(--primary); font-size: 0.9rem; }
        .qa-header .meta { font-size: 0.85rem; color: var(--text-muted); font-weight: 600; }
        .q-box, .a-box { display: flex; gap: 1rem; margin-bottom: 1.5rem; }
        .q-box .label, .a-box .label {
          width: 2rem; height: 2rem; border-radius: 0.5rem;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; flex-shrink: 0;
        }
        .q-box .label { background: #fee2e2; color: #ef4444; }
        .a-box .label { background: #dcfce7; color: #16a34a; }
        .q-box .txt { font-size: 1.1rem; font-weight: 700; line-height: 1.5; }
        .a-box .txt { font-size: 1rem; color: #334155; line-height: 1.7; }

        /* File Manager Sidebar */
        .mini-fm {
          background: white; border: 1px solid var(--border);
          border-radius: 1.25rem; padding: 1.25rem; shadow: var(--shadow);
        }
        .mf-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.25rem; }
        .mf-title { display: flex; align-items: center; gap: 0.5rem; font-weight: 800; font-size: 0.95rem; }
        .mf-add {
          display: flex; align-items: center; gap: 0.3rem;
          background: var(--primary-light); color: var(--primary);
          padding: 0.4rem 0.75rem; border-radius: 0.5rem;
          font-size: 0.75rem; font-weight: 800; cursor: pointer;
        }
        .mf-list { display: flex; flex-direction: column; gap: 0.5rem; }
        .mf-item { 
          display: flex; align-items: center; justify-content: space-between;
          padding: 0.6rem 0.75rem; background: #f8fafc; border-radius: 0.5rem;
          font-size: 0.85rem; border: 1px solid transparent; transition: all 0.2s;
        }
        .mf-item:hover { border-color: var(--border); background: white; box-shadow: var(--shadow); }
        .mf-item .item-info { display: flex; align-items: center; gap: 0.6rem; overflow: hidden; }
        .mf-item .icon-doc { color: var(--text-muted); flex-shrink: 0; }
        .mf-item .name { 
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis; 
          font-weight: 500; color: var(--text);
        }
        .del-btn {
          background: none; border: none; cursor: pointer; color: var(--text-muted);
          padding: 4px; border-radius: 4px; display: flex; align-items: center; justify-content: center;
          transition: all 0.2s; flex-shrink: 0;
        }
        .del-btn:hover { background: #fee2e2; color: var(--danger); }
        .mf-empty { text-align: center; padding: 2rem 0; font-size: 0.85rem; color: var(--text-muted); font-style: italic; }

        /* Utils */
        .empty-state {
          padding: 5rem 0; text-align: center; color: var(--text-muted);
          background: white; border: 2px dashed var(--border); border-radius: 1.25rem;
        }
        .toast-message {
          position: fixed; bottom: 2rem; right: 2rem;
          background: #1e293b; color: white; padding: 1.25rem 2rem;
          border-radius: 1rem; display: flex; align-items: center; gap: 1rem;
          z-index: 2000; box-shadow: var(--shadow-lg); font-weight: 600;
        }
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .fade-in { animation: fadeIn 0.4s ease-out; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }

        /* Responsive */
        @media (max-width: 900px) {
          .layout-with-sidebar { grid-template-columns: 1fr; }
          .sidebar { position: static; order: -1; margin-bottom: 2rem; }
          .nav-menu span { display: none; }
          .brand-text .sub { display: none; }
        }
        .line-clamp-1 { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
        .line-clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .line-clamp-3 { display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

        .info-row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
        .card-more-btn {
          width: 100%; padding: 0.75rem; background: var(--primary-light);
          color: var(--primary); border: none; font-weight: 600;
          display: flex; align-items: center; justify-content: center; gap: 0.25rem;
          transition: all 0.2s;
        }
        .card-more-btn:hover { background: var(--primary); color: white; }

        /* News List */
        .news-list-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; margin-top: 1rem; }
        .news-item-card {
          background: white; border-radius: 1rem; padding: 1.5rem; text-decoration: none; color: inherit;
          border: 1px solid var(--border); transition: all 0.3s; display: flex; flex-direction: column; gap: 0.5rem;
        }
        .news-item-card:hover { transform: translateY(-5px); box-shadow: var(--shadow-lg); border-color: var(--primary); }
        .news-date { font-size: 0.8rem; color: var(--text-muted); }
        .news-title { font-size: 1.1rem; font-weight: 700; color: var(--text); margin: 0; }
        .news-desc { font-size: 0.9rem; color: var(--text-muted); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .news-footer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; padding-top: 1rem; border-top: 1px solid var(--border); }
        .source-tag { font-size: 0.75rem; font-weight: 600; color: var(--primary); background: var(--primary-light); padding: 0.2rem 0.6rem; border-radius: 20px; }

        /* Modal Extensions */
        .detail-modal { max-width: 800px; width: 95%; }
        .persona-title { display: flex; flex-direction: column; }
        .persona-title .name { font-size: 1.5rem; font-weight: 800; color: var(--text); }
        .persona-title .party-badge { margin-top: 0.25rem; font-size: 0.9rem; width: fit-content; }
        
        .detail-section { margin-bottom: 2rem; }
        .detail-section label { 
          display: flex; align-items: center; gap: 0.5rem; font-size: 0.9rem; 
          font-weight: 700; color: var(--primary); margin-bottom: 0.75rem;
        }
        .detail-section p { font-size: 1rem; color: var(--text); background: #f8fafc; padding: 1rem; border-radius: 0.5rem; line-height: 1.7; }
        .detail-section.danger p { border-left: 4px solid var(--danger); }
        .detail-section.full .long-text { 
           white-space: pre-wrap; background: #f8fafc; padding: 1.5rem; 
           border-radius: 0.5rem; line-height: 1.8; font-size: 1.05rem;
           border: 1px solid var(--border); min-height: 200px;
        }
        .tag-cloud { display: flex; flex-wrap: wrap; gap: 0.5rem; }
        .interest-tag { background: white; border: 1px solid var(--primary); color: var(--primary); padding: 0.4rem 0.8rem; border-radius: 2rem; font-size: 0.85rem; font-weight: 600; }
        
        .detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        @media (max-width: 768px) { .detail-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}

export default App;
