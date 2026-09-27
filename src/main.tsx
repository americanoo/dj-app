import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AudioProvider } from './ui/audio';
import { MusicFolderProvider } from './ui/musicFolder';
import { StoreProvider } from './ui/store';
import { VersionsProvider } from './ui/versions';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <VersionsProvider>
        <AudioProvider>
          <MusicFolderProvider>
            <App />
          </MusicFolderProvider>
        </AudioProvider>
      </VersionsProvider>
    </StoreProvider>
  </StrictMode>,
);
