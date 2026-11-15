import '@fontsource-variable/inter/wght.css';
import '@fontsource-variable/space-grotesk/wght.css';
import '@fontsource-variable/jetbrains-mono/wght.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}
declare global {
  interface Window {
    __qwInstall?: InstallPrompt | null;
  }
}

// Keep the browser's install offer so Settings can show an "Install" button.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__qwInstall = e as InstallPrompt;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
