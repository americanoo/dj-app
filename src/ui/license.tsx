import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { FOUNDING, SALES_ENABLED } from '../config';
import { cleanKey, verifyLicense, type LicenseCheck, type LicenseInfo } from '../core/license';

const STORAGE_KEY = 'setcraft-founding-key';

interface LicenseStore {
  /** A valid Founding DJ key is active on this browser. */
  founding: LicenseInfo | null;
  /** Full features: a pass, or sales not set up yet (then everything is free). */
  unlocked: boolean;
  activate: (key: string) => Promise<LicenseCheck>;
  remove: () => void;
}

const Ctx = createContext<LicenseStore | null>(null);

export function LicenseProvider({ children }: { children: ReactNode }) {
  const [founding, setFounding] = useState<LicenseInfo | null>(null);

  // A key activated earlier on this browser.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      // storage blocked: the DJ pastes the key again
    }
    if (!saved) return;
    void verifyLicense(saved, FOUNDING.publicKey).then((r) => r.ok && setFounding(r.info));
  }, []);

  const activate = useCallback(async (key: string) => {
    const result = await verifyLicense(key, FOUNDING.publicKey);
    if (result.ok) {
      setFounding(result.info);
      try {
        localStorage.setItem(STORAGE_KEY, cleanKey(key));
      } catch {
        // still active for this visit
      }
    }
    return result;
  }, []);

  const remove = useCallback(() => {
    setFounding(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // nothing stored
    }
  }, []);

  return (
    <Ctx.Provider value={{ founding, unlocked: !SALES_ENABLED || !!founding, activate, remove }}>{children}</Ctx.Provider>
  );
}

export function useLicense(): LicenseStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useLicense outside provider');
  return s;
}
