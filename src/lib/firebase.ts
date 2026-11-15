import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';

/** True when built with `--mode emu` or run under the test runner: the app talks to the local emulator only. */
export const useEmulator = import.meta.env.VITE_USE_EMULATOR === '1';

const firebaseConfig = {
  apiKey: 'AIzaSyD_0fAKNef2c-k4xquCIVYDDf0UVtcvwHs',
  authDomain: 'qawwam.firebaseapp.com',
  projectId: 'qawwam',
  storageBucket: 'qawwam.firebasestorage.app',
  messagingSenderId: '882492704843',
  appId: '1:882492704843:web:2bde2075f775110c6f25ce',
};

export const app = initializeApp(
  useEmulator ? { ...firebaseConfig, projectId: 'demo-qawwam', apiKey: 'demo-key' } : firebaseConfig,
);

export const auth = getAuth(app);
if (useEmulator) connectAuthEmulator(auth, 'http://127.0.0.1:9199', { disableWarnings: true });
