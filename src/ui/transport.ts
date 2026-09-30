/**
 * A small bus between the deck and the journey-of-the-night timeline, outside
 * React so the playhead can move every frame without re-rendering anything.
 *
 * The deck publishes where it is, and whichever player starts (the deck or the
 * night player) claims the speakers so the other one stops.
 */

export interface DeckPosition {
  trackId: string;
  /** Seconds into the track. */
  pos: number;
  playing: boolean;
}

type Listener<T> = (value: T) => void;

/** What's playing: the deck (one track, for cues and FX) or the night player (the whole set). */
export type AudioOwner = 'deck' | 'night';

class Transport {
  position: DeckPosition | null = null;
  private positionListeners = new Set<Listener<DeckPosition | null>>();
  private claimListeners = new Set<Listener<AudioOwner>>();

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

  /** `owner` starts playing: whoever else is playing stops, so only one thing plays at a time. */
  claim(owner: AudioOwner) {
    for (const fn of this.claimListeners) fn(owner);
  }

  onClaim(fn: Listener<AudioOwner>): () => void {
    this.claimListeners.add(fn);
    return () => {
      this.claimListeners.delete(fn);
    };
  }
}

export const transport = new Transport();
