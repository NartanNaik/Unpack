import { supabase } from './supabase';

export default function Login({ onSignIn }) {
  const signIn = async (provider) => {
    if (onSignIn) return onSignIn(provider);
    const { error } = await supabase.auth.signInWithOAuth({ provider });
    if (error) {
      console.error(`Error with ${provider}:`, error.message);
      alert('Error signing in. Please try again.');
    }
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1 style={{ display: 'inline-flex', alignItems: 'center', gap: '12px' }}>
        <svg style={{ width: '32px', height: '32px' }} viewBox="0 0 32 32" fill="none">
          <path d="M16 2L4 9v14l12 7 12-7V9L16 2z" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
          <path d="M16 16L4 9m12 7l12-7m-12 7v14" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        Welcome to Unpack
      </h1>
      <p style={{ marginBottom: '30px' }}>Sign in to scan and analyze your codebases.</p>

      <button onClick={() => signIn('google')} style={{ margin: '10px', padding: '10px 20px', cursor: 'pointer' }}>
        Continue with Google
      </button>

      <button onClick={() => signIn('github')} style={{ margin: '10px', padding: '10px 20px', cursor: 'pointer' }}>
        Continue with GitHub
      </button>
    </div>
  );
}