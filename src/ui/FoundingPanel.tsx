import { useState } from 'react';
import { FOUNDING, SALES_ENABLED } from '../config';
import { useLicense } from './license';

/** The Founding DJ pass: what it gets you, where to buy it, and where to paste the key. */
export function FoundingPanel({ onClose, toast }: { onClose: () => void; toast: (text: string) => void }) {
  const { founding, activate, remove } = useLicense();
  const [entering, setEntering] = useState(false);
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const r = await activate(key);
    setBusy(false);
    if (r.ok) {
      toast(`Welcome, ${r.info.n}${r.info.no ? `: Founding DJ #${r.info.no}` : ''}. Everything is unlocked.`);
      setKey('');
      setEntering(false);
    } else setError(r.reason);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Founding DJ" onClick={onClose}>
      <div className="modal founding" onClick={(e) => e.stopPropagation()}>
        {founding ? (
          <div className="founding-body">
            <div className="founding-badge">★ Founding DJ{founding.no ? ` #${founding.no}` : ''}</div>
            <h2>Thank you, {founding.n}.</h2>
            <p>
              Everything is unlocked on this browser, including every future update. To use Setcraft on another browser or
              computer, paste the same key there.
            </p>
            {FOUNDING.contact && (
              <p className="muted">
                Ideas, bugs or requests: <a href={`mailto:${FOUNDING.contact}`}>{FOUNDING.contact}</a>. Founding DJs shape
                what gets built next.
              </p>
            )}
          </div>
        ) : (
          <div className="founding-body">
            <div className="founding-badge">Founding DJ pass</div>
            <h2>Back Setcraft early, keep everything for life.</h2>
            <div className="founding-price">
              <b>{FOUNDING.price}</b>
              <span>{FOUNDING.priceNote}</span>
            </div>
            <ul className="founding-perks">
              <li>
                <b>Full export</b>: your whole collection with every hot cue, memory cue, loop and beat grid, back into
                rekordbox, Traktor and djay Pro.
              </li>
              <li>
                <b>Every update, for life</b>: new features as they land, no subscription.
              </li>
              <li>
                <b>A say in what's next</b>: founding DJs get a direct line for requests.
              </li>
              <li>
                <b>Your founding number</b>, shown in the app. Limited to the first {FOUNDING.seats} DJs.
              </li>
            </ul>
            <p className="muted small-text">
              Everything else (import, the journey of the night, waveforms, cues, auto cues, BPM fixes) stays free. Without a
              pass, exports hold up to {FOUNDING.freeExportTracks} tracks, so you can check the cues land right in your
              software first.
            </p>

            {!SALES_ENABLED && (
              <p className="founding-setup">
                Sales aren't switched on in this copy yet, so everything is free. To start selling, add your checkout link and
                run <code>npm run license -- setup</code> (see SELLING.md).
              </p>
            )}

            {entering ? (
              <div className="founding-key">
                <textarea
                  autoFocus
                  rows={3}
                  placeholder="Paste your key (it starts with SC1.)"
                  value={key}
                  onChange={(e) => {
                    setKey(e.target.value);
                    setError(null);
                  }}
                />
                {error && <div className="error-line">{error}</div>}
              </div>
            ) : null}
          </div>
        )}
        <footer className="modal-foot">
          {founding ? (
            <>
              <button
                className="danger small"
                onClick={() => {
                  if (confirm('Remove your key from this browser? You can paste it again any time.')) remove();
                }}
              >
                Remove key from this browser
              </button>
              <span className="grow" />
              <button onClick={onClose}>Close</button>
            </>
          ) : entering ? (
            <>
              <button onClick={() => setEntering(false)}>Back</button>
              <span className="grow" />
              <button className="primary" disabled={!key.trim() || busy} onClick={() => void submit()}>
                {busy ? 'Checking…' : 'Activate'}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setEntering(true)}>I have a key</button>
              <span className="grow" />
              <button onClick={onClose}>Not now</button>
              <button
                className="primary"
                disabled={!SALES_ENABLED}
                onClick={() => window.open(FOUNDING.checkoutUrl, '_blank', 'noopener')}
              >
                Get the pass · {FOUNDING.price}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
