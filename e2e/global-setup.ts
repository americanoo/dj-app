import { resolve } from 'node:path';
// @ts-expect-error plain JS module, no types
import { makeMusic } from './fixtures/make-audio.mjs';

/** The synthetic music folder the tests link, written once (it's git-ignored). */
export default function globalSetup() {
  makeMusic(resolve('e2e/.audio/Music'));
}
