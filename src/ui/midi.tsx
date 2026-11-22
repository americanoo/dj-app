import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  describeBinding,
  jogDelta,
  learn,
  MIDI_ACTIONS,
  parseMidi,
  actionFor,
  type MidiMap,
  type MidiMessage,
} from '../core/midi';

const MAP_KEY = 'setcraft-midi-map';
const ON_KEY = 'setcraft-midi-on';
const JOG_KEY = 'setcraft-midi-jog';

/** Jog sensitivity: how far one jog tick moves, as a fraction of a beat. */
export const JOG_SPEEDS = [
  { id: 'fine', label: 'Fine', perTick: 1 / 64 },
  { id: 'normal', label: 'Normal', perTick: 1 / 32 },
  { id: 'fast', label: 'Fast', perTick: 1 / 12 },
] as const;
export type JogSpeed = (typeof JOG_SPEEDS)[number]['id'];
/** A jog is learned from a short turn, to tell its encoding apart. */
const JOG_LEARN_MS = 350;

export type MidiStatus = 'off' | 'connecting' | 'on' | 'denied';

/**
 * What a mapped control did: `press` for buttons (true on press), `value`
 * 0–1 for knobs and faders, `ticks` for jog wheels (+ forwards).
 */
export interface MidiEvent {
  action: string;
  press?: boolean;
  value?: number;
  ticks?: number;
}

interface MidiStore {
  supported: boolean;
  status: MidiStatus;
  devices: string[];
  map: MidiMap;
  learning: string | null;
  /** The last message received, for checking a controller is talking. */
  last: string;
  jogSpeed: JogSpeed;
  setJogSpeed: (s: JogSpeed) => void;
  connect: () => Promise<void>;
  setLearning: (actionId: string | null) => void;
  clear: (actionId: string) => void;
  resetAll: () => void;
  subscribe: (fn: (e: MidiEvent) => void) => () => void;
}

const Ctx = createContext<MidiStore | null>(null);

function loadMap(): MidiMap {
  try {
    return JSON.parse(localStorage.getItem(MAP_KEY) ?? '{}') as MidiMap;
  } catch {
    return {};
  }
}

