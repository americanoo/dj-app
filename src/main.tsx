import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { AudioProvider } from './ui/audio';
import { MusicFolderProvider } from './ui/musicFolder';
import { StoreProvider } from './ui/store';
import { VersionsProvider } from './ui/versions';
import { LicenseProvider } from './ui/license';
import { MidiProvider } from './ui/midi';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './ui/styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <VersionsProvider>
        <AudioProvider>
          <MusicFolderProvider>
            <LicenseProvider>
              <MidiProvider>
                <App />
              </MidiProvider>
            </LicenseProvider>
          </MusicFolderProvider>
        </AudioProvider>
      </VersionsProvider>
    </StoreProvider>
  </StrictMode>,
);
