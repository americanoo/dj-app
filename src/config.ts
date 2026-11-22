/**
 * Founding DJ pass. See SELLING.md for how to set this up.
 *
 * Until `checkoutUrl` and `publicKey` are both filled in, sales are off and
 * every feature stays free, so nothing changes for you while you get ready.
 */
export const FOUNDING = {
  /** Shown on the pass; change to your price. */
  price: '$49',
  priceNote: 'one-time · lifetime updates',
  /** How many founding passes you'll sell (shown as "limited to the first N DJs"). */
  seats: 100,
  /** Your Stripe Payment Link / Lemon Squeezy checkout URL. */
  checkoutUrl: '',
  /** Written by `npm run license -- setup`. Public: safe to commit. */
  publicKey: '',
  /** Where buyers can reach you (shown on the pass). */
  contact: '',
  /** Without a pass, an export can hold this many tracks, so DJs can try it with their own software first. */
  freeExportTracks: 3,
};

export const SALES_ENABLED = Boolean(FOUNDING.checkoutUrl && FOUNDING.publicKey);
