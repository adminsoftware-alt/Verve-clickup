import React, { useRef, useState } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail } from 'firebase/auth';
import { DevSignIn } from '../components/DevSignIn';
import { BrandMark } from '../components/BrandMark';
import { auth } from '../core/firebase';
import { isAllowedDomain } from '../utils/auth';
import { AlertCircle, Check, Eye, EyeOff, Loader2, MailCheck } from 'lucide-react';

export const Login: React.FC = () => {
  const [isRegistering, setIsRegistering] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [needEmail, setNeedEmail] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setError(null);
      setLoading(true);
      if (isRegistering) {
        if (!isAllowedDomain(email)) {
          setError('Only authorized organization email accounts are allowed.');
          setLoading(false);
          return;
        }
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        const credential = await signInWithEmailAndPassword(auth, email, password);
        if (!isAllowedDomain(credential.user.email)) {
          await auth.signOut();
          setError('Unauthorized email domain. Access denied.');
          setLoading(false);
          return;
        }
      }
    } catch (err: any) {
      if (err.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists.');
      } else if (err.code === 'auth/invalid-credential' || err.code === 'auth/wrong-password') {
        setError('Invalid email or password.');
      } else if (err.code === 'auth/weak-password') {
        setError('Password should be at least 6 characters.');
      } else {
        console.error("Login error:", err);
        setError(isRegistering ? `Failed to create an account: ${err.message}` : `Failed to log in: ${err.message}`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    try {
      setError(null);
      setLoading(true);
      const provider = new GoogleAuthProvider();
      const credential = await signInWithPopup(auth, provider);
      if (!isAllowedDomain(credential.user.email)) {
        await auth.signOut();
        setError('Unauthorized email domain. Access denied.');
        setLoading(false);
        return;
      }
    } catch (err: any) {
      if (err.code === 'auth/unauthorized-domain') {
        setError(`Google sign-in is not enabled for ${window.location.hostname}. Open the app via an authorized domain (e.g. localhost).`);
      } else if (err.code !== 'auth/popup-closed-by-user') {
        console.error("Google sign-in error:", err);
        setError(`Failed to sign in with Google (${err.code ?? 'unknown error'}).`);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    // No email yet: point at the field instead of showing an error.
    if (!email) {
      setError(null);
      setNeedEmail(true);
      emailRef.current?.focus();
      return;
    }
    try {
      setLoading(true);
      setError(null);
      setResetMessage(null);
      await sendPasswordResetEmail(auth, email);
      setResetMessage('Password reset email sent. Please check your inbox.');
    } catch (err: any) {
      setError(`Failed to send reset email: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // The firm's logo in the email field from the "@" on: faint while the domain is still being
  // typed, full once it is the firm's, gone when the domain is someone else's.
  const domain = email.includes('@') ? email.split('@')[1].toLowerCase() : null;
  const company = domain === null ? 'none'
    : isAllowedDomain(email) ? 'match'
    : 'verveadvisory.com'.startsWith(domain) ? 'typing' : 'none';

  const watchCapsLock =(e: React.KeyboardEvent) => setCapsLock(e.getModifierState('CapsLock'));

  return (
    <main className="signin-page">
      {/* Left: Verveflow, what it is, and the firm behind it. "flow" slides out from behind
          "verve" as the page opens. On a phone this folds to the wordmark above the card. */}
      <section className="signin-brand">
        <div className="signin-wordmark">
          <BrandMark size={60} />
          <div>
            <b aria-label="verveflow"><span className="is-verve">verve</span><span className="is-flow-clip"><span className="is-flow">flow</span></span></b>
            <small>Tasks · Time · Teams</small>
          </div>
        </div>
        <h1 className="signin-headline">Every task, every hour, in one calm place.</h1>
        <p className="signin-lede">The workspace where Verve Advisory plans work, logs time and keeps every team in step.</p>
        <div className="signin-endorse">
          <span>A workspace by</span>
          <img src="/verve-advisory-logo.png" alt="Verve Advisory" />
        </div>
      </section>

      <div className="signin-right">
      {/* The logo made into the page: the form is the front card of the stack, the two cards
          behind fan out as it opens and the tick on its corner draws itself in. */}
      <div className="signin-stack">
        <div className="signin-back is-far" aria-hidden="true" />
        <div className="signin-back is-near" aria-hidden="true" />
        <div className="signin-card">
          <span className="signin-seal" aria-hidden="true"><Check size={22} strokeWidth={3} /></span>

          <h2 className="signin-title">{isRegistering ? 'Create your Verveflow account' : 'Sign in to Verveflow'}</h2>
          <p className="signin-sub">Use your Verve Advisory work account.</p>

          {error && (
            <div className="signin-note is-error" role="alert"><AlertCircle size={16} /><span>{error}</span></div>
          )}
          {resetMessage && (
            <div className="signin-note is-info" role="status"><MailCheck size={16} /><span>{resetMessage}</span></div>
          )}

          <button type="button" onClick={handleGoogleLogin} disabled={loading} className="signin-google">
            <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>

          <div className="signin-or"><span>or with email</span></div>

          <form onSubmit={handleSubmit} className="signin-fields">
            <div>
              <label htmlFor="signin-email" className="signin-label">Work email</label>
              <div className="relative">
                <input
                  id="signin-email"
                  ref={emailRef}
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setNeedEmail(false); }}
                  required
                  autoFocus
                  autoComplete="email"
                  placeholder="you@verveadvisory.com"
                  className={`signin-input${company !== 'none' ? ' has-company' : ''}`}
                />
                {company !== 'none' && (
                  <span className={`signin-company is-${company}`} aria-hidden="true">
                    <img src="/verve-advisory-logo.png" alt="" />
                  </span>
                )}
              </div>
              {needEmail
                ? <p className="signin-hint is-ask">Enter your email, then press Forgot password again.</p>
                : <p className="signin-hint">Only @verveadvisory.com accounts can sign in.</p>}
            </div>

            <div>
              <div className="signin-label-row">
                <label htmlFor="signin-password" className="signin-label">Password</label>
                {!isRegistering && (
                  <button type="button" onClick={handleForgotPassword} className="signin-link">Forgot password?</button>
                )}
              </div>
              <div className="relative">
                <input
                  id="signin-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={watchCapsLock}
                  onKeyUp={watchCapsLock}
                  onBlur={() => setCapsLock(false)}
                  required
                  minLength={6}
                  autoComplete={isRegistering ? 'new-password' : 'current-password'}
                  className="signin-input pr-11"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  className="signin-eye"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {capsLock && <p className="signin-hint is-ask">Caps Lock is on.</p>}
            </div>

            <button type="submit" disabled={loading} className="signin-submit">
              {loading && <Loader2 size={17} className="animate-spin" aria-hidden="true" />}
              {isRegistering ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="signin-switch">
            {isRegistering ? 'Already have an account? ' : "Don't have an account? "}
            <button type="button" onClick={() => setIsRegistering(!isRegistering)} className="signin-link">
              {isRegistering ? 'Sign in' : 'Sign up'}
            </button>
          </p>
        </div>
      </div>

      <div className="signin-dev"><DevSignIn /></div>
      </div>
    </main>
  );
};
