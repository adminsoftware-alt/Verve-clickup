import React, { useState, useEffect } from 'react';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, GoogleAuthProvider, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../core/firebase';
import { isAllowedDomain } from '../utils/auth';
import { Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const features = [
  { title: "Streamline your workflow", description: "Manage tasks, projects, and deadlines seamlessly in one place." },
  { title: "Track time effortlessly", description: "Log your hours accurately and gain insights into your productivity." },
  { title: "Manage your team", description: "Assign roles, monitor workloads, and collaborate with precision." }
];

export const Login: React.FC = () => {
  const [currentFeatureIndex, setCurrentFeatureIndex] = useState(0);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentFeatureIndex((prev) => (prev + 1) % features.length);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const [isRegistering, setIsRegistering] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (!email) {
      setError('Please enter your email address to reset your password.');
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

  return (
    <div style={{ 
      display: 'flex', 
      height: '100vh', 
      width: '100vw', 
      background: 'linear-gradient(135deg, #fdfbfb 0%, #ebedee 100%)', 
      alignItems: 'center', 
      justifyContent: 'center', 
      padding: '20px', 
      boxSizing: 'border-box' 
    }}>
      <motion.div 
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
        style={{ 
          display: 'flex', 
          width: '100%', 
          maxWidth: '1100px', 
          height: '80vh',
          minHeight: '650px',
          maxHeight: '850px',
          background: 'rgba(255, 255, 255, 0.85)',
          backdropFilter: 'blur(30px)',
          WebkitBackdropFilter: 'blur(30px)',
          borderRadius: '24px', 
          boxShadow: '0 40px 80px -20px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(255,255,255,0.5) inset', 
          overflow: 'hidden' 
        }}
      >
      {/* Left Side - Branding */}
      <div style={{ 
        flex: 1, 
        backgroundColor: '#1E1B4B', 
        backgroundImage: 'linear-gradient(rgba(30, 27, 75, 0.75), rgba(79, 70, 229, 0.75)), url("/image.png")',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        color: 'white',
        position: 'relative'
      }}>
        <div style={{ zIndex: 1, textAlign: 'center', maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
           <h1 style={{ fontFamily: '"SF Pro Display", -apple-system, sans-serif', fontSize: '3.5rem', fontWeight: 800, marginBottom: '3rem', letterSpacing: '-0.04em', textShadow: '0 4px 15px rgba(0,0,0,0.3)' }}>
             Timetriq
           </h1>
           
           <div style={{ position: 'relative', height: '140px', width: '100%', maxWidth: '450px' }}>
             <AnimatePresence mode="wait">
               <motion.div
                 key={currentFeatureIndex}
                 initial={{ opacity: 0, y: 15 }}
                 animate={{ opacity: 1, y: 0 }}
                 exit={{ opacity: 0, y: -15 }}
                 transition={{ duration: 0.5, ease: "easeOut" }}
                 style={{ position: 'absolute', top: 0, left: 0, width: '100%' }}
               >
                 <h3 style={{ 
                   fontSize: '1.75rem', 
                   fontWeight: 700, 
                   marginBottom: '1rem',
                   textShadow: '0 2px 10px rgba(0,0,0,0.2)',
                   letterSpacing: '-0.02em'
                 }}>
                   {features[currentFeatureIndex].title}
                 </h3>
                 <p style={{ 
                   fontSize: '1.1rem', 
                   lineHeight: 1.6,
                   textShadow: '0 1px 5px rgba(0,0,0,0.2)',
                   fontWeight: 400,
                   opacity: 0.9
                 }}>
                   {features[currentFeatureIndex].description}
                 </p>
               </motion.div>
             </AnimatePresence>
           </div>
        </div>
      </div>

      {/* Right Side - Form */}
      <div style={{ 
        flex: 1, 
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '40px',
        overflowY: 'auto'
      }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <AnimatePresence mode="wait">
            <motion.div
              key={isRegistering ? "signup" : "login"}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 10 }}
              transition={{ duration: 0.3 }}
            >
              <h2 style={{ marginBottom: '0.5rem', textAlign: 'center', color: '#111827', fontSize: '2rem', fontWeight: 800, letterSpacing: '-0.03em' }}>
                {isRegistering ? 'Create Account' : 'Welcome Back'}
              </h2>
              <p style={{ textAlign: 'center', color: '#6B7280', marginBottom: '2.5rem', fontSize: '0.9rem' }}>
                {isRegistering ? 'Sign up for a Verve Advisory account.' : 'Sign in to your Verve Advisory account.'}
              </p>
            </motion.div>
          </AnimatePresence>
        
        {error && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ backgroundColor: '#FEE2E2', color: '#DC2626', padding: '12px', borderRadius: '12px', marginBottom: '16px', fontSize: '0.875rem', border: '1px solid #FCA5A5' }}>
            {error}
          </motion.div>
        )}
        {resetMessage && (
          <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} style={{ backgroundColor: '#DCFCE7', color: '#166534', padding: '12px', borderRadius: '12px', marginBottom: '16px', fontSize: '0.875rem', border: '1px solid #86EFAC' }}>
            {resetMessage}
          </motion.div>
        )}
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              required
              style={{ width: '100%', padding: '10px 14px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', outline: 'none', transition: 'border-color 0.2s ease' }}
              onFocus={(e) => e.currentTarget.style.borderColor = '#4F46E5'}
              onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)'}
            />
          </div>
          
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, color: '#374151', marginBottom: '6px' }}>Password</label>
            <div style={{ position: 'relative' }}>
              <input 
                type={showPassword ? 'text' : 'password'} 
                value={password} 
                onChange={(e) => setPassword(e.target.value)} 
                required
                minLength={6}
                style={{ width: '100%', padding: '10px 14px', paddingRight: '40px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: '12px', backgroundColor: 'rgba(255,255,255,0.7)', fontSize: '0.9rem', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', outline: 'none', transition: 'border-color 0.2s ease' }}
                onFocus={(e) => e.currentTarget.style.borderColor = '#4F46E5'}
                onBlur={(e) => e.currentTarget.style.borderColor = 'rgba(0,0,0,0.1)'}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{
                  position: 'absolute',
                  right: '12px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  color: '#9CA3AF',
                  display: 'flex',
                  alignItems: 'center',
                  padding: 0
                }}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {!isRegistering && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                <button
                  type="button"
                  onClick={handleForgotPassword}
                  style={{ background: 'none', border: 'none', color: '#4F46E5', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                >
                  Forgot Password?
                </button>
              </div>
            )}
          </div>
          
          <motion.button 
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            type="submit" 
            disabled={loading}
            className="premium-btn-primary"
            style={{ 
              marginTop: '8px', 
              padding: '12px', 
              width: '100%',
              borderRadius: '12px', 
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.7 : 1,
              display: 'flex',
              justifyContent: 'center',
              border: 'none',
              outline: 'none'
            }}
          >
            {loading ? 'Processing...' : (isRegistering ? 'Sign Up' : 'Log In')}
          </motion.button>
        </form>

        <div style={{ margin: '24px 0', display: 'flex', alignItems: 'center', textAlign: 'center', color: '#9CA3AF' }}>
          <div style={{ flex: 1, borderTop: '1px solid rgba(0,0,0,0.08)' }}></div>
          <span style={{ margin: '0 12px', fontSize: '0.8rem', fontWeight: 500 }}>OR</span>
          <div style={{ flex: 1, borderTop: '1px solid rgba(0,0,0,0.08)' }}></div>
        </div>

        <motion.button 
          whileHover={{ scale: 1.02, backgroundColor: '#F9FAFB' }}
          whileTap={{ scale: 0.98 }}
          onClick={handleGoogleLogin}
          disabled={loading}
          style={{ 
            width: '100%',
            padding: '12px', 
            backgroundColor: 'rgba(255,255,255,0.8)', 
            color: '#374151', 
            border: '1px solid rgba(0,0,0,0.1)', 
            borderRadius: '12px', 
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
            boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
          }}
        >
          <svg width="18" height="18" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </motion.button>

        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.9rem', color: '#6B7280' }}>
          {isRegistering ? "Already have an account? " : "Don't have an account? "}
          <button 
            onClick={() => setIsRegistering(!isRegistering)}
            style={{ background: 'none', border: 'none', color: '#4F46E5', fontWeight: 600, cursor: 'pointer', padding: 0 }}
          >
            {isRegistering ? 'Log in' : 'Sign up'}
          </button>
        </div>
        
        <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '0.75rem', color: '#9CA3AF', fontWeight: 500 }}>
          Only @verveadvisory.com email accounts are permitted.
        </div>
        </div>
      </div>
      </motion.div>
    </div>
  );
};

