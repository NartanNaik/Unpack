import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase, provisionKey } from './supabase';
import Workspace from './Workspace';
import './App.css';

export default function App() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showSplash, setShowSplash] = useState(true);
  const [isFading, setIsFading] = useState(false);

  // Day/Night Slider State (0 = Light, 100 = Dark)
  // Initialize directly from localStorage so it remembers the exact mix on refresh
  const [themeMix, setThemeMix] = useState(() => {
    const savedMix = localStorage.getItem('unpack_theme_mix');
    return savedMix !== null ? Number(savedMix) : 0;
  });

  const sliderRef = useRef(null);
  const provisionedFor = useRef(null); // user id we've already provisioned a key for

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
    // Timer controls how long the splash screen plays before fading out
    const fadeTimer = setTimeout(() => {
      setIsFading(true);
    }, 1800);

    const removeTimer = setTimeout(() => {
      setShowSplash(false);
    }, 2400); // Matches the 0.6s CSS transition duration

    return () => {
      clearTimeout(fadeTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  // useLayoutEffect fires synchronously BEFORE the browser paints.
  // This ensures the splash screen matches the saved theme instantly without flashing.
  useLayoutEffect(() => {
    // 1. Backgrounds fade smoothly across all 100 steps
    document.documentElement.style.setProperty('--mix', `${themeMix}%`);

    // 2. Text SNAPS at 50% to prevent unreadable grey-on-grey contrast
    const textMix = themeMix >= 50 ? 100 : 0;
    document.documentElement.style.setProperty('--text-mix', `${textMix}%`);

    // 3. Save to localStorage permanently
    localStorage.setItem('unpack_theme_mix', themeMix.toString());
  }, [themeMix]);

  const handleSignIn = async (provider) => {
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) alert("Error signing in.");
  };

  if (loading) return <div className="app-loading">Unpacking workspace...</div>;

  return (
    <div>
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

      <Workspace session={session} onSignIn={handleSignIn} sliderRef={sliderRef} />
    </div>
  );
}