import { useEffect, useState } from 'react';

/** Phone-sized screens get the one-panel-at-a-time layout. */
export const PHONE_QUERY = '(max-width: 760px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** The panels, one per tab on a phone. */
export type PhoneTab = 'night' | 'mix' | 'deck' | 'library';
