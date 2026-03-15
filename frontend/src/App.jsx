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
        <Upload size={14} /> <span>파일 추가</span>
        <input type="file" hidden onChange={e => onUpload(e, type)} />
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
  const [risks1, setRisks1] = useState([]);
  const [risks2, setRisks2] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [news, setNews] = useState([]);
  const [newsCount, setNewsCount] = useState(0);
  const [selectedPersona, setSelectedPersona] = useState(null);
  const [selectedNews, setSelectedNews] = useState(null);
  const [minutesFiles, setMinutesFiles] = useState([]);
  const [reportFiles, setReportFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [activeTab, setActiveTab] = useState('summary');
  const [passcode, setPasscode] = useState(localStorage.getItem('audit_passcode') || 'audit123');
  const [showSettings, setShowSettings] = useState(false);
  const [filterMonth, setFilterMonth] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [targetCollectionMonth, setTargetCollectionMonth] = useState(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    return `${y}.${m}`;
  });

  const fetchInitialData = async () => {
    setLoading(true);
    setStatus('데이터를 불러오는 중...');
    try {
      const res = await axios.get(`${API_BASE}?action=getAllData&token=${passcode}`);
      setPersonas(res.data.personas || []);
      setRisks1(res.data.risks1 || []);
      setRisks2(res.data.risks2 || []);
      setQuestions(res.data.questions || []);
      setNews(res.data.news || []);
      setNewsCount(res.data.news_count || 0);
      console.log('App Data Loaded:', res.data);

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

  const fetchNews = async (month) => {
    if (!month) {
      alert('수집할 연월을 선택해 주세요.');
      return;
    }
    setLoading(true);
    setStatus(`${month} 뉴스를 수집 중입니다...`);
    try {
      const res = await axios.get(`${API_BASE}?action=fetchNews&month=${month}&token=${passcode}`);
      if (res.data.ok) {
        setStatus(res.data.count > 0
          ? `${month} 뉴스 수집 완료: ${res.data.count}건 추가`
          : `${month} 뉴스 수집 완료: 새로운 기사가 없습니다.`);
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
          const res = await axios.get(`${API_BASE}?action=listFiles&type=${type}&token=${passcode}`);
          if (type === 'minutes') setMinutesFiles(res.data);
          if (type === 'report') setReportFiles(res.data);
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
        if (type === 'minutes') setMinutesFiles(res.data);
        if (type === 'report') setReportFiles(res.data);
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
                <ShieldAlert size={18} /> <span>주요 뉴스</span>
              </button>
              <button className={activeTab === 'questions' ? 'active' : ''} onClick={() => setActiveTab('questions')}>
                <MessageSquare size={18} /> <span>예상 질문</span>
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
                  value={`${risks1.length + risks2.length}건`}
                  icon={ShieldAlert}
                  color="red"
                  onClick={() => setActiveTab('questions')}
                />
                <StatCard
                  title="수집된 관련 뉴스"
                  value={`${newsCount}건`}
                  icon={Newspaper}
                  color="green"
                  onClick={() => setActiveTab('risks')}
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
                          <div className="name-box">
                            <span className="name">{p.의원명 || p.이름} 의원</span>
                            <button className="compact-more-btn" onClick={() => setSelectedPersona(p)} title="주요 발언 보기">
                              주요 발언 <ArrowUpRight size={12} />
                            </button>
                          </div>
                          <span className="party-badge">{p.지역구 || p.소속 || "지역구 미확인"}</span>
                        </div>
                        <div className="card-body">
                          <div className="metadata-grid">
                            <div className="meta-item">
                              <label>주요 관심사</label>
                              <p>{p["주요 관심사"] || p["관심사"] || "-"}</p>
                            </div>
                            <div className="meta-item">
                              <label>질문 성향</label>
                              <p>{p["질문 성향"] || p["성향"] || "-"}</p>
                            </div>
                          </div>


                          <div className="audit-section danger">
                            <label>핵심 감사 포인트</label>
                            <p>{p["예상 감사 포인트"] || p["감사 포인트"] || p["공격 포인트"] || "-"}</p>
                          </div>
                        </div>
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
                  <Newspaper size={24} className="title-icon" />
                  <h2>뉴스 아카이브</h2>
                </div>
                <div className="collection-controls">
                  <select
                    className="month-select"
                    value={targetCollectionMonth}
                    onChange={(e) => setTargetCollectionMonth(e.target.value)}
                  >
                    {Array.from({ length: 13 }, (_, i) => {
                      const d = new Date();
                      d.setMonth(d.getMonth() - i);
                      const ym = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}`;
                      return <option key={ym} value={ym}>{ym}</option>;
                    })}
                  </select>
                  <button className="action-btn primary" onClick={() => fetchNews(targetCollectionMonth)}>
                    <RefreshCw size={16} className={loading ? 'spin' : ''} /> 월별 뉴스 수집
                  </button>
                </div>
              </div>

              <div className="archive-filter-bar premium-shadow">
                <div className="filter-group">
                  <label><Users size={14} /> 시점 필터</label>
                  <select value={filterMonth} onChange={(e) => setFilterMonth(e.target.value)}>
                    <option value="all">전체 기간</option>
                    {(news || [])
                      .filter(Boolean)
                      .map(n => {
                        const d = n.날짜 || n.date;
                        return d ? String(d).substring(0, 7) : null; // "2024.03.15" -> "2024.03"
                      })
                      .filter(Boolean)
                      .reduce((acc, curr) => (acc.includes(curr) ? acc : [...acc, curr]), [])
                      .sort()
                      .reverse()
                      .map(m => <option key={m} value={m}>{m}</option>)
                    }
                  </select>
                </div>
                <div className="search-group">
                  <Search size={18} className="search-icon" />
                  <input
                    type="text"
                    placeholder="제목, 내용, 분야 검색..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
              </div>

              <div className="news-table-container premium-shadow">
                <div className="table-responsive">
                  <table className="premium-table">
                    <thead>
                      <tr>
                        <th style={{ width: '100px' }}>상태</th>
                        <th style={{ width: '350px' }}>기사</th>
                        <th>요약</th>
                        <th style={{ width: '80px' }}>원문</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        if (!news || news.length === 0) {
                          return <tr><td colSpan="5" className="empty-row">수집된 뉴스가 없습니다. 연월을 선택해 수집을 시작하세요.</td></tr>;
                        }
                        const filteredNews = (news || [])
                          .filter(item => {
                            if (!item) return false;
                            const fullDate = item.날짜 || item.date || "";
                            if (filterMonth !== 'all' && !fullDate.startsWith(filterMonth)) return false;

                            const title = item.제목 || item.title || "";
                            const summary = item.AI요약 || item.aiSummary || item.naverDesc || "";
                            const category = item.분야 || item.category || item.주제 || ""; // '분야' 우선
                            const searchStr = (title + summary + category).toLowerCase();
                            return searchStr.includes(searchTerm.toLowerCase());
                          })
                          .sort((a, b) => {
                            const dateA = a.날짜 || a.date || "";
                            const dateB = b.날짜 || b.date || "";
                            return dateB.localeCompare(dateA); // 최신순 정렬
                          });

                        if (filteredNews.length === 0) {
                          return <tr><td colSpan="5" className="empty-row">검색 조건에 맞는 뉴스가 없습니다.</td></tr>;
                        }

                        return filteredNews.map((item, idx) => {
                          if (!item) return null;
                          const importance = item.중요도 || item.importance || '하';
                          const category = item.분야 || item.category || item.주제 || '기타';
                          const title = item.제목 || item.title || '제목 없음';
                          const source = item.언론사 || item.source || '뉴스';
                          const date = String(item.날짜 || item.date || '오늘').split(' ')[0];
                          const summary = item.AI요약 || item.aiSummary || item.naverDesc || '내용 없음';

                          return (
                            <tr key={idx} className="news-row clickable" onClick={() => setSelectedNews(item)}>
                              <td className="importance-cell">
                                <div className="status-impact-box">
                                  <div className={`impact-indicator ${importance === '상' ? 'high' : importance === '중' ? 'mid' : 'low'}`}>
                                    <span className="impact-text">{importance}</span>
                                  </div>
                                  <div className="field-tag">{category}</div>
                                </div>
                              </td>
                              <td className="info-cell">
                                <div className="news-title-premium">{title}</div>
                                <div className="news-meta-mini">
                                  <span className="source">{source}</span>
                                  <span className="dot">·</span>
                                  <span className="date">{date}</span>
                                </div>
                              </td>
                              <td className="summary-cell">
                                <div className="news-summary-text">{summary}</div>
                              </td>
                              <td className="action-cell">
                                <button className="icon-link-circle" onClick={e => { e.stopPropagation(); window.open(item.링크 || item.link); }}>
                                  <ExternalLink size={16} />
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'questions' && (
            <div className="view-tab fade-in">
              <div className="section-header">
                <div className="title-row">
                  <HelpCircle size={24} className="title-icon" />
                  <h2>행정감사 상정 질문 및 대응</h2>
                </div>
                <div className="btn-group">
                  <button className="action-btn secondary" onClick={() => handleAction('risks')}>
                    <Newspaper size={16} /> 1단계: 뉴스 리스크 추출
                  </button>
                  <button className="action-btn secondary" onClick={() => handleAction('report_risks')}>
                    <FileText size={16} /> 2단계: 보고서 리스크 추출
                  </button>
                  <button className="action-btn primary" onClick={() => handleAction('final_questions')}>
                    <MessageSquare size={16} /> 3단계: 최종 예상 질문 생성
                  </button>
                </div>
              </div>

              <div className="layout-with-sidebar">
                <div className="main-content">
                  <div className="analysis-pipeline-info">
                    <div className="info-txt">
                      <AlertTriangle size={16} className="text-warning" />
                      <span>뉴스(1단계)와 업무보고(2단계) 분석을 완료한 후 <b>3단계 버튼</b>을 눌러 최종 예상 질문을 생성하십시오.</span>
                    </div>
                  </div>

                  <div className="questions-flow vertical">
                    <div className="risks-comparison-grid">
                      <div className="analysis-step">
                        <div className="step-header">
                          <div className="step-num">Step 1</div>
                          <h3>주요 뉴스 기반 리스크 (총 {risks1.length}건)</h3>
                        </div>
                        <div className="risk-mini-list premium-scroll">
                          {risks1.length === 0 ? (
                            <div className="empty-state-mini">데이터가 없습니다. 분석을 실행하세요.</div>
                          ) : (
                            risks1.map((r, i) => (
                              <div key={i} className="mini-risk-item">
                                <span className="num">{i + 1}</span>
                                <div className="txt">
                                  <strong>{r["리스크 요인"] || r["요인"]}</strong>
                                  <p>{r["세부 내용"] || r["내용"]}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>

                      <div className="analysis-step">
                        <div className="step-header">
                          <div className="step-num">Step 2</div>
                          <h3>보고서 기반 리스크 (총 {risks2.length}건)</h3>
                        </div>
                        <div className="risk-mini-list premium-scroll">
                          {risks2.length === 0 ? (
                            <div className="empty-state-mini">데이터가 없습니다. 분석을 실행하세요.</div>
                          ) : (
                            risks2.map((r, i) => (
                              <div key={i} className="mini-risk-item">
                                <span className="num pink">{i + 1}</span>
                                <div className="txt">
                                  <strong>{r["리스크 요인"] || r["요인"]}</strong>
                                  <p>{r["세부 내용"] || r["내용"]}</p>
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="analysis-step full-width">
                      <div className="step-header">
                        <div className="step-num">Step 3</div>
                        <h3>최종 예상 질문 및 대응 가이드 (총 {questions.length}건)</h3>
                      </div>
                      
                      <div className="questions-table-container premium-shadow">
                        <table className="premium-table">
                          <thead>
                            <tr>
                              <th style={{ width: '100px' }}>분류</th>
                              <th style={{ width: '120px' }}>의원</th>
                              <th>예상 질문</th>
                              <th>대응 가이드 및 답변 방향</th>
                            </tr>
                          </thead>
                          <tbody>
                            {questions.length === 0 ? (
                              <tr><td colSpan="4" className="empty-row">분석을 실행하여 최종 질문을 생성하세요.</td></tr>
                            ) : (
                              questions.map((q, i) => (
                                <tr key={i}>
                                  <td><span className="field-tag">{q["분류"] || "일반"}</span></td>
                                  <td><span className="source">{q["의원명"] || "미확인"}</span></td>
                                  <td><div className="q-text-cell">{q["질문"] || q["예상 질문"]}</div></td>
                                  <td><div className="a-text-cell">{q["답변 가이드"] || q["답변 방향"] || q["대응방안"]}</div></td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>

                <aside className="sidebar">
                  <MiniFileManager
                    files={reportFiles}
                    type="report"
                    label="업무보고 자료"
                    onUpload={handleFileUpload}
                    onDelete={handleDeleteFile}
                  />
                  <div className="sidebar-help-card">
                    <h4><Database size={14} /> 분석 가이드</h4>
                    <p>1. <strong>사이드바</strong>에 업무보고 PDF나 텍스트 파일을 업로드하세요.</p>
                    <p>2. <strong>Step 1, 2</strong> 버튼을 눌러 각각의 리스크를 추출하세요.</p>
                    <p>3. <strong>Step 3</strong> 버튼을 눌러 최종 질문을 생성하세요.</p>
                  </div>
                </aside>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* 의원 상세보기 모달 */}
      {selectedPersona && (
        <div className="modal-overlay fade-in" onClick={() => setSelectedPersona(null)}>
          <div className="detail-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{selectedPersona.의원명 || selectedPersona.이름} 의원 주요 발언</h3>
              <button className="close-btn" onClick={() => setSelectedPersona(null)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll premium-scroll">
              <div className="persona-detail-container">
                <div className="speech-summary-box">
                  {selectedPersona.발언요약 || selectedPersona["발언 요약"] || selectedPersona["발언요약"] ||
                    selectedPersona.상세발언 || "발언 기록이 없습니다. 분석 파이프라인을 실행해 주세요."}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-confirm-btn" onClick={() => setSelectedPersona(null)}>확인</button>
            </div>
          </div>
        </div>
      )}

      {/* 뉴스 상세 모달 */}
      {selectedNews && (
        <div className="modal-overlay fade-in" onClick={() => setSelectedNews(null)}>
          <div className="detail-modal wide" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>기사 상세</h3>
              <button className="close-btn" onClick={() => setSelectedNews(null)}><X size={20} /></button>
            </div>
            <div className="modal-body-scroll premium-scroll">
              <div className="news-detail-container">
                <div className="news-meta-row">
                  <span className={`importance-badge ${String(selectedNews?.중요도 || selectedNews?.importance || "").trim() === '상' ? 'high' : String(selectedNews?.중요도 || selectedNews?.importance || "").trim() === '중' ? 'mid' : 'low'}`}>
                    {String(selectedNews?.중요도 || selectedNews?.importance || '하')}
                  </span>
                  <span className="source-tag">{String(selectedNews?.언론사 || selectedNews?.source || "뉴스")}</span>
                  <span className="date-tag">{String(selectedNews?.날짜 || selectedNews?.date || "").split(' ')[0]}</span>
                  <span className="category-tag-modal">#{String(selectedNews?.분야 || selectedNews?.주제 || selectedNews?.category || '기타')}</span>
                </div>
                <h2 className="news-detail-title">{selectedNews?.제목 || selectedNews?.title || "제목 없음"}</h2>
                <a href={selectedNews?.링크 || selectedNews?.link} target="_blank" rel="noopener noreferrer" className="source-link">
                  <ArrowUpRight size={14} /> 원문 보기
                </a>

                <div className="news-section">
                  <div className="section-label">AI 브리핑</div>
                  <div className="ai-briefing-box">
                    {selectedNews?.AI요약 || selectedNews?.aiSummary || selectedNews?.naverDesc || "요약 정보가 없습니다."}
                  </div>
                </div>

                <div className="news-section">
                  <div className="section-label">기사 전문</div>
                  <div className="full-text-box" style={{ whiteSpace: 'pre-wrap', maxHeight: '400px', overflowY: 'auto', background: '#f8fafc', padding: '1.5rem', borderRadius: '1rem', border: '1px solid #e2e8f0', fontSize: '0.95rem', lineHeight: '1.8' }}>
                    {selectedNews?.본문전문 || selectedNews?.fullText || "본문 내용이 수집되지 않았습니다. 원문 링크를 통해 확인해 주세요."}
                  </div>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="modal-confirm-btn" onClick={() => setSelectedNews(null)}>닫기</button>
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

        .container { max-width: 1200px; margin: 0 auto; padding: 0 1.5rem; width: 100%; box-sizing: border-box; }

           /* Modal Premium Enhancements */
        .modal-overlay {
          background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center; z-index: 1000;
          position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        }
        .detail-modal {
          background: #ffffff; width: 95%; max-width: 850px;
          max-height: 85vh; overflow-y: auto; border-radius: 1.25rem;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: modalSlideUp 0.3s ease-out;
          position: relative; border: 1px solid rgba(0,0,0,0.1);
        }
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
          background: rgba(15, 23, 42, 0.75); backdrop-filter: blur(8px);
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
          display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); 
          gap: 1.25rem; margin-bottom: 2.5rem;
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
        .metadata-grid { 
          display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; 
          margin-bottom: 1.25rem;
        }
        .meta-item label { display: block; font-size: 0.7rem; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-bottom: 0.3rem; }
        .meta-item p { margin: 0; font-size: 0.9rem; font-weight: 500; color: var(--text); line-height: 1.4; }

        .summary-section { margin-bottom: 1.25rem; }
        .summary-section label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 0.4rem; }
        .summary-text-box { 
          background: #f8fafc; padding: 0.85rem 1rem; border-radius: 0.75rem; 
          border: 1px dashed var(--border); font-size: 0.9rem; line-height: 1.6;
          color: #334155; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }

        .audit-section { margin-top: auto; padding-top: 0.5rem; }
        .audit-section label { font-size: 0.75rem; font-weight: 700; color: var(--text-muted); display: block; margin-bottom: 0.3rem; }
        .audit-section.danger p { color: #dc2626; font-weight: 600; font-size: 0.95rem; margin: 0; line-height: 1.5; }

        .analysis-grid-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
        .analysis-card { background: #f8fafc; padding: 1rem; border-radius: 0.75rem; border: 1px solid #e2e8f0; }
        .analysis-card.danger { background: #fffafb; border-color: #fee2e2; }
        .analysis-card.danger .section-header { color: var(--danger); }
        .analysis-card p { margin: 0.5rem 0 0; font-size: 0.9rem; font-weight: 500; color: #334155; line-height: 1.5; }
        
        .analysis-section { margin-bottom: 1rem; }

        .modal-footer { 
          padding: 1.25rem 1.5rem; border-top: 1px solid var(--border); 
          display: flex; justify-content: flex-end; 
          background: #f8fafc; border-bottom-left-radius: 1.25rem; border-bottom-right-radius: 1.25rem;
        }
        .modal-confirm-btn {
          background: var(--primary); color: white; border: none; padding: 0.6rem 2rem;
          border-radius: 8px; font-weight: 700; cursor: pointer; transition: all 0.2s;
        }
        .modal-confirm-btn:hover { background: #4338ca; transform: translateY(-2px); }
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
        /* Premium Card Refinements */
        .content-card {
          background: rgba(255, 255, 255, 0.8);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.3);
          box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.07);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .content-card:hover { 
          transform: translateY(-5px); 
          box-shadow: 0 12px 40px 0 rgba(31, 38, 135, 0.12);
          border-color: var(--primary);
        }

          background: linear-gradient(to right, #fcfdfe, #ffffff);
        }
        .card-body { padding: 1rem 1rem; display: flex; flex-direction: column; gap: 0.75rem; }
        
        .summary-section { display: flex; flex-direction: column; gap: 0.5rem; }
        .summary-section label { 
          font-size: 0.75rem; font-weight: 800; color: var(--primary); 
          text-transform: uppercase; letter-spacing: 0.05em;
        }
        .summary-text-large { 
          background: #f8fafc; padding: 1rem; border-radius: 0.75rem; 
          border: 1px solid #e2e8f0; font-size: 0.9rem; line-height: 1.6;
          color: #334155; display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden;
        }

        .card-footer-action { display: none; }
        .name-box { display: flex; align-items: center; gap: 0.75rem; }
        .compact-more-btn {
          background: var(--primary-light); color: var(--primary); border: none;
          font-size: 0.75rem; font-weight: 700; padding: 0.3rem 0.6rem;
          display: flex; align-items: center; gap: 0.25rem; cursor: pointer;
          border-radius: 4px; transition: all 0.2s;
        }
        .compact-more-btn:hover { background: var(--primary); color: white; transform: translateY(-1px); }

        /* Risks Layout */
        .risks-layout { display: grid; grid-template-columns: 1fr 340px; gap: 1.5rem; margin-top: 1rem; }
        .risks-main { min-width: 0; }
        .risks-sub { 
          background: white; border-radius: 1rem; border: 1px solid var(--border); 
          display: flex; flex-direction: column; height: fit-content; max-height: 80vh;
        }
        .section-header-sm {
          padding: 1rem; border-bottom: 1px solid var(--border);
          display: flex; justify-content: space-between; align-items: center;
          background: #fcfdfe; border-radius: 1rem 1rem 0 0;
        }
        .section-header-sm .title-row { display: flex; align-items: center; gap: 0.5rem; color: var(--text); font-weight: 700; font-size: 0.95rem; }
        .refresh-mini-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; padding: 4px; }
        .refresh-mini-btn:hover { color: var(--primary); }

        .news-feed-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(350px, 1fr)); gap: 1rem; }
        .premium-news-card {
          background: white; border: 1px solid var(--border); border-radius: 1rem; padding: 1.25rem;
          text-decoration: none; color: inherit; transition: all 0.2s; position: relative;
          display: flex; flex-direction: column; gap: 0.75rem;
        }
        .premium-news-card:hover { transform: translateY(-3px); box-shadow: 0 10px 20px rgba(0,0,0,0.05); border-color: var(--primary); }
        .news-badge { position: absolute; top: 1rem; right: 1rem; font-size: 0.65rem; font-weight: 800; background: #f1f5f9; padding: 2px 8px; border-radius: 4px; color: var(--text-muted); }
        
        .archive-filter-bar {
          background: white; border-radius: 1rem; padding: 1rem 1.5rem;
          margin-bottom: 1.5rem; display: flex; gap: 2rem; align-items: center;
          border: 1px solid var(--border);
        }
        .filter-group { display: flex; align-items: center; gap: 0.75rem; }
        .filter-group label { font-size: 0.8rem; font-weight: 800; color: var(--text-muted); display: flex; align-items: center; gap: 0.3rem; }
        .filter-group select { 
          padding: 0.5rem 1rem; border-radius: 0.5rem; border: 1px solid var(--border);
          font-weight: 600; font-size: 0.9rem; outline: none; background: #fcfdfe;
        }
        .search-group { flex: 1; display: flex; align-items: center; gap: 0.75rem; background: #f1f5f9; padding: 0.5rem 1rem; border-radius: 0.75rem; }
        .search-icon { color: var(--text-muted); }
        .search-group input { background: none; border: none; outline: none; width: 100%; font-size: 0.95rem; font-weight: 500; }
        
        .collection-controls { display: flex; gap: 0.5rem; align-items: center; }
        .month-select { padding: 0.7rem 1rem; border-radius: 0.75rem; border: 1px solid var(--border); font-weight: 700; background: white; cursor: pointer; }

        .news-title { font-size: 1rem; font-weight: 700; line-height: 1.4; color: var(--text); padding-right: 3rem; margin: 0; }
        .news-desc { font-size: 0.85rem; color: var(--text-muted); line-height: 1.6; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; margin: 0; }
        .news-meta { margin-top: auto; display: flex; justify-content: space-between; align-items: center; padding-top: 0.5rem; border-top: 1px solid #f8fafc; color: var(--primary); font-size: 0.75rem; font-weight: 600; }

        .mini-risk-card { padding: 0.75rem; border-radius: 0.75rem; background: #fffafb; border: 1px solid #fee2e2; margin-bottom: 0.75rem; }
        .risk-title { font-size: 0.85rem; font-weight: 800; color: #b91c1c; margin-bottom: 0.25rem; }
        .risk-body { font-size: 0.8rem; color: #7f1d1d; line-height: 1.4; }

        .questions-flow { display: flex; flex-direction: column; gap: 2.5rem; }
        .analysis-step { display: flex; flex-direction: column; gap: 1rem; }
        .step-header { display: flex; align-items: center; gap: 0.75rem; border-bottom: 2px solid var(--primary-light); padding-bottom: 0.5rem; }
        .step-num { background: var(--primary); color: white; font-size: 0.7rem; font-weight: 800; padding: 2px 8px; border-radius: 20px; text-transform: uppercase; }
        .step-header h3 { font-size: 1.15rem; font-weight: 800; color: var(--text); margin: 0; }

        .risk-horizontal-scroll { display: flex; gap: 1rem; overflow-x: auto; padding: 0.5rem 0; scrollbar-width: thin; }
        .flow-risk-card { 
          min-width: 300px; max-width: 300px; background: #fffafb; border: 1px solid #fee2e2; border-radius: 1rem; padding: 1.25rem;
          display: flex; flex-direction: column; gap: 0.5rem;
        }
        .flow-risk-card h4 { font-size: 0.95rem; font-weight: 800; color: #b91c1c; margin: 0; }
        .flow-risk-card p { font-size: 0.85rem; color: #7f1d1d; line-height: 1.5; margin: 0; }
        .flow-risk-card .evidence { font-size: 0.75rem; color: #991b1b; font-weight: 600; margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px dashed #fecaca; }

        .questions-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(450px, 1fr)); gap: 1.5rem; }
        .premium-question-card { 
          background: white; border: 1px solid var(--border); border-radius: 1.25rem; padding: 1.5rem;
          display: flex; flex-direction: column; gap: 1rem; box-shadow: var(--shadow); transition: all 0.2s;
        }
        .premium-question-card:hover { box-shadow: var(--shadow-lg); transform: translateY(-2px); border-color: var(--primary); }
        .q-badge { align-self: flex-start; background: var(--primary-light); color: var(--primary); font-size: 0.7rem; font-weight: 800; padding: 2px 10px; border-radius: 6px; }
        .question-text { font-size: 1.1rem; font-weight: 800; color: var(--text); line-height: 1.4; margin: 0; }
        .answer-section { background: #f8fafc; border-radius: 0.75rem; padding: 1rem; border-left: 4px solid var(--primary); }
        .answer-section .label { font-size: 0.7rem; font-weight: 800; color: var(--primary); text-transform: uppercase; margin-bottom: 0.5rem; }
        .answer-text { font-size: 0.95rem; color: #334155; line-height: 1.6; margin: 0; }
        .q-meta { font-size: 0.75rem; color: var(--text-muted); font-weight: 600; display: flex; justify-content: flex-end; }

        @media (max-width: 1024px) {
          .risks-layout { grid-template-columns: 1fr; }
          .risks-sub { max-height: 400px; }
        }

        /* Premium Table Styles */
        .premium-shadow { box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05), 0 4px 6px -2px rgba(0, 0, 0, 0.02); }
        .news-table-container { background: white; border-radius: 1.25rem; border: 1px solid var(--border); overflow: hidden; margin-top: 1.5rem; }
        .table-responsive { overflow-x: auto; }
        .premium-table { width: 100%; border-collapse: collapse; text-align: left; }
        .premium-table th { 
          background: #f8fafc; padding: 1.25rem 1rem; font-size: 0.8rem; font-weight: 800; color: var(--text-muted);
          border-bottom: 2px solid var(--border); text-transform: uppercase; letter-spacing: 0.025em;
        }
        .premium-table td { padding: 1.5rem 1rem; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
        .premium-table tr:last-child td { border-bottom: none; }
        .premium-table tr.news-row:hover { background: #f8fafc; cursor: pointer; }

        .importance-badge { 
          display: inline-flex; align-items: center; justify-content: center;
          padding: 4px 12px; border-radius: 6px; font-size: 0.75rem; font-weight: 800;
        }
        .importance-badge.high { background: #fff1f2; color: #e11d48; border: 1px solid #fecdd3; }
        .importance-badge.mid { background: #ecfdf5; color: #059669; border: 1px solid #a7f3d0; }
        .importance-badge.low { background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; }

        .category-label { font-size: 0.65rem; color: var(--text-muted); font-weight: 700; margin-top: 0.4rem; opacity: 0.8; }
        .category-tag-modal { 
          margin-left: auto; padding: 4px 10px; border-radius: 4px; 
          background: #f1f5f9; color: var(--primary); font-size: 0.75rem; font-weight: 800; 
        }

        .date-cell { font-size: 0.85rem; color: var(--text-muted); font-weight: 600; font-family: 'Inter', sans-serif; }
        .source-badge { 
          display: inline-block; padding: 4px 10px; border-radius: 6px; 
          background: #f1f5f9; color: var(--text-muted); font-size: 0.75rem; font-weight: 800;
        }
        .news-title-premium { font-size: 1rem; font-weight: 800; color: #1e293b; margin-bottom: 0.4rem; line-height: 1.4; letter-spacing: -0.01em; }
        .news-summary-text { 
           font-size: 0.9rem; color: #475569; line-height: 1.6;
           display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
        }
        
        .status-impact-box {
          display: flex; flex-direction: column; align-items: center; gap: 0.4rem;
        }
        .impact-indicator {
          width: 2.2rem; height: 2.2rem; border-radius: 0.6rem;
          display: flex; align-items: center; justify-content: center;
          font-weight: 900; font-size: 0.9rem;
        }
        .impact-indicator.high { background: #fff1f2; color: #e11d48; border: 1.5px solid #fecdd3; }
        .impact-indicator.mid { background: #ecfdf5; color: #059669; border: 1.5px solid #a7f3d0; }
        .impact-indicator.low { background: #f8fafc; color: #64748b; border: 1.5px solid #e2e8f0; }
        .field-tag {
          font-size: 0.7rem; font-weight: 800; color: var(--text-muted);
          background: #f1f5f9; padding: 2px 8px; border-radius: 4px;
          white-space: nowrap; max-width: 70px; overflow: hidden; text-overflow: ellipsis;
        }
        .icon-link-circle {
          display: flex; align-items: center; justify-content: center;
          width: 2.2rem; height: 2.2rem; border-radius: 50%;
          border: 1px solid var(--border);
          color: var(--text-muted); transition: all 0.2s;
        }
        .icon-link-circle:hover { background: var(--primary-light); color: var(--primary); border-color: var(--primary); }
        .empty-row { padding: 4rem 0; text-align: center; color: var(--text-muted); font-size: 0.9rem; }

        /* Pipeline Styles */
        .analysis-pipeline-info { background: #fffbeb; border: 1px solid #fef3c7; padding: 0.75rem 1.25rem; border-radius: 0.75rem; margin-bottom: 2rem; }
        .analysis-pipeline-info .info-txt { display: flex; align-items: center; gap: 0.6rem; font-size: 0.85rem; color: #92400e; }
        .empty-state-card { 
          background: #f8fafc; border: 2px dashed #e2e8f0; border-radius: 1rem; padding: 3rem; 
          text-align: center; display: flex; flex-direction: column; align-items: center; gap: 1rem; color: var(--text-muted);
        }
        .icon-muted { opacity: 0.4; }
        .ml-2 { margin-left: 0.5rem; }

        /* Modal Styles */
        .premium-scroll::-webkit-scrollbar { width: 6px; }
        .premium-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 10px; }
        .persona-detail-container { padding: 1.5rem; }
        .detail-meta { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid #f1f5f9; }
        .meta-badge { background: var(--primary-light); color: var(--primary); font-size: 0.75rem; font-weight: 800; padding: 4px 12px; border-radius: 20px; }
        .detail-meta h4 { margin: 0; font-size: 1rem; font-weight: 800; color: var(--text); }
        .speech-summary-box { 
          font-size: 0.95rem; line-height: 1.8; color: #334155; white-space: pre-wrap;
          background: #fcfdfe; padding: 1.5rem; border-radius: 1rem; border: 1px solid #f1f5f9;
        }

        /* News UI Enhancements */
        .news-row.clickable { cursor: pointer; transition: background 0.2s; }
        .news-row.clickable:hover { background: #f8fafc; }
        .news-title-mini { font-size: 0.95rem; font-weight: 700; color: var(--text); margin-bottom: 0.4rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 300px; }
        .news-meta-mini { font-size: 0.75rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.4rem; font-weight: 600; }
        .news-meta-mini .dot { color: var(--border); }
        .summary-cell { max-width: 400px; }
        .icon-link-btn { color: var(--primary); font-size: 0.8rem; font-weight: 600; text-decoration: none; display: flex; align-items: center; gap: 0.2rem; }
        
        .detail-modal.wide { max-width: 800px; }
        .news-detail-container { padding: 2rem; }
        .news-meta-row { display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; }
        .source-tag { font-weight: 700; color: #475569; font-size: 0.9rem; }
        .date-tag { color: #94a3b8; font-size: 0.85rem; font-weight: 500; }
        .news-detail-title { font-size: 1.6rem; font-weight: 800; color: #0f172a; line-height: 1.4; margin: 0; margin-bottom: 1rem; }
        .source-link { display: inline-flex; align-items: center; gap: 0.4rem; color: var(--primary); font-size: 0.9rem; font-weight: 700; text-decoration: none; margin-bottom: 2.5rem; border-bottom: 2px solid var(--primary-light); padding-bottom: 4px; }
        .source-link:hover { color: #4338ca; border-color: var(--primary); }

        .news-section { margin-bottom: 2.5rem; }
        .section-label { font-size: 0.8rem; font-weight: 800; color: var(--primary); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.75rem; }
        .ai-briefing-box { 
          background: #f1f5f9; padding: 1.5rem; border-radius: 1rem; border: 1px solid #e2e8f0;
          font-size: 1rem; line-height: 1.8; color: #1e293b; font-weight: 500;
        }
        .full-text-box { 
          font-size: 0.95rem; line-height: 1.8; color: #334155; white-space: pre-wrap;
          background: white; padding: 1.5rem; border-radius: 1rem; border: 1px solid #f1f5f9;
        }
      `}</style>
    </div>
  );
}

export default App;
