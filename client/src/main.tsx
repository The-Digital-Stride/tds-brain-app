import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
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
