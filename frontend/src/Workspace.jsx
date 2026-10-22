import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import pptxgen from "pptxgenjs";
import { supabase, API_URL } from './supabase';

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__', 'venv', 'env'];
const IGNORE_EXTS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.mp4', '.pdf', '.lock', '.pyc'];

const SourceIcon = ({ type }) => {
  const style = { width: '16px', height: '16px', fill: 'currentColor', flexShrink: 0 };
  if (type === 'zip') {
    return (
      <svg style={style} viewBox="0 0 24 24">
        <path d="M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z" />
      </svg>
    );
  }
  if (type === 'folder') {
    return (
      <svg style={style} viewBox="0 0 24 24">
        <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
      </svg>
    );
  }
  if (type === 'github') {
    return (
      <svg style={style} viewBox="0 0 24 24">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
      </svg>
    );
  }
  return null;
};

export default function Workspace({ session, onSignIn, sliderRef }) {
  const [activeTab, setActiveTab] = useState('temp');
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [githubUrl, setGithubUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
    const [displayType, setDisplayType] = useState('');

  const [loading, setLoading] = useState(false);
  const [isFileProcessing, setIsFileProcessing] = useState(false); // Folder parsing animation state

  const [summary, setSummary] = useState('');
  const [projectName, setProjectName] = useState('');
  const [historyLogs, setHistoryLogs] = useState([]);

  const [isLocked, setIsLocked] = useState(false);
  const [pendingLevel, setPendingLevel] = useState(null);
  const [popupMsg, setPopupMsg] = useState(null);

  // Tour States
  const [tourStep, setTourStep] = useState(0);
  const tempTabRef = useRef(null);
  const permTabRef = useRef(null);
  const historyTabRef = useRef(null);
  const uploadButtonsRef = useRef(null);
  const explainButtonsRef = useRef(null);

  const zipInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const fetchHistory = async () => {
    if (!session?.user) return;
    const { data } = await supabase.from('history').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false });
    if (data) setHistoryLogs(data);
  };

  useEffect(() => {
    if (session?.user) {
      fetchHistory();
      const hasSeenTour = localStorage.getItem(`tour_${session.user.id}`);
      if (!hasSeenTour) {
        setTourStep(1);
      }
    } else {
      setHistoryLogs([]);
    }
  }, [session]);

  // Handle Tour auto-scrolling so elements are always on screen
  useEffect(() => {
    const refs = [null, sliderRef, tempTabRef, permTabRef, historyTabRef, uploadButtonsRef, explainButtonsRef];
    const currentRef = refs[tourStep];
    if (currentRef?.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tourStep]);

  const closeTour = () => {
    setTourStep(0);
    if (session?.user) localStorage.setItem(`tour_${session.user.id}`, 'true');
  };

  const processLocalFiles = (files, isZip) => {
    setIsFileProcessing(true);
    setDisplayName('');
    setDisplayType('');

    // Artificial delay to show the upload/parsing animation for local files
    setTimeout(() => {
      setSelectedFiles(files);
      setGithubUrl('');

      if (isZip) {
        setDisplayName(`Selected Package: ${files[0].name}`);
        setDisplayType('zip');
      } else {
        const folderName = files[0].webkitRelativePath.split('/')[0] || "Selected Folder";
        setDisplayName(`Selected Directory: ${folderName}`);
        setDisplayType('folder');
      }
      setIsFileProcessing(false);
    }, 1200);
  };

  const handleZipChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) processLocalFiles(files, true);
  };

  const handleFolderChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) processLocalFiles(files, false);
  };

  const handleExplainClick = (level) => {
    if ((!selectedFiles || selectedFiles.length === 0) && !githubUrl.trim()) {
      setPopupMsg("Please provide a GitHub repository link or select a local codebase.");
      return;
    }

    setPendingLevel(level);

    // Not logged in: show the auth wall
    if (!session) {
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setIsLocked(true);
      }, 1500);
      return;
    }

    executeAnalysis(level);
  };

  const executeAnalysis = async (levelToUse = pendingLevel) => {
    if (!levelToUse) return;

    // Always grab a fresh token so an expired one gets refreshed automatically
    const { data: { session: freshSession } } = await supabase.auth.getSession();
    const accessToken = freshSession?.access_token;
    if (!accessToken) {
      setPopupMsg("Your session has expired. Please sign in again.");
      return;
    }

    setLoading(true);
    setSummary('');
    setIsLocked(false);

    const formData = new FormData();

    if (githubUrl.trim()) {
      formData.append("github_url", githubUrl.trim());
    } else if (selectedFiles) {
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const path = file.webkitRelativePath || file.name;
        const isIgnored = IGNORE_DIRS.some(dir => path.includes(`/${dir}/`)) || IGNORE_EXTS.some(ext => path.toLowerCase().endsWith(ext));
        if (!isIgnored) formData.append("files", file);
      }
    }

    formData.append("level", levelToUse);
    formData.append("mode", activeTab);
    // The backend verifies this token and uses the user's auto-provisioned OpenRouter key
    formData.append("access_token", accessToken);

    try {
      const res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (data.error) {
        setPopupMsg(data.error);
        setLoading(false);
        return;
      }

      setSummary(data.summary);
      setProjectName(data.project_name);

      if (activeTab === 'permanent' && session?.user) {
        await supabase.from('history').insert([{
          user_id: session.user.id,
          project_name: data.project_name,
          full_analysis: data.summary,
          stack_summary: `Scan mode: ${levelToUse}`
        }]);
        fetchHistory();
      }
    } catch (err) {
      setPopupMsg("Connection error. Ensure the local parsing engine is running.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteLog = async (logId, e) => {
    e.stopPropagation();
    if (!session?.user) return;

    const { error } = await supabase.from('history').delete().eq('id', logId);
    if (!error) {
      setHistoryLogs(historyLogs.filter(log => log.id !== logId));
    } else {
      setPopupMsg("Failed to delete archive entry.");
    }
  };

  const handleClearAllArchives = async () => {
    if (!session?.user) return;
    if (!window.confirm("Are you sure you want to delete all archived analyses?")) return;

    const { error } = await supabase.from('history').delete().eq('user_id', session.user.id);
    if (!error) {
      setHistoryLogs([]);
      setSummary('');
    } else {
      setPopupMsg("Failed to clear archives.");
    }
  };

  const handleExport = (format) => {
    if (!summary) return;
    const cleanFileName = projectName.replace(/[^a-zA-Z0-9]/g, '_');

    if (format === 'pdf') {
      window.print();
    } else if (format === 'word') {
      const htmlContent = `
        <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
          <head><meta charset='utf-8'><title>${projectName}</title></head>
          <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #111; padding: 30px;">
            <h1 style="color: #4f46e5; border-bottom: 2px solid #4f46e5; padding-bottom: 10px;">${projectName} // Payload</h1>
            <div style="margin-top: 20px;">${summary.replace(/\n/g, '<br/>')}</div>
            <br/><br/>
            <div style="text-align: right; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 15px; text-transform: uppercase; letter-spacing: 2px;">
              Unpack Architecture Engine
            </div>
          </body>
        </html>
      `;
      const blob = new Blob(['\ufeff' + htmlContent], { type: 'application/msword' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${cleanFileName}.doc`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else if (format === 'ppt') {
      const pptx = new pptxgen();
      let titleSlide = pptx.addSlide();

      const addWatermark = (slide) => {
        slide.addText("UNPACK", {
          x: '20%', y: '40%', w: '60%', h: '20%',
          align: 'center', valign: 'middle', fontSize: 64,
          bold: true, color: '888888', transparency: 85, rotate: -30
        });
      };

      addWatermark(titleSlide);
      titleSlide.addText(projectName, { x: 1, y: 1.5, w: '80%', h: 1, fontSize: 28, bold: true, color: '363636' });
      titleSlide.addText("Generated by Unpack", { x: 1, y: 2.8, fontSize: 14, color: '888888' });

      const rawSections = summary.split(/(?=#{1,3}\s)/);
      const sections = rawSections.map(s => s.trim()).filter(s => s.length > 0);

      sections.forEach((section) => {
        const cleanSectionText = section.replace(/#{1,6}\s?/g, '').replace(/\*\*/g, '').trim();
        if (!cleanSectionText) return;

        let slide = pptx.addSlide();
        addWatermark(slide);
        slide.addText(cleanSectionText, {
          x: 0.8, y: 0.8, w: '85%', h: '80%', fontSize: 13, color: '333333', valign: 'top', lineSpacing: 18
        });
      });
      pptx.writeFile({ fileName: `${cleanFileName}.pptx` });
    }
  };

  const getTourPosition = (ref, position) => {
    if (!ref.current) return { top: -9999, left: -9999 };
    const rect = ref.current.getBoundingClientRect();
    const bubbleWidth = 280;

    // Base center alignment
    let left = rect.left + (rect.width / 2) - (bubbleWidth / 2);

    // Prevent horizontal overflow
    if (left < 10) left = 10;
    if (left + bubbleWidth > window.innerWidth - 10) left = window.innerWidth - bubbleWidth - 10;

    let top = position === 'bottom' ? rect.bottom + 15 : rect.top - 180;

    // Prevent vertical clipping (if bottom falls off, push above. If top falls off, push below)
    if (top + 180 > window.innerHeight) top = rect.top - 180;
    if (top < 10) top = rect.bottom + 15;

    return { top, left };
  };

  const groupedArchives = historyLogs.reduce((acc, log) => {
    const cleanName = log.project_name.split(' [')[0];
    if (!acc[cleanName]) acc[cleanName] = [];
    acc[cleanName].push(log);
    return acc;
  }, {});

  return (
    <div className="workspace-container" style={{ position: 'relative' }}>

      {popupMsg && (
        <div className="popup-overlay" style={{ zIndex: 3000 }}>
          <div className="popup-content">
            <h3 style={{ marginTop: 0, color: 'var(--text-main)' }}>System Notice</h3>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>{popupMsg}</p>
            <button className="btn-tier" onClick={() => setPopupMsg(null)} style={{ marginTop: '20px' }}>Acknowledge</button>
          </div>
        </div>
      )}

      {/* TOUR SYSTEM */}
      {tourStep > 0 && (
        <>
          <div className="tour-overlay"></div>
          {tourStep === 1 && (
            <div className="tour-bubble" style={getTourPosition(sliderRef, 'bottom')}>
              <h4 className="tour-header">Visual Settings</h4>
              <p className="tour-text">Drag this slider to seamlessly transition the UI from Light mode to Dark mode.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Skip</button>
                <button className="btn-tour-next" onClick={() => setTourStep(2)}>Next</button>
              </div>
            </div>
          )}
          {tourStep === 2 && (
            <div className="tour-bubble" style={getTourPosition(tempTabRef, 'bottom')}>
              <h4 className="tour-header">Volatile Memory</h4>
              <p className="tour-text">Temp mode processes code instantly without database storage.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Skip</button>
                <button className="btn-tour-next" onClick={() => setTourStep(3)}>Next</button>
              </div>
            </div>
          )}
          {tourStep === 3 && (
            <div className="tour-bubble" style={getTourPosition(permTabRef, 'bottom')}>
              <h4 className="tour-header">Persistent Storage</h4>
              <p className="tour-text">Permanent mode automatically archives structural breakdowns.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Skip</button>
                <button className="btn-tour-next" onClick={() => setTourStep(4)}>Next</button>
              </div>
            </div>
          )}
          {tourStep === 4 && (
            <div className="tour-bubble" style={getTourPosition(historyTabRef, 'bottom')}>
              <h4 className="tour-header">Archives</h4>
              <p className="tour-text">Access your grouped project history and pre-rendered summaries here.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Skip</button>
                <button className="btn-tour-next" onClick={() => { setActiveTab('temp'); setTourStep(5); }}>Next</button>
              </div>
            </div>
          )}
          {tourStep === 5 && (
            <div className="tour-bubble" style={getTourPosition(uploadButtonsRef, 'bottom')}>
              <h4 className="tour-header">Input Source</h4>
              <p className="tour-text">Upload directories, zip archives, or link a public GitHub repository.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Skip</button>
                <button className="btn-tour-next" onClick={() => setTourStep(6)}>Next</button>
              </div>
            </div>
          )}
          {tourStep === 6 && (
            <div className="tour-bubble" style={getTourPosition(explainButtonsRef, 'top')}>
              <h4 className="tour-header">Analysis Depth</h4>
              <p className="tour-text">Select your target output tier. Use Diagnose for a full forensic audit with ready-to-use code fixes.</p>
              <div className="tour-controls">
                <button className="btn-tour-cancel" onClick={closeTour}>Close</button>
                <button className="btn-tour-next" onClick={closeTour}>Finish</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* TABS */}
      <div className="tabs-container">
        <button ref={tempTabRef} disabled={loading} onClick={() => { setActiveTab('temp'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn ${activeTab === 'temp' ? 'active' : ''}`}>Volatile Mode</button>
        <button ref={permTabRef} disabled={loading} onClick={() => { setActiveTab('permanent'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn ${activeTab === 'permanent' ? 'active' : ''}`}>Persistent Mode</button>
        <button ref={historyTabRef} disabled={loading} onClick={() => { setActiveTab('history'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn tab-history ${activeTab === 'history' ? 'active' : ''}`}>View Archives</button>
      </div>

      {activeTab !== 'history' && (
        <div className="upload-box">
          <h2 className="upload-title">{activeTab === 'temp' ? "Volatile Workspace" : "Persistent Workspace"}</h2>
          <p className="upload-text">Link a public GitHub repository or select local source files.</p>

          <div style={{ display: 'flex', gap: '10px', maxWidth: '450px', margin: '0 auto 15px auto', position: 'relative', alignItems: 'center' }}>
            <svg style={{ position: 'absolute', left: '14px', width: '16px', height: '16px', fill: 'var(--text-muted)' }} viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
            <input
              type="text"
              placeholder="https://github.com/username/repository"
              value={githubUrl}
                          onChange={(e) => {
                setGithubUrl(e.target.value);
                if (e.target.value) {
                  setSelectedFiles(null);
                  setDisplayName(`GitHub Repo: ${e.target.value}`);
                  setDisplayType('github');
                } else {
                  setDisplayName('');
                  setDisplayType('');
                }
              }}
              disabled={loading || isFileProcessing}
              className="custom-key-input"
              style={{ margin: 0, paddingLeft: '40px' }}
            />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>— OR SELECT LOCAL SOURCE —</p>

          <input type="file" accept=".zip" ref={zipInputRef} disabled={loading || isFileProcessing} onClick={(e) => { e.target.value = null; setGithubUrl(''); }} onChange={handleZipChange} style={{ display: 'none' }} />
          <input type="file" webkitdirectory="" directory="" ref={folderInputRef} disabled={loading || isFileProcessing} onClick={(e) => { e.target.value = null; setGithubUrl(''); }} onChange={handleFolderChange} style={{ display: 'none' }} />

          <div className="upload-btn-group" ref={uploadButtonsRef}>
            <button disabled={loading || isFileProcessing} onClick={() => { setGithubUrl(''); folderInputRef.current.click(); }} className="btn-folder">Load Directory</button>
            <button disabled={loading || isFileProcessing} onClick={() => { setGithubUrl(''); zipInputRef.current.click(); }} className="btn-zip">Load Archive (.zip)</button>
          </div>

          {/* DEDICATED FILE UPLOAD/PROCESSING STATE */}
          {isFileProcessing && (
            <div className="file-upload-processing">
              <div className="loading-bar-track" style={{ maxWidth: '250px' }}>
                <div className="loading-bar-fill"></div>
              </div>
              <span style={{ fontSize: '13px', color: 'var(--success-main)', fontWeight: '600' }}>Preparing local files...</span>
            </div>
          )}

                    {!isFileProcessing && displayName && (
            <div className="selected-file-text" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
              <SourceIcon type={displayType} />
              <span>{displayName}</span>
            </div>
          )}

          <div className="action-btn-group" ref={explainButtonsRef} style={{ marginTop: '25px' }}>
            <button disabled={loading || isFileProcessing} onClick={() => handleExplainClick('minimal')} className={`btn-explain ${pendingLevel === 'minimal' ? 'active-action' : ''}`}>Quick Summary</button>
            <button disabled={loading || isFileProcessing} onClick={() => handleExplainClick('medium')} className={`btn-explain ${pendingLevel === 'medium' ? 'active-action' : ''}`}>Standard Architecture</button>
            <button disabled={loading || isFileProcessing} onClick={() => handleExplainClick('everything')} className={`btn-explain ${pendingLevel === 'everything' ? 'active-action' : ''}`}>Deep Dive Breakdown</button>
            <button disabled={loading || isFileProcessing} onClick={() => handleExplainClick('diagnose')} className={`btn-explain ${pendingLevel === 'diagnose' ? 'active-action' : ''}`}>Diagnose</button>
          </div>
        </div>
      )}

      {/* ARCHIVES AREA */}
      {activeTab === 'history' && (
        <div className="history-container">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
            <h2 className="upload-title" style={{ margin: 0 }}>Archived Analyses</h2>
            {historyLogs.length > 0 && (
              <button
                onClick={handleClearAllArchives}
                className="btn-export"
                style={{ color: '#ef4444', borderColor: '#ef4444', display: 'flex', alignItems: 'center', gap: '6px' }}
              >
                <svg style={{ width: '14px', height: '14px', fill: 'currentColor' }} viewBox="0 0 24 24"><path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2s2.54-2 6-2h8c3.46 0 6 2 6 2z" /></svg>
                Clear All Archives
              </button>
            )}
          </div>

          {Object.keys(groupedArchives).length === 0 ? <p style={{ color: 'var(--text-muted)' }}>No archives found.</p> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '20px' }}>
              {Object.entries(groupedArchives).map(([folderName, logs]) => (
                <div key={folderName} style={{ background: 'var(--bg-color)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '16px' }}>
                  <h3 style={{ marginTop: 0, marginBottom: '12px', fontSize: '16px', color: 'var(--accent-main)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <svg style={{ width: '18px', height: '18px', fill: 'var(--accent-main)' }} viewBox="0 0 24 24"><path d="M19.5 21h-15C3.38 21 3 20.62 3 20.5v-15C3 4.38 3.38 4 3.5 4h5.21l2 2h8.79c.12 0 .5.38.5.5v14c0 .12-.38.5-.5.5z" /></svg>
                    {folderName}
                  </h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {logs.map((log) => {
                      let badgeClass = '';
                      let badgeText = '';
                      if (log.project_name.includes('Quick Summary')) { badgeClass = 'badge-minimal'; badgeText = 'Quick Summary'; }
                      else if (log.project_name.includes('Standard Architecture')) { badgeClass = 'badge-medium'; badgeText = 'Standard'; }
                      else if (log.project_name.includes('Deep Dive')) { badgeClass = 'badge-everything'; badgeText = 'Deep Dive'; }
                      else if (log.project_name.includes('Diagnose')) { badgeClass = 'badge-diagnose'; badgeText = 'Diagnose'; }

                      return (
                        <div key={log.id} onClick={() => { setProjectName(log.project_name); setSummary(log.full_analysis); }} className="archive-row">
                          <div className="archive-left">
                            <span className="archive-project-name">{badgeText || "Analysis Payload"}</span>
                            {badgeText && <span className={`history-badge ${badgeClass}`}>{badgeText}</span>}
                          </div>

                          <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                            <span className="history-meta">{new Date(log.created_at).toLocaleDateString()}</span>
                            <button onClick={(e) => handleDeleteLog(log.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center' }} title="Delete this analysis">
                              <svg style={{ width: '15px', height: '15px', fill: 'var(--text-muted)', transition: 'fill 0.2s' }} onMouseOver={(e) => e.currentTarget.style.fill = '#ef4444'} onMouseOut={(e) => e.currentTarget.style.fill = 'var(--text-muted)'} viewBox="0 0 24 24"><path d="M3 6v18h18v-18h-18zm5 14c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm5 0c0 .552-.448 1-1 1s-1-.448-1-1v-10c0-.552.448-1 1-1s1 .448 1 1v10zm4-18v2h-20v-2s2.54-2 6-2h8c3.46 0 6 2 6 2z" /></svg>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* UPLOAD & PROCESSING PROGRESS BAR -> Rendered exactly where output goes */}
      {loading && (
        <div className="output-hijack-container" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '250px' }}>
          <div className="loading-bar-track">
            <div className="loading-bar-fill"></div>
          </div>
          <p className="loading-text" style={{ color: 'var(--text-main)', fontSize: '15px', fontWeight: '600', marginTop: '20px' }}>
            {pendingLevel === 'diagnose'
              ? 'Running forensic audit. This can take a few minutes...'
              : 'Unpacking project files and mapping structure...'}
          </p>
        </div>
      )}

      {/* HIJACKED OUTPUT AUTH WALL -> Glassmorphic Modern Lock Screen */}
      {isLocked && !session && !loading && (
        <div className="output-hijack-container">
          <div style={{ opacity: 0.15, pointerEvents: 'none', filter: 'blur(1px)' }}>
            <div className="skeleton-box" style={{ width: '40%', height: '32px', marginBottom: '24px' }}></div>
            <div className="skeleton-box" style={{ width: '100%', height: '16px', marginBottom: '12px' }}></div>
            <div className="skeleton-box" style={{ width: '92%', height: '16px', marginBottom: '12px' }}></div>
            <div className="skeleton-box" style={{ width: '97%', height: '16px', marginBottom: '30px' }}></div>
            <div className="skeleton-box" style={{ width: '30%', height: '24px', marginBottom: '20px' }}></div>
            <div className="skeleton-box" style={{ width: '100%', height: '16px', marginBottom: '12px' }}></div>
            <div className="skeleton-box" style={{ width: '85%', height: '16px', marginBottom: '12px' }}></div>
          </div>

          <div className="auth-overlay-blur">
            <div className="auth-card">
              <svg style={{ width: '42px', height: '42px', fill: 'var(--accent-main)', marginBottom: '15px' }} viewBox="0 0 24 24"><path d="M18 10v-4c0-3.313-2.687-6-6-6s-6 2.687-6 6v4h-3v14h18v-14h-3zm-10-4c0-2.206 1.794-4 4-4s4 1.794 4 4v4h-8v-4z" /></svg>
              <h2 style={{ margin: '0 0 10px 0', color: 'var(--text-main)', fontSize: '24px', fontWeight: '800' }}>Output generated.</h2>
              <p style={{ margin: '0 0 25px 0', color: 'var(--text-muted)', fontSize: '15px' }}>Authentication is required to view your architecture payload.</p>
              <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => onSignIn('google')} className="btn-auth btn-google">Google Auth</button>
                <button onClick={() => onSignIn('github')} className="btn-auth btn-github">GitHub Auth</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ACTUAL RESULTS CONTAINER */}
      {summary && !isLocked && !loading && (
        <div className="summary-container" style={{ position: 'relative' }}>
          <div className="print-watermark" style={{ display: 'none' }}>Unpack</div>

          <h2 style={{ marginTop: 0, color: 'var(--accent-main)' }}>{projectName} // Payload</h2>

          <div className="markdown-body">
            <ReactMarkdown>{summary}</ReactMarkdown>
          </div>

          <div className="export-toolbar">
            <button className="btn-export" onClick={() => handleExport('pdf')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg style={{ width: '14px', height: '14px', fill: 'currentColor' }} viewBox="0 0 24 24"><path d="M14 2h-12c-1.1 0-1.99.9-1.99 2l-.01 16c0 1.1.89 2 1.99 2h16c1.1 0 2-.9 2-2v-10l-6-6zm4 14h-12v-2h12v2zm0-4h-12v-2h12v2zm-3-5v-5.5l5.5 5.5h-5.5z" /></svg>
              Export PDF
            </button>
            <button className="btn-export" onClick={() => handleExport('word')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg style={{ width: '14px', height: '14px', fill: 'currentColor' }} viewBox="0 0 24 24"><path d="M6 2c-1.1 0-1.99.9-1.99 2l-.01 16c0 1.1.89 2 1.99 2h12c1.1 0 2-.9 2-2v-12l-6-6h-6zm7 7v-5l5 5h-5z" /></svg>
              Export Word
            </button>
            <button className="btn-export" onClick={() => handleExport('ppt')} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <svg style={{ width: '14px', height: '14px', fill: 'currentColor' }} viewBox="0 0 24 24"><path d="M19 3h-14c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-14c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4h-4v-2h4v-4h2v4h4v2z" /></svg>
              Export PPT
            </button>
          </div>
        </div>
      )}
    </div>
  );
}