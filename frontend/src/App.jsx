import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase, provisionKey } from './supabase';
import Workspace from './Workspace';
import './App.css';
import './extras.css';

const GITHUB_URL = 'https://github.com/NartanNaik';
const LINKEDIN_URL = 'https://www.linkedin.com/in/nartan-naik-90499a359';
const EMAIL = 'naiknartana@gmail.com';
const GMAIL_COMPOSE_URL = `https://mail.google.com/mail/?view=cm&fs=1&to=${EMAIL}&su=${encodeURIComponent('Hello from Unpack')}`;

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [isFading, setIsFading] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);

  // Day/Night Slider State (0 = Light, 100 = Dark)
  const [themeMix, setThemeMix] = useState(() => {
    const savedMix = localStorage.getItem('unpack_theme_mix');
    return savedMix !== null ? Number(savedMix) : 0;
  });

  const sliderRef = useRef(null);
  const contactRef = useRef(null);
  const provisionedFor = useRef(null); // user id we've already provisioned a key for
  const contactBtnRef = useRef(null); // used by the guided tour

  // Creates the user's OpenRouter key in the background right after login.
  // If this fails, /analyze will retry it on demand, so it is non-fatal.
  const ensureKey = (s) => {
    if (!s?.access_token || !s?.user) return;
    if (provisionedFor.current === s.user.id) return;
    provisionedFor.current = s.user.id;
    provisionKey(s.access_token).catch((err) => {
      console.warn('Key provisioning will be retried on first analysis:', err.message);
      provisionedFor.current = null;
    });
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setLoading(false);
      ensureKey(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'SIGNED_OUT') provisionedFor.current = null;
      // Deferred so we never do async work inside the auth callback itself
      setTimeout(() => ensureKey(session), 0);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const fadeTimer = setTimeout(() => setIsFading(true), 1800);
    const removeTimer = setTimeout(() => setShowSplash(false), 2400);
    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  // Close the Contact menu when clicking elsewhere or pressing Escape
  useEffect(() => {
    if (!contactOpen) return undefined;
    const onClick = (e) => {
      if (contactRef.current && !contactRef.current.contains(e.target)) setContactOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setContactOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [contactOpen]);

  // useLayoutEffect fires before the browser paints, so the saved theme shows instantly.
  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--mix', `${themeMix}%`);
    const textMix = themeMix >= 50 ? 100 : 0;
    document.documentElement.style.setProperty('--text-mix', `${textMix}%`);
    localStorage.setItem('unpack_theme_mix', themeMix.toString());
  }, [themeMix]);

  const handleSignIn = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) alert("Error signing in.");
  };

  if (loading) return <div className="app-loading">Unpacking workspace...</div>;

  return (
    <div>
      <div className="bg-orbit" aria-hidden="true">
        {['orbit-a', 'orbit-b'].map((cls) => (
          <div key={cls} className={`orbit-item ${cls}`}>
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 9v14l12 7 12-7V9L16 2z" stroke="var(--accent-main)" strokeWidth="2" strokeLinejoin="round" />
              <path d="M16 16L4 9m12 7l12-7m-12 7v14" stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        ))}
      </div>
      {showSplash && (
        <div className={`splash-overlay ${isFading ? 'fade-out' : ''}`}>
          <div className="splash-logo">
            <span className="brand-icon-wrapper">
              <svg className="brand-icon" viewBox="0 0 32 32" fill="none">
                <path d="M16 2L4 9v14l12 7 12-7V9L16 2z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/>
                <path d="M16 16L4 9m12 7l12-7m-12 7v14" stroke="var(--accent-main)" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </span>
            unpack
          </div>
        </div>
      )}
      <nav className="nav-bar">
        <a href="#" className="brand-logo">
          <span className="brand-icon-wrapper">
            <svg className="brand-icon" viewBox="0 0 32 32" fill="none">
              <path d="M16 2L4 9v14l12 7 12-7V9L16 2z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
              <path d="M16 16L4 9m12 7l12-7m-12 7v14" stroke="var(--accent-main)" strokeWidth="2.5" strokeLinecap="round" />
            </svg>
          </span>
          unpack
        </a>

        <div className="nav-controls">
          <div className="theme-slider-container" ref={sliderRef}>
            <span style={{ fontSize: '14px' }}><svg style={{ width: '16px', height: '16px', fill: 'var(--text-muted)' }} viewBox="0 0 24 24">
              <path d="M12 7c-2.76 0-5 2.24-5 5s2.24 5 5 5 5-2.24 5-5-2.24-5-5-5zM2 13h2c.55 0 1-.45 1-1s-.45-1-1-1H2c-.55 0-1 .45-1 1s.45 1 1 1zm18 0h2c.55 0 1-.45 1-1s-.45-1-1-1h-2c-.55 0-1 .45-1 1s.45 1 1 1zM11 2v2c0 .55.45 1 1 1s1-.45 1-1V2c0-.55-.45-1-1-1s-1 .45-1 1zm0 18v2c0 .55.45 1 1 1s1-.45 1-1v-2c0-.55-.45-1-1-1s-1 .45-1 1zM5.99 4.58c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41L5.99 4.58zm12.37 12.37c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0 .39-.39.39-1.03 0-1.41l-1.06-1.06zm1.06-10.96c.39-.39.39-1.03 0-1.41-.39-.39-1.03-.39-1.41 0l-1.06 1.06c-.39.39-.39 1.03 0 1.41s1.03.39 1.41 0l1.06-1.06zM7.05 18.36c-.39-.39-1.03-.39-1.41 0-.39.39-.39 1.03 0 1.41l1.06 1.06c.39.39 1.03.39 1.41 0s.39-1.03 0-1.41l-1.06-1.06z" />
            </svg></span>
            <input
              type="range"
              min="0"
              max="100"
              value={themeMix}
              onChange={(e) => setThemeMix(e.target.value)}
              className="theme-slider"
            />
            <span style={{ fontSize: '14px' }}><svg style={{ width: '16px', height: '16px', fill: 'var(--text-muted)' }} viewBox="0 0 24 24">
              <path d="M12.3 22.5c-5.8 0-10.5-4.7-10.5-10.5 0-3.9 2.1-7.4 5.5-9.3.5-.3 1.1.1 1 .7-.4 2.3.4 4.7 2.1 6.3 1.6 1.6 4 2.5 6.3 2.1.6-.1 1.1.5.7 1-1.9 3.4-5.4 5.5-9.3 5.5zm-5.5-16.8c-2.4 1.8-3.8 4.7-3.8 7.8 0 5.2 4.2 9.5 9.5 9.5 3.1 0 6-1.4 7.8-3.8-2.6.4-5.4-.5-7.4-2.5-2-2-2.9-4.8-2.5-7.4z" />
            </svg></span>
          </div>

          {/* CONTACT DROPDOWN */}
          <div className="contact-wrap" ref={contactRef}>
                       <button
              type="button"
              ref={contactBtnRef}
              className="btn-contact"
              aria-haspopup="menu"
              aria-expanded={contactOpen}
              onClick={() => setContactOpen((o) => !o)}
            >
              <svg style={{ width: '16px', height: '16px', fill: 'currentColor' }} viewBox="0 0 24 24">
                <path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" />
              </svg>
              Contact
              <svg className={`contact-chevron ${contactOpen ? 'open' : ''}`} style={{ width: '12px', height: '12px', fill: 'currentColor' }} viewBox="0 0 24 24">
                <path d="M7 10l5 5 5-5z" />
              </svg>
            </button>

            {contactOpen && (
              <div className="contact-menu" role="menu">
                <a
                  className="contact-item contact-email"
                  href={GMAIL_COMPOSE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => setContactOpen(false)}
                >
                  <svg viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z" /></svg>
                  <span className="ci-text">
                    <span>Email</span>
                    <small>{EMAIL}</small>
                  </span>
                </a>
                <a
                  className="contact-item contact-github"
                  href={GITHUB_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => setContactOpen(false)}
                >
                  <svg viewBox="0 0 24 24"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" /></svg>
                  <span>GitHub</span>
                </a>
                <a
                  className="contact-item contact-linkedin"
                  href={LINKEDIN_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => setContactOpen(false)}
                >
                  <svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
                  <span>LinkedIn</span>
                </a>
              </div>
            )}
          </div>

          {session ? (
            <>
              <span className="user-email">{session.user.email}</span>
              <button onClick={() => supabase.auth.signOut()} className="btn-logout">
                Sign Out
              </button>
            </>
          ) : (
            <>
              <button onClick={() => handleSignIn('google')} className="btn-auth btn-google">Google</button>
              <button onClick={() => handleSignIn('github')} className="btn-auth btn-github">GitHub</button>
            </>
          )}
        </div>
      </nav>

            <Workspace session={session} onSignIn={handleSignIn} sliderRef={sliderRef} contactBtnRef={contactBtnRef} />
    </div>
  );
}