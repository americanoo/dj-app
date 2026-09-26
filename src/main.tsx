import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AudioProvider } from './ui/audio';
import { StoreProvider } from './ui/store';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <AudioProvider>
        <App />
      </AudioProvider>
    </StoreProvider>
  </StrictMode>,
);
