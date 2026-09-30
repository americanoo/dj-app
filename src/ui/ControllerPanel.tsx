import { MIDI_ACTIONS } from '../core/midi';
import { describeBinding, JOG_SPEEDS, useMidi, type JogSpeed } from './midi';

/** Connect a DJ controller and map its buttons, knobs and jog wheel by "learn". */
export function ControllerPanel({ onClose }: { onClose: () => void }) {
  const { supported, status, devices, map, learning, last, connect, setLearning, clear, resetAll, jogSpeed, setJogSpeed } = useMidi();
  const mapped = Object.keys(map).length;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="DJ controller" onClick={onClose}>
      <div className="modal controller" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <h2>DJ controller</h2>
          <p>
            Plug in your controller over USB and connect it. Then map its controls: click <b>Learn</b> next to an action
            and press the button, move the fader or turn the jog wheel you want for it.
          </p>
        </header>
        <div className="modal-body">
          {!supported ? (
            <p className="error-line">
              This browser can't talk to MIDI controllers. Use Chrome or Edge (Safari doesn't support MIDI).
            </p>
          ) : (
            <div className="controller-status">
              <span className={`status-dot ${status === 'on' && devices.length ? 'ok' : status === 'denied' ? 'bad' : ''}`} />
              {status === 'off' && <span>Not connected.</span>}
              {status === 'connecting' && <span>Connecting… allow MIDI access if your browser asks.</span>}
              {status === 'denied' && <span>MIDI access was blocked. Allow it in the site settings (the icon left of the address), then connect again.</span>}
              {status === 'on' && (
                <span>
                  {devices.length ? (
                    <>
                      Connected: <b>{devices.join(', ')}</b>
                    </>
                  ) : (
                    'Connected, but no controller found. Plug it in (it appears here automatically).'
                  )}
                </span>
              )}
              <span className="grow" />
              {status !== 'on' && (
                <button className="primary small" onClick={() => void connect()} disabled={status === 'connecting'}>
                  Connect controller
                </button>
              )}
              {status === 'on' && last && <span className="muted small-text midi-last">Last: {last}</span>}
            </div>
          )}

          <label className="inline jog-speed">
            Jog sensitivity
            <select value={jogSpeed} onChange={(e) => setJogSpeed(e.target.value as JogSpeed)}>
              {JOG_SPEEDS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>

          <table className="midi-map">
            <tbody>
              {MIDI_ACTIONS.map((a) => {
                const b = map[a.id];
                const isLearning = learning === a.id;
                return (
                  <tr key={a.id} className={isLearning ? 'learning' : ''}>
                    <td>{a.label}</td>
                    <td className="muted small-text">
                      {isLearning
                        ? a.kind === 'jog'
                          ? 'Turn the jog wheel…'
                          : a.kind === 'knob'
                            ? 'Move the fader or knob…'
                            : 'Press the button…'
                        : b
                          ? `${describeBinding(b)}${b.encoding ? ` · ${b.encoding === 'offset' ? 'centre 64' : "two's complement"}` : ''}`
                          : '—'}
                    </td>
                    <td className="actions">
                      <button
                        className={`small ${isLearning ? 'primary' : ''}`}
                        disabled={status !== 'on'}
                        onClick={() => setLearning(isLearning ? null : a.id)}
                      >
                        {isLearning ? 'Cancel' : 'Learn'}
                      </button>
                      {b && !isLearning && (
                        <button className="small" onClick={() => clear(a.id)} title="Remove this mapping">
                          ×
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="modal-foot">
          <span className="muted grow small-text">
            {mapped} of {MIDI_ACTIONS.length} mapped · saved in this browser · controls work while the deck has a track
          </span>
          {mapped > 0 && (
            <button className="small" onClick={() => confirm('Remove every mapping?') && resetAll()}>
              Clear all
            </button>
          )}
          <button onClick={onClose}>Close</button>
        </footer>
      </div>
    </div>
  );
}
