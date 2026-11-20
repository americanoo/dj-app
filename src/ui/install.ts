import { useEffect, useState } from 'react';

/**
 * Installing Setcraft as an app. Chrome (Android, desktop) offers a prompt we
 * can show from a button; iPhone and iPad Safari don't, so there we explain
 * Share → Add to Home Screen.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((fn) => fn());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((fn) => fn());
  });
}

/** Offline support: only for the built app on https (or localhost), never the dev server. */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => undefined);
  });
}

export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export function useInstall() {
  const [, bump] = useState(0);
  useEffect(() => {
    const fn = () => bump((n) => n + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  const installed = isStandalone();
  return {
    /** Chrome's own install prompt is available. */
    canPrompt: !installed && !!deferred,
    /** iPhone / iPad: installing is Share → Add to Home Screen. */
    iosHint: !installed && !deferred && isIos(),
    install: async () => {
      const d = deferred;
      if (!d) return;
      await d.prompt();
      await d.userChoice.catch(() => undefined);
      deferred = null;
      bump((n) => n + 1);
    },
  };
}
