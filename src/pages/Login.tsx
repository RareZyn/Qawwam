import { GoogleAuthProvider, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, updateProfile } from 'firebase/auth';
import { type FormEvent, useState } from 'react';
import { auth } from '../lib/firebase';
import { Field, LogoLockup, LogoMark, Seg } from '../ui';

const MESSAGES: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is not right.',
  'auth/invalid-email': 'That email address does not look right.',
  'auth/user-not-found': 'No account with that email. Register first.',
  'auth/wrong-password': 'Email or password is not right.',
  'auth/email-already-in-use': 'That email already has an account. Log in instead.',
  'auth/weak-password': 'Use a password with at least 6 characters.',
  'auth/popup-closed-by-user': 'Google sign-in was closed before it finished.',
  'auth/network-request-failed': 'No connection. Check your internet and try again.',
  'auth/operation-not-allowed': 'This sign-in method is not switched on in Firebase yet.',
  'auth/configuration-not-found': 'Sign-in is not set up in Firebase yet (Authentication is not enabled).',
};

function explain(e: unknown) {
  const code = (e as { code?: string }).code ?? '';
  return MESSAGES[code] ?? (e instanceof Error ? e.message : 'Could not sign in.');
}

export default function Login() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await signInWithEmailAndPassword(auth, email.trim(), password);
      else {
        const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
        if (name.trim()) await updateProfile(cred.user, { displayName: name.trim() });
      }
    } catch (err) {
      setError(explain(err));
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    setError('');
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (err) {
      setError(explain(err));
    }
  }

  return (
    <div className="login">
      <section className="pitch">
        <LogoLockup height={48} />
        <div className="col loose" style={{ maxWidth: 520 }}>
          <h1>
            Be consistent.
            <br />
            Keep score.
          </h1>
          <p className="muted" style={{ fontSize: 18, lineHeight: 1.6 }}>
            Habits with points, money in three groups, a locked password vault, to-dos, and the page you are on. One place, every day.
          </p>
        </div>
        <span className="eyebrow">Habits · Money · Vault · To-Do · Books</span>
      </section>

      <section className="form">
        <div>
          <div className="col only-mobile">
            <LogoMark />
            <h1 style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-0.02em' }}>Qawwam</h1>
            <p className="muted">Stay consistent. Track habits, money, passwords and books in one place.</p>
          </div>
          <h1 className="only-desktop">{mode === 'login' ? 'Log in' : 'Create your account'}</h1>

          <Seg options={[['login', 'Log in'], ['register', 'Register']]} value={mode} onChange={setMode} label="Log in or register" />

          <form className="col loose" onSubmit={submit}>
            {mode === 'register' && (
              <Field label="Name">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Razin" />
              </Field>
            )}
            <Field label="Email">
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </Field>
            <Field label="Password">
              <input
                className="input"
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </Field>
            {error && (
              <p role="alert" className="alert">
                {error}
              </p>
            )}
            <button type="submit" className="btn primary lg" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Create account'}
            </button>
          </form>

          <div className="row dim tiny">
            <div className="grow" style={{ height: 1, background: 'var(--line2)' }} />
            or
            <div className="grow" style={{ height: 1, background: 'var(--line2)' }} />
          </div>
          <button type="button" className="btn lg" onClick={google}>
            Continue with Google
          </button>
        </div>
      </section>
    </div>
  );
}
