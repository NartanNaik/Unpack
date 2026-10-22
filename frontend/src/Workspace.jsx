import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { supabase, API_URL } from './supabase';
import { streamAnalysis } from './analyzeClient';
import { exportPdf, exportWord, exportPpt } from './exporters';

// ---------------------------------------------------------------------------
// Local file filtering (same idea as .gitignore)
// ---------------------------------------------------------------------------
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', '.svelte-kit',
  '.cache', '.parcel-cache', '.turbo', '__pycache__', 'venv', '.venv', 'env',
  'site-packages', '.pytest_cache', '.mypy_cache', '.tox', 'vendor', 'target',
  'coverage', '.vercel', '.idea', '.vscode', 'uploaded_projects', 'pods', '.gradle',
  '__macosx',
]);
const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'poetry.lock',
  'pipfile.lock', 'composer.lock', '.ds_store', 'thumbs.db',
]);
const IGNORE_EXTS = [
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp',
  '.mp4', '.mov', '.mp3', '.wav', '.pdf', '.lock', '.pyc', '.map', '.min.js', '.min.css',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.zip', '.tar', '.gz', '.rar', '.7z', '.exe', '.dll', '.so', '.bin', '.db', '.sqlite',
];
const MAX_FILE_BYTES = 500 * 1024;       // skip any single file over 500 KB
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // Vercel rejects request bodies over ~4.5 MB

// skipRoot: for picked folders the first path segment is the folder itself, not a dependency dir
const shouldIgnore = (path, size = 0, skipRoot = false) => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return true;
  const name = parts[parts.length - 1].toLowerCase();
  const dirs = skipRoot ? parts.slice(1, -1) : parts.slice(0, -1);
  if (dirs.some((p) => IGNORE_DIRS.has(p.toLowerCase()))) return true;
  if (IGNORE_FILES.has(name) || name.startsWith('.env')) return true; // never upload secrets
  if (IGNORE_EXTS.some((ext) => name.endsWith(ext))) return true;
  return size > MAX_FILE_BYTES;
};

const formatSize = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// ---------------------------------------------------------------------------
// Live status messages
// ---------------------------------------------------------------------------
const STEP_LABELS = ['Prepare', 'Read code', 'Analyze', 'Finish'];
const STAGE_TO_STEP = { start: 0, upload: 0, auth: 0, fetch: 0, extract: 0, scan: 1, analyze: 2, finalize: 3 };

const ROTATING = {
  start: ['Getting things ready...', 'Warming up the engine...'],
  upload: ['Sending your files to the server...', 'Uploading source files securely...'],
  auth: ['Verifying your session...', 'Preparing your private access...'],
  fetch: ['Downloading the repository from GitHub...', 'Pulling the project files...', 'Fetching the source code...'],
  extract: ['Unpacking the archive...', 'Sorting files and folders...'],
  scan: ['Reading your source files...', 'Mapping folders and dependencies...', 'Skipping build output and libraries...', 'Collecting the important code...'],
  finalize: ['Polishing the final report...', 'Formatting the output...', 'Almost done...'],
};

const THINK_LADDER = {
  minimal: [
    [0, 'Sending your code to the AI...'], [5, 'The AI is reading through your project...'],
    [14, 'Working out the core idea...'], [28, 'Drafting your summary...'],
    [45, 'Almost done, polishing the summary...'], [75, 'Taking a little longer than usual, still working...'],
  ],
  medium: [
    [0, 'Sending your code to the AI...'], [8, 'The AI is reading through your project...'],
    [20, 'Mapping the architecture...'], [40, 'Listing features and data models...'],
    [70, 'Drafting the overview...'], [100, 'Almost there, finishing the write-up...'],
    [140, 'Still working, bigger projects need more time...'],
  ],
  everything: [
    [0, 'Sending your code to the AI...'], [10, 'The AI is reading through your project...'],
    [25, 'Tracing the system architecture...'], [50, 'Reviewing the tech stack and libraries...'],
    [80, 'Mapping the data flow...'], [115, 'Documenting files and folders...'],
    [150, 'Checking for security and technical debt...'], [190, 'Almost done, assembling the breakdown...'],
    [230, 'Taking longer than usual, hang tight...'],
  ],
  diagnose: [
    [0, 'Sending your code to the AI...'], [12, 'Studying every file in your project...'],
    [30, 'Tracing imports between files...'], [55, 'Cross-checking for broken links and missing logic...'],
    [90, 'Writing fixes for the gaps it found...'], [130, 'Auditing security and performance...'],
    [170, 'Compiling the forensic report...'], [210, 'Almost there, finalizing the audit...'],
    [250, 'This one is big. Still working, please keep this tab open...'],
  ],
};

