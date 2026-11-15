import { type User, onAuthStateChanged } from 'firebase/auth';
import { Suspense, lazy, useEffect, useState } from 'react';
import { auth } from './lib/firebase';
import Login from './pages/Login';
import { Splash, Toasts } from './ui';

// The signed-in app (database, every screen) is a separate download, so the login screen stays light.
const loadShell = () => import('./Shell');
const Shell = lazy(loadShell);

const AUTHED = 'qw_authed';
// A returning user: start fetching the main app while Firebase restores the session, not after.
if (localStorage.getItem(AUTHED)) void loadShell();

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        if (u) localStorage.setItem(AUTHED, '1');
        else localStorage.removeItem(AUTHED);
        setUser(u);
      }),
    [],
  );

  return (
    <>
      {user === undefined ? (
        <Splash />
      ) : user ? (
        <Suspense fallback={<Splash />}>
          <Shell user={user} />
        </Suspense>
      ) : (
        <Login />
      )}
      <Toasts />
    </>
  );
}
