/** Show a message in the app's toasts from anywhere, without passing a callback down. */
export function notify(text: string, kind: 'info' | 'error' = 'info') {
  window.dispatchEvent(new CustomEvent('setcraft-toast', { detail: { text, kind } }));
}

export function onNotify(handler: (text: string, kind: 'info' | 'error') => void): () => void {
  const listener = (e: Event) => {
    const { text, kind } = (e as CustomEvent<{ text: string; kind: 'info' | 'error' }>).detail;
    handler(text, kind);
  };
  window.addEventListener('setcraft-toast', listener);
  return () => window.removeEventListener('setcraft-toast', listener);
}
