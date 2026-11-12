import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { captureInstallPrompt } from './installPrompt.ts';
// Fonts are bundled with the app, never fetched (the CSP is default-src 'self').
import '@fontsource/poppins/latin-500.css';
import '@fontsource/poppins/latin-600.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/drawers.css';
import './styles/home.css';
import './styles/palette.css';
import './styles/chat.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Chrome fires this once, early; keep it so Settings can offer "Add TDS Brain to your Dock".
captureInstallPrompt();

// The worker only shows a friendly page when the server isn't running. The app works without it.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    try {
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => {});
    } catch {
      // Never let this break the app.
    }
  });
}
