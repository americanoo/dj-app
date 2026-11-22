/** A button on a toast, e.g. Undo. */
export interface ToastAction {
  label: string;
  run: () => void;
}

/** Show a message in the app's toasts from anywhere, without passing a callback down. */
export function notify(text: string, kind: 'info' | 'error' = 'info', action?: ToastAction) {
  window.dispatchEvent(new CustomEvent('setcraft-toast', { detail: { text, kind, action } }));
}

export function onNotify(handler: (text: string, kind: 'info' | 'error', action?: ToastAction) => void): () => void {
  const listener = (e: Event) => {
    const { text, kind, action } = (e as CustomEvent<{ text: string; kind: 'info' | 'error'; action?: ToastAction }>).detail;
    handler(text, kind, action);
  };
  window.addEventListener('setcraft-toast', listener);
  return () => window.removeEventListener('setcraft-toast', listener);
}
