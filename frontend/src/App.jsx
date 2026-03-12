import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { 
  FileText, 
  Search, 
  AlertTriangle, 
  HelpCircle, 
  Upload, 
  RefreshCw, 
  ChevronRight,
  Database,
  Users,
  CheckCircle2
} from 'lucide-react';

// API 설정 (로컬 개발: http://localhost:8000 / 프로덕션: GAS Web App URL)
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000';
const IS_GAS = API_BASE.includes('script.google.com');

function App() {
  const [data, setData] = useState({
    personas: [],
    risks: [],
    news_count: 0,
    questions: []
  });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState('summary');

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const url = IS_GAS ? `${API_BASE}?action=getAllData` : `${API_BASE}/data`;
      const res = await axios.get(url);
      setData(res.data);
    } catch (err) {
      console.error('데이터 로드 실패', err);
    }
  };

  const handleAction = async (endpoint, formData = null, ghTask = null) => {
    setLoading(true);
    setStatus('진행 중...');
    try {
      if (IS_GAS && ghTask) {
        // GitHub Actions 트리거 모드
        const url = `${API_BASE}?action=triggerWorkflow&task=${ghTask}`;
        const res = await axios.get(url); // GAS는 GET으로 트리거 (doGet에서 처리)
        setStatus(res.data.message || '요청 성공');
      } else {
        // 로컬 백엔드 모드
        const config = formData ? { headers: { 'Content-Type': 'multipart/form-data' } } : {};
        const res = await axios.post(`${API_BASE}${endpoint}`, formData, config);
        setStatus(res.data.message);
      }
      await fetchData();
    } catch (err) {
      setStatus('오류가 발생했습니다.');
      console.error(err);
    } finally {
      setLoading(false);
      setTimeout(() => setStatus(''), 3000);
    }
  };

  const renderTab = () => {
    switch (activeTab) {
      case 'personas':
        return (
          <div className="tab-content animate-fade-in">
            <div className="section-header">
              <Users size={24} className="icon-blue" />
              <h2>시의원 페르소나</h2>
              <div className="spacer"></div>
              {IS_GAS ? (
                <div className="gh-actions-group">
                  <span className="gh-tip">분석용 파일 업로드 후 클릭:</span>
                  <button className="premium-btn secondary" onClick={() => handleAction(null, null, 'persona')}>
                    <Database size={18} /> 의원 스타일 분석 (GH)
                  </button>
                </div>
              ) : (
                <label className="premium-btn secondary">
                  <Upload size={18} />
                  회의록 업로드 (PDF/TXT)
                  <input type="file" hidden onChange={(e) => handleAction('/analyze-persona', createFormData(e.target.files[0]))} />
                </label>
              )}
            </div>
            <div className="grid-container">
              {data.personas.map((p, i) => (
                <div key={i} className="glass-panel card">
                  <div className="card-header">
                    <h3>{p.의원명}</h3>
                    <span className="badge">{p.소속}</span>
                  </div>
                  <div className="card-body">
                    <p><strong>주요 관심사:</strong> {p["주요 관심사"]}</p>
                    <p><strong>질문 스타일:</strong> {p["질문 스타일"]}</p>
                    <p className="danger-text"><strong>공격 포인트:</strong> {p["공격 포인트"]}</p>
                  </div>
                  <div className="card-footer">최근 업데이트: {p["마지막 업데이트"]}</div>
                </div>
              ))}
            </div>
          </div>
        );
      case 'risks':
        return (
          <div className="tab-content animate-fade-in">
            <div className="section-header">
              <AlertTriangle size={24} className="icon-orange" />
              <h2>최근 1년 리스크 요인</h2>
              <div className="spacer"></div>
              {IS_GAS ? (
                <div className="gh-actions-group">
                   <button className="premium-btn" onClick={() => handleAction(null, null, 'news')}>
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    뉴스 수집 (GH)
                  </button>
                  <button className="premium-btn" onClick={() => handleAction(null, null, 'risks')}>
                    <Search size={18} />
                    리스크 분석 (GH)
                  </button>
                </div>
              ) : (
                <>
                  <button className="premium-btn" onClick={() => handleAction('/refresh-news')}>
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    뉴스 수집
                  </button>
                  <button className="premium-btn" onClick={() => handleAction('/analyze-risks')}>
                    <Search size={18} />
                    리스크 분석
                  </button>
                </>
              )}
            </div>
            {/* ... lines ... */}
          </div>
        );
      case 'questions':
        return (
          <div className="tab-content animate-fade-in">
            <div className="section-header">
              <HelpCircle size={24} className="icon-purple" />
              <h2>최종 예상 질문</h2>
              <div className="spacer"></div>
              {IS_GAS ? (
                 <div className="gh-actions-group">
                  <span className="gh-tip">보고서 업로드 후 클릭:</span>
                  <button className="premium-btn" onClick={() => handleAction(null, null, 'questions')}>
                    <FileText size={18} /> 예상질문 생성 (GH)
                  </button>
                </div>
              ) : (
                <label className="premium-btn">
                  <FileText size={18} />
                  업무보고서 기반 질문 생성
                  <input type="file" hidden onChange={(e) => handleAction('/generate-questions', createFormData(e.target.files[0], 'report'))} />
                </label>
              )}
            </div>
            <div className="qa-container">
              {data.questions.map((q, i) => (
                <div key={i} className="glass-panel qa-item">
                  <div className="qa-header">
                    <span className="qa-author">{q.의원명} 의원</span>
                    <span className="qa-risk">관련 리스크: {q["관련 리스크"]}</span>
                  </div>
                  <div className="qa-content">
                    <div className="question-box">
                      <strong>Q: </strong>{q.질문}
                    </div>
                    <div className="answer-box">
                      <strong>A: </strong>{q["답변(모범답안)"]}
                    </div>
                    <div className="meta-box">
                      <p><strong>공격포인트:</strong> {q.공격포인트}</p>
                      <p><strong>근거:</strong> {q["근거(뉴스/보고서)"]}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      default:
        return (
          <div className="summary-view animate-fade-in">
            <div className="hero-section">
              <h1>Audit Preparer</h1>
              <p>서울신용보증재단 행정사무감사 완벽 대비 시스템</p>
            </div>
            <div className="stats-grid">
              <div className="glass-panel stat-card" onClick={() => setActiveTab('personas')}>
                <Users size={32} />
                <div className="stat-value">{data.personas.length}</div>
                <div className="stat-label">등록된 페르소나</div>
              </div>
              <div className="glass-panel stat-card" onClick={() => setActiveTab('risks')}>
                <AlertTriangle size={32} />
                <div className="stat-value">{data.risks.length}</div>
                <div className="stat-label">분석된 리스크</div>
              </div>
              <div className="glass-panel stat-card">
                <Database size={32} />
                <div className="stat-value">{data.news_count}</div>
                <div className="stat-label">수집된 뉴스</div>
              </div>
              <div className="glass-panel stat-card" onClick={() => setActiveTab('questions')}>
                <HelpCircle size={32} />
                <div className="stat-value">{data.questions.length}</div>
                <div className="stat-label">생성된 질문</div>
              </div>
            </div>
          </div>
        );
    }
  };

  const createFormData = (file, key = 'file') => {
    const fd = new FormData();
    fd.append(key, file);
    return fd;
  };

  return (
    <div className="app-container">
      <nav className="glass-panel main-nav">
        <div className="logo">Audit Preparer</div>
        <div className="nav-links">
          <button className={activeTab === 'summary' ? 'active' : ''} onClick={() => setActiveTab('summary')}>대시보드</button>
          <button className={activeTab === 'personas' ? 'active' : ''} onClick={() => setActiveTab('personas')}>의원 스타일</button>
          <button className={activeTab === 'risks' ? 'active' : ''} onClick={() => setActiveTab('risks')}>이슈/리스크</button>
          <button className={activeTab === 'questions' ? 'active' : ''} onClick={() => setActiveTab('questions')}>예상 질문</button>
        </div>
        {status && <div className="status-toast glass-panel">{status}</div>}
      </nav>

      <main className="main-content">
        {renderTab()}
      </main>

      <style>{`
        .app-container { max-width: 1400px; margin: 0 auto; padding: 2rem; padding-top: 6rem; }
        .main-nav { position: fixed; top: 1.5rem; left: 50%; transform: translateX(-50%); width: calc(100% - 4rem); max-width: 1400px; height: 4.5rem; display: flex; align-items: center; justify-content: space-between; padding: 0 2rem; z-index: 1000; border-radius: 1.25rem; }
        .logo { font-size: 1.5rem; font-weight: 800; background: linear-gradient(135deg, #6366f1, #0ea5e9); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .nav-links { display: flex; gap: 1rem; }
        .nav-links button { background: none; border: none; color: var(--text-muted); font-weight: 600; font-size: 0.95rem; padding: 0.5rem 1rem; border-radius: 0.75rem; }
        .nav-links button.active { color: var(--text-main); background: rgba(255, 255, 255, 0.05); }
        .status-toast { position: fixed; bottom: 2rem; right: 2rem; padding: 0.75rem 1.5rem; border-left: 4px solid var(--primary); animation: slideIn 0.3s ease-out; }
        
        .hero-section { text-align: center; padding: 4rem 0; }
        .hero-section h1 { font-size: 4rem; font-weight: 900; margin-bottom: 1rem; letter-spacing: -2px; }
        .hero-section p { color: var(--text-muted); font-size: 1.25rem; }
        
        .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 1.5rem; margin-top: 2rem; }
        .stat-card { padding: 2.5rem; text-align: center; cursor: pointer; transition: transform 0.3s; }
        .stat-card:hover { transform: translateY(-5px); background: rgba(255,255,255,0.05); }
        .stat-card .stat-value { font-size: 2.5rem; font-weight: 800; margin: 0.5rem 0; color: var(--primary); }
        .stat-card .stat-label { color: var(--text-muted); font-weight: 500; }
        
        .section-header { display: flex; align-items: center; gap: 1rem; margin-bottom: 2rem; }
        .spacer { flex: 1; }
        .grid-container { display: grid; grid-template-columns: repeat(auto-fit, minmax(350px, 1fr)); gap: 1.5rem; }
        .card { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
        .card-header { display: flex; justify-content: space-between; align-items: center; }
        .badge { background: rgba(99,102,241,0.1); color: var(--primary); padding: 0.25rem 0.75rem; border-radius: 2rem; font-size: 0.8rem; font-weight: 700; }
        .danger-text { color: #f87171; }
        .card-footer { font-size: 0.75rem; color: var(--text-muted); margin-top: auto; }
        
        .list-container { display: flex; flex-direction: column; gap: 1rem; }
        .list-item { padding: 1.5rem; display: flex; align-items: center; gap: 1rem; }
        .item-main { flex: 1; }
        .item-main h4 { font-size: 1.15rem; margin-bottom: 0.25rem; }
        .item-main p { color: var(--text-muted); font-size: 0.95rem; line-height: 1.5; }
        .status-icon { color: var(--accent); opacity: 0.7; }
        
        .qa-container { display: flex; flex-direction: column; gap: 1.5rem; }
        .qa-item { padding: 2rem; border-left: 4px solid var(--primary); }
        .qa-header { display: flex; justify-content: space-between; margin-bottom: 1.5rem; }
        .qa-author { font-weight: 800; color: var(--secondary); }
        .qa-risk { font-size: 0.85rem; color: var(--text-muted); }
        .question-box { background: rgba(255,255,255,0.03); padding: 1.25rem; border-radius: 0.75rem; margin-bottom: 1rem; font-size: 1.1rem; line-height: 1.6; }
        .answer-box { background: rgba(16,185,129,0.05); padding: 1.25rem; border-radius: 0.75rem; margin-bottom: 1.5rem; line-height: 1.6; border: 1px solid rgba(16,185,129,0.1); }
        .meta-box { display: flex; flex-direction: column; gap: 0.5rem; font-size: 0.85rem; color: var(--text-muted); }

        .gh-actions-group { display: flex; align-items: center; gap: 1rem; }
        .gh-tip { font-size: 0.8rem; color: var(--text-muted); opacity: 0.8; }

        .icon-blue { color: var(--primary); }
        .icon-orange { color: #fb923c; }
        .icon-purple { color: #a855f7; }

        @keyframes slideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .animate-spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  );
}

export default App;