const formatClock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function getStatus({ stage, level, stageElapsed, live, uploadPct }) {
  if (stage === 'upload') {
    if (uploadPct !== null && uploadPct < 100) return { main: `Uploading your files... ${uploadPct}%`, sub: '' };
    return { main: 'Upload complete. Waking up the server...', sub: '' };
  }

  if (stage === 'analyze') {
    const ladder = THINK_LADDER[level] || THINK_LADDER.medium;
    let main = ladder[0][1];
    for (const [t, m] of ladder) if (stageElapsed >= t) main = m;

    if (live.attempt > 1 && stageElapsed < 8) {
      main = `Switching to a backup AI model (${live.attempt} of ${live.total})...`;
    } else if (live.words > 0 && live.section) {
      main = `Writing: ${live.section}`;
    }

    let sub = '';
    if (live.words > 0) sub = `${live.words.toLocaleString()} words written so far`;
    else if (live.scannedKb) sub = `Read ${live.scannedKb.toLocaleString()} KB of source code${live.truncated ? ' (trimmed to fit)' : ''}`;
    return { main, sub };
  }

  const pool = ROTATING[stage] || ROTATING.start;
  return { main: pool[Math.floor(stageElapsed / 3.5) % pool.length], sub: '' };
}

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
  const [selectedFiles, setSelectedFiles] = useState(null); // array of { file, path }
  const [projectLabel, setProjectLabel] = useState('');
  const [githubUrl, setGithubUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [displayType, setDisplayType] = useState('');

  const [loading, setLoading] = useState(false);
  const [isFileProcessing, setIsFileProcessing] = useState(false);

  const [summary, setSummary] = useState('');
  const [projectName, setProjectName] = useState('');
  const [historyLogs, setHistoryLogs] = useState([]);

  const [isLocked, setIsLocked] = useState(false);
  const [pendingLevel, setPendingLevel] = useState(null);
  const [popupMsg, setPopupMsg] = useState(null);
  const [exporting, setExporting] = useState(null);

  // Live status state
  const [stage, setStage] = useState('start');
  const [live, setLive] = useState({});
  const [uploadPct, setUploadPct] = useState(null);
  const [canCancel, setCanCancel] = useState(false);
  const [, setTick] = useState(0);
  const stageStartRef = useRef(Date.now());
  const loadStartRef = useRef(Date.now());
  const abortRef = useRef(null);

  // Tour States
  const [tourStep, setTourStep] = useState(0);
  const tempTabRef = useRef(null);
  const permTabRef = useRef(null);
  const historyTabRef = useRef(null);
  const uploadButtonsRef = useRef(null);
  const explainButtonsRef = useRef(null);

  const zipInputRef = useRef(null);
  const folderInputRef = useRef(null);

  const busy = loading || isFileProcessing;
  const runningRef = useRef(false); // blocks double-clicks before React re-renders

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
      setSummary('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Re-render twice a second while loading so the timer and messages keep moving
  useEffect(() => {
    if (!loading) return undefined;
    const id = setInterval(() => setTick((t) => t + 1), 500);
    return () => clearInterval(id);
  }, [loading]);

  // Handle Tour auto-scrolling so elements are always on screen
  useEffect(() => {
    const refs = [null, sliderRef, tempTabRef, permTabRef, historyTabRef, uploadButtonsRef, explainButtonsRef];
    const currentRef = refs[tourStep];
    if (currentRef?.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tourStep, sliderRef]);

  const closeTour = () => {
    setTourStep(0);
    if (session?.user) localStorage.setItem(`tour_${session.user.id}`, 'true');
  };

  // ------------------------------------------------------------------ file selection
  const clearSelection = () => {
    setSelectedFiles(null);
    setProjectLabel('');
  };

  const processFolder = (files) => {
    setIsFileProcessing(true);
    setDisplayName('');
    setDisplayType('');

    setTimeout(() => {
      const all = Array.from(files);
      const kept = [];
      let total = 0;
      for (const f of all) {
        const path = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
        if (shouldIgnore(path, f.size, true)) continue;
        kept.push({ file: f, path });
        total += f.size;
      }
      const folderName = (files[0].webkitRelativePath || '').split('/')[0] || 'Selected Folder';

      if (kept.length === 0) {
        setPopupMsg('No readable source files were found in this folder after skipping dependencies, build output and binaries.');
        clearSelection();
      } else if (total > MAX_TOTAL_BYTES) {
        setPopupMsg(`After skipping dependencies and binaries, ${folderName} is still ${formatSize(total)}. The limit is about 4 MB. Use the GitHub link for large projects.`);
        clearSelection();
      } else {
        setSelectedFiles(kept);
        setProjectLabel(folderName);
        setGithubUrl('');
        setDisplayName(`Selected Directory: ${folderName} (${kept.length} files, ${formatSize(total)}, ${all.length - kept.length} skipped)`);
        setDisplayType('folder');
      }
      setIsFileProcessing(false);
    }, 400);
  };

  // Zips are opened in the browser so dependency folders can be filtered out before upload
  const processZip = async (zipFile) => {
    setIsFileProcessing(true);
    setDisplayName('');
    setDisplayType('');
    try {
      const { default: JSZip } = await import('jszip');
      const zip = await JSZip.loadAsync(zipFile);
      const entries = Object.values(zip.files).filter((e) => !e.dir);
      const kept = [];
      let total = 0;
      let skipped = 0;

      for (const entry of entries) {
        const path = entry.name.replace(/\\/g, '/');
        if (shouldIgnore(path, 0, false)) { skipped++; continue; }
        const blob = await entry.async('blob');
        if (blob.size > MAX_FILE_BYTES) { skipped++; continue; }
        total += blob.size;
        if (total > MAX_TOTAL_BYTES) {
          setPopupMsg(`After skipping dependencies and binaries, this archive is still over 4 MB of source. Use the GitHub link for large projects.`);
          clearSelection();
          return;
        }
        kept.push({ file: new File([blob], path.split('/').pop()), path });
      }

      if (kept.length === 0) {
        setPopupMsg('No readable source files were found in this archive after skipping dependencies, build output and binaries.');
        clearSelection();
        return;
      }

      const label = zipFile.name.replace(/\.zip$/i, '');
      setSelectedFiles(kept);
      setProjectLabel(label);
      setGithubUrl('');
      setDisplayName(`Selected Package: ${zipFile.name} (${kept.length} files, ${formatSize(total)}, ${skipped} skipped)`);
      setDisplayType('zip');
    } catch {
      setPopupMsg('That archive could not be opened. It may be corrupted or not a valid .zip file.');
      clearSelection();
    } finally {
      setIsFileProcessing(false);
    }
  };

  const handleZipChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) processZip(files[0]);
  };

  const handleFolderChange = (e) => {
    const files = e.target.files;
    if (files.length > 0) processFolder(files);
  };

  // ------------------------------------------------------------------ analysis
  const resetStatus = (hasUpload) => {
    const now = Date.now();
    stageStartRef.current = now;
    loadStartRef.current = now;
    setLive({});
    setUploadPct(hasUpload ? 0 : null);
    setStage(hasUpload ? 'upload' : 'start');
  };

  const handleExplainClick = (level) => {
    if (busy || runningRef.current) return;

    if ((!selectedFiles || selectedFiles.length === 0) && !githubUrl.trim()) {
      setPopupMsg("Please provide a GitHub repository link or select a local codebase.");
      return;
    }

    setPendingLevel(level);

    // Not logged in: show the auth wall
    if (!session) {
      resetStatus(false);
      setLoading(true);
      setTimeout(() => {
        setLoading(false);
        setIsLocked(true);
      }, 1500);
      return;
    }

    // Lock everything immediately, before any await
    runningRef.current = true;
    resetStatus(!githubUrl.trim() && !!selectedFiles?.length);
    setLoading(true);
    executeAnalysis(level);
  };

  const cancelRun = () => {
    if (abortRef.current) abortRef.current.abort();
  };

  const executeAnalysis = async (levelToUse) => {
    const controller = new AbortController();
    abortRef.current = controller;
    setCanCancel(true);

    let result = null;
    let errorMessage = null;

    try {
      // Always grab a fresh token so an expired one gets refreshed automatically
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      const accessToken = freshSession?.access_token;
      if (!accessToken) {
        setPopupMsg("Your session has expired. Please sign in again.");
        return;
      }

      setSummary('');
      setIsLocked(false);

      const formData = new FormData();
      if (githubUrl.trim()) {
        formData.append("github_url", githubUrl.trim());
      } else if (selectedFiles) {
        for (const entry of selectedFiles) {
          formData.append("files", entry.file, entry.path);
        }
        if (projectLabel) formData.append("project_name", projectLabel);
      }
      formData.append("level", levelToUse);
      formData.append("mode", activeTab);
      // The backend verifies this token and uses the user's auto-provisioned OpenRouter key
      formData.append("access_token", accessToken);

      const onEvent = (ev) => {
        if (ev.type === 'stage') {
          setStage(ev.stage);
          stageStartRef.current = Date.now();
          if (ev.stage === 'analyze') {
            setLive((l) => ({ ...l, model: ev.model, attempt: ev.attempt, total: ev.total, words: 0, section: '' }));
          }
        } else if (ev.type === 'scanned') {
          setLive((l) => ({ ...l, scannedKb: Math.max(1, Math.round(ev.chars / 1024)), truncated: ev.truncated }));
        } else if (ev.type === 'progress') {
          setLive((l) => ({ ...l, words: ev.words, section: ev.section || l.section }));
        } else if (ev.type === 'result') {
          result = ev;
        } else if (ev.type === 'error') {
          errorMessage = ev.message;
        }
      };

      await streamAnalysis({
        url: `${API_URL}/analyze`,
        formData,
        signal: controller.signal,
        onUpload: setUploadPct,
        onEvent,
      });

      if (errorMessage) {
        setPopupMsg(errorMessage);
        return;
      }
      if (!result) {
        setPopupMsg("The server closed the connection before the analysis finished. It most likely hit the server time limit. Try a smaller project or a lighter analysis level.");
        return;
      }

      setSummary(result.summary);
      setProjectName(result.project_name);

      if (activeTab === 'permanent' && session?.user) {
        await supabase.from('history').insert([{
          user_id: session.user.id,
          project_name: result.project_name,
          full_analysis: result.summary,
          stack_summary: `Scan mode: ${levelToUse}`
        }]);
        fetchHistory();
      }
    } catch (err) {
      if (err?.aborted) return; // user cancelled
      if (err?.status === 413) {
        setPopupMsg("The upload is too large for the server. Use the GitHub link or select a smaller folder.");
      } else if (err?.status) {
        setPopupMsg(`The server returned an error (HTTP ${err.status}). Please try again in a moment.`);
      } else {
        setPopupMsg("The connection to the server was lost before the analysis finished. Large Diagnose runs can hit the server time limit. Try a smaller project or a lighter analysis level.");
      }
    } finally {
      setLoading(false);
      setCanCancel(false);
      abortRef.current = null;
      runningRef.current = false;
    }
  };

  // ------------------------------------------------------------------ archives
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

  // ------------------------------------------------------------------ export
  const handleExport = async (format) => {
    if (!summary || exporting) return;
    setExporting(format);
    try {
      if (format === 'pdf') await exportPdf(summary, projectName);
      else if (format === 'word') await exportWord(summary, projectName);
      else if (format === 'ppt') await exportPpt(summary, projectName);
    } catch (err) {
      console.error('Export failed:', err);
      setPopupMsg("Could not create that file. Please try again.");
    } finally {
      setExporting(null);
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

  // Status text for the loading panel
  const stageElapsed = (Date.now() - stageStartRef.current) / 1000;
  const totalElapsed = (Date.now() - loadStartRef.current) / 1000;
  const status = getStatus({ stage, level: pendingLevel, stageElapsed, live, uploadPct });
  const activeStep = STAGE_TO_STEP[stage] ?? 0;

  const exportBtn = (format, label, iconPath) => (
    <button
      className="btn-export"
      disabled={!!exporting}
      onClick={() => handleExport(format)}
      style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
    >
      <svg style={{ width: '14px', height: '14px', fill: 'currentColor' }} viewBox="0 0 24 24"><path d={iconPath} /></svg>
      {exporting === format ? 'Preparing...' : label}
    </button>
  );

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
        <button ref={tempTabRef} disabled={busy} onClick={() => { setActiveTab('temp'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn ${activeTab === 'temp' ? 'active' : ''}`}>Volatile Mode</button>
        <button ref={permTabRef} disabled={busy} onClick={() => { setActiveTab('permanent'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn ${activeTab === 'permanent' ? 'active' : ''}`}>Persistent Mode</button>
        <button ref={historyTabRef} disabled={busy} onClick={() => { setActiveTab('history'); setSummary(''); setPendingLevel(null); setIsLocked(false); }} className={`tab-btn tab-history ${activeTab === 'history' ? 'active' : ''}`}>View Archives</button>
      </div>

      {activeTab !== 'history' && (
        <div className="upload-box">
          <h2 className="upload-title">{activeTab === 'temp' ? "Volatile Workspace" : "Persistent Workspace"}</h2>
          <p className="upload-text">Link a public GitHub repository or select local source files. Dependencies, build output and large files are skipped automatically.</p>

          <div style={{ display: 'flex', gap: '10px', maxWidth: '450px', margin: '0 auto 15px auto', position: 'relative', alignItems: 'center' }}>
            <svg style={{ position: 'absolute', left: '14px', width: '16px', height: '16px', fill: 'var(--text-muted)' }} viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
            <input
              type="text"
              placeholder="https://github.com/username/repository"
              value={githubUrl}
              onChange={(e) => {
                setGithubUrl(e.target.value);
                if (e.target.value) {
                  clearSelection();
                  setDisplayName(`GitHub Repo: ${e.target.value}`);
                  setDisplayType('github');
                } else {
                  setDisplayName('');
                  setDisplayType('');
                }
              }}
              disabled={busy}
              className="custom-key-input"
              style={{ margin: 0, paddingLeft: '40px' }}
            />
          </div>
          <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '20px' }}>— OR SELECT LOCAL SOURCE —</p>

          <input type="file" accept=".zip" ref={zipInputRef} disabled={busy} onClick={(e) => { e.target.value = null; }} onChange={handleZipChange} style={{ display: 'none' }} />
          <input type="file" webkitdirectory="" directory="" ref={folderInputRef} disabled={busy} onClick={(e) => { e.target.value = null; }} onChange={handleFolderChange} style={{ display: 'none' }} />

          <div className="upload-btn-group" ref={uploadButtonsRef}>
            <button disabled={busy} onClick={() => folderInputRef.current.click()} className="btn-folder">Load Directory</button>
            <button disabled={busy} onClick={() => zipInputRef.current.click()} className="btn-zip">Load Archive (.zip)</button>
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
            {[
              ['minimal', 'Quick Summary'],
              ['medium', 'Standard Architecture'],
              ['everything', 'Deep Dive Breakdown'],
              ['diagnose', 'Diagnose'],
            ].map(([lvl, label]) => (
              <button
                key={lvl}
                disabled={busy}
                onClick={() => handleExplainClick(lvl)}
                className={`btn-explain ${pendingLevel === lvl ? 'active-action' : ''}`}
              >
                {loading && pendingLevel === lvl ? 'Running...' : label}
              </button>
            ))}
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

      {/* LIVE PROGRESS PANEL -> Rendered exactly where output goes */}
      {loading && (
        <div className="output-hijack-container loading-panel">
          <div className="loading-bar-track">
            <div className="loading-bar-fill"></div>
          </div>

          <div className="step-track">
            {STEP_LABELS.map((label, i) => (
              <div key={label} className={`step-pill ${i < activeStep ? 'done' : ''} ${i === activeStep ? 'active' : ''}`}>
                <span className="step-dot"></span>
                {label}
              </div>
            ))}
          </div>

          <p key={status.main} className="status-message">{status.main}</p>
          {status.sub && <p className="status-sub">{status.sub}</p>}

          <div className="status-meta">
            Elapsed {formatClock(totalElapsed)}{live.model && stage === 'analyze' ? `  |  ${live.model}` : ''}
          </div>

          {canCancel && (
            <button className="btn-cancel-run" onClick={cancelRun}>Cancel</button>
          )}
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
            {exportBtn('pdf', 'Export PDF', 'M14 2h-12c-1.1 0-1.99.9-1.99 2l-.01 16c0 1.1.89 2 1.99 2h16c1.1 0 2-.9 2-2v-10l-6-6zm4 14h-12v-2h12v2zm0-4h-12v-2h12v2zm-3-5v-5.5l5.5 5.5h-5.5z')}
            {exportBtn('word', 'Export Word', 'M6 2c-1.1 0-1.99.9-1.99 2l-.01 16c0 1.1.89 2 1.99 2h12c1.1 0 2-.9 2-2v-12l-6-6h-6zm7 7v-5l5 5h-5z')}
            {exportBtn('ppt', 'Export PPT', 'M19 3h-14c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-14c0-1.1-.9-2-2-2zm-2 10h-4v4h-2v-4h-4v-2h4v-4h2v4h4v2z')}
          </div>
        </div>
      )}
    </div>
  );
}