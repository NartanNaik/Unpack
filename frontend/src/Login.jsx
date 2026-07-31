import { supabase } from './supabase';

export default function Login() {
  const handleGoogleLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google' });
    if (error) console.error("Error with Google:", error.message);
  };

  const handleGithubLogin = async () => {
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'github' });
    if (error) console.error("Error with GitHub:", error.message);
  };

  return (
    <div style={{ padding: '50px', textAlign: 'center', fontFamily: 'sans-serif' }}>
      <h1>Welcome to Unpack 📦</h1>
      <p style={{ marginBottom: '30px' }}>Sign in to scan and analyze your codebases.</p>
      
      <button onClick={handleGoogleLogin} style={{ margin: '10px', padding: '10px 20px', cursor: 'pointer' }}>
        Continue with Google
      </button>
      
      <button onClick={handleGithubLogin} style={{ margin: '10px', padding: '10px 20px', cursor: 'pointer' }}>
        Continue with GitHub
      </button>
    </div>
  );
}