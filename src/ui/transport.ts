/**
 * A small bus between the deck and the journey-of-the-night timeline, outside
 * React so the playhead can move every frame without re-rendering anything.
 *
 * The deck publishes where it is; the timeline asks it to jump (scrubbing the
 * night), which may mean loading another track.
 */

export interface DeckPosition {
  trackId: string;
  /** Seconds into the track. */
  pos: number;
  playing: boolean;
}

export type TransportRequest =
  /** The night is being dragged: play from wherever the pointer is. */
  | { type: 'scrubStart' }
  /** Let go: keep playing (`resume`) or stop where it landed. */
  | { type: 'scrubEnd'; resume: boolean }
  /** Go to `pos` in `trackId`, loading it if it isn't the deck's track; `play` starts it playing. */
  | { type: 'seek'; trackId: string; pos: number; play?: boolean };

type Listener<T> = (value: T) => void;

class Transport {
  position: DeckPosition | null = null;
  private positionListeners = new Set<Listener<DeckPosition | null>>();
  private requestListeners = new Set<Listener<TransportRequest>>();

  publish(p: DeckPosition | null) {
    this.position = p;
    for (const fn of this.positionListeners) fn(p);
  }

  onPosition(fn: Listener<DeckPosition | null>): () => void {
    this.positionListeners.add(fn);
    return () => {
      this.positionListeners.delete(fn);
    };
  }

  request(r: TransportRequest) {
    for (const fn of this.requestListeners) fn(r);
  }

  onRequest(fn: Listener<TransportRequest>): () => void {
    this.requestListeners.add(fn);
    return () => {
      this.requestListeners.delete(fn);
    };
  }
}

export const transport = new Transport();