export function MidiProvider({ children }: { children: ReactNode }) {
  const supported = typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  const [status, setStatus] = useState<MidiStatus>('off');
  const [devices, setDevices] = useState<string[]>([]);
  const [map, setMap] = useState<MidiMap>(loadMap);
  const [learning, setLearningState] = useState<string | null>(null);
  const [last, setLast] = useState('');
  const [jogSpeed, setJogSpeedState] = useState<JogSpeed>(() => {
    try {
      const v = localStorage.getItem(JOG_KEY);
      return JOG_SPEEDS.some((s) => s.id === v) ? (v as JogSpeed) : 'normal';
    } catch {
      return 'normal';
    }
  });
  const setJogSpeed = useCallback((s: JogSpeed) => {
    setJogSpeedState(s);
    try {
      localStorage.setItem(JOG_KEY, s);
    } catch {
      // not remembered
    }
  }, []);
  const mapRef = useRef(map);
  mapRef.current = map;
  const learningRef = useRef(learning);
  learningRef.current = learning;
  const listeners = useRef(new Set<(e: MidiEvent) => void>());
  const learnBuffer = useRef<{ messages: MidiMessage[]; timer: number } | null>(null);
  const access = useRef<MIDIAccess | null>(null);

  const saveMap = useCallback((next: MidiMap) => {
    setMap(next);
    try {
      localStorage.setItem(MAP_KEY, JSON.stringify(next));
    } catch {
      // private mode: mapping lasts this visit
    }
  }, []);

  const finishLearn = useCallback(
    (actionId: string, messages: MidiMessage[]) => {
      learnBuffer.current = null;
      const next = learn(mapRef.current, actionId, messages);
      if (next !== mapRef.current) saveMap(next);
      setLearningState(null);
    },
    [saveMap],
  );

  const onMessage = useCallback(
    (e: MIDIMessageEvent) => {
      if (!e.data) return;
      const m = parseMidi(e.data);
      if (!m) return;
      setLast(`${m.type === 'note' ? 'Note' : 'CC'} ${m.number} · ch ${m.channel} · ${m.value}`);

      const learningId = learningRef.current;
      if (learningId) {
        const kind = MIDI_ACTIONS.find((a) => a.id === learningId)?.kind;
        if (kind === 'button') {
          if (m.value > 0) finishLearn(learningId, [m]); // ignore the release
        } else if (m.type === 'cc') {
          if (kind === 'knob') finishLearn(learningId, [m]);
          else {
            // Jog: collect a short turn, then decide its encoding.
            const buf = (learnBuffer.current ??= {
              messages: [],
              timer: window.setTimeout(() => finishLearn(learningId, learnBuffer.current?.messages ?? []), JOG_LEARN_MS),
            });
            buf.messages.push(m);
          }
        }
        return;
      }

      const action = actionFor(mapRef.current, m);
      if (!action) return;
      const kind = MIDI_ACTIONS.find((a) => a.id === action)?.kind;
      const event: MidiEvent =
        kind === 'jog'
          ? { action, ticks: jogDelta(m.value, mapRef.current[action].encoding ?? 'twos') }
          : kind === 'knob'
            ? { action, value: m.value / 127 }
            : { action, press: m.value > (m.type === 'cc' ? 63 : 0) };
      for (const fn of listeners.current) fn(event);
    },
    [finishLearn],
  );

  const attach = useCallback(
    (a: MIDIAccess) => {
      const names: string[] = [];
      a.inputs.forEach((input) => {
        input.onmidimessage = onMessage;
        if (input.state === 'connected') names.push(input.name ?? 'MIDI device');
      });
      setDevices(names);
    },
    [onMessage],
  );

  const connect = useCallback(async () => {
    if (!supported) return;
    setStatus('connecting');
    try {
      const a = await navigator.requestMIDIAccess();
      access.current = a;
      attach(a);
      a.onstatechange = () => attach(a); // plugged in / unplugged
      setStatus('on');
      try {
        localStorage.setItem(ON_KEY, '1');
      } catch {
        // not remembered
      }
    } catch {
      setStatus('denied');
    }
  }, [supported, attach]);

  // Reconnect on later visits once the DJ has connected before.
  useEffect(() => {
    let on = false;
    try {
      on = localStorage.getItem(ON_KEY) === '1';
    } catch {
      // no storage
    }
    if (on) void connect();
    return () => {
      const a = access.current;
      if (!a) return;
      a.onstatechange = null;
      a.inputs.forEach((input) => (input.onmidimessage = null));
    };
  }, [connect]);

  const setLearning = useCallback((id: string | null) => {
    if (learnBuffer.current) window.clearTimeout(learnBuffer.current.timer);
    learnBuffer.current = null;
    setLearningState(id);
  }, []);

  const clear = useCallback(
    (id: string) => {
      const { [id]: _, ...rest } = mapRef.current;
      saveMap(rest);
    },
    [saveMap],
  );

  const subscribe = useCallback((fn: (e: MidiEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return (
    <Ctx.Provider
      value={{
        supported,
        status,
        devices,
        map,
        learning,
        last,
        jogSpeed,
        setJogSpeed,
        connect,
        setLearning,
        clear,
        resetAll: () => saveMap({}),
        subscribe,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useMidi(): MidiStore {
  const s = useContext(Ctx);
  if (!s) throw new Error('useMidi outside provider');
  return s;
}

/** Run `handler` for every mapped control the controller sends. The latest handler is always used. */
export function useMidiActions(handler: (e: MidiEvent) => void) {
  const { subscribe } = useMidi();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe((e) => ref.current(e)), [subscribe]);
}

export { describeBinding };
