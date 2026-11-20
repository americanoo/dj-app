import { Unzip, UnzipInflate, UnzipPassThrough } from 'fflate';
import { AUDIO_EXTENSIONS } from './audio';

/**
 * The songs inside a .zip, one at a time: a whole music folder zipped on the
 * computer and sent to the phone (AirDrop, iCloud) is added in one pick. The
 * zip is read as a stream, so only the song being unpacked is in memory.
 * Folders inside the zip are fine; macOS's __MACOSX copies and hidden files
 * are skipped.
 */
export async function* songsInZip(zip: File): AsyncGenerator<File> {
  const done: File[] = [];
  let failure: unknown;
  const unzip = new Unzip((entry) => {
    const name = entry.name.split('/').pop() ?? '';
    if (entry.name.startsWith('__MACOSX/') || name.startsWith('.') || !AUDIO_EXTENSIONS.test(name)) return;
    const parts: Uint8Array[] = [];
    entry.ondata = (err, chunk, final) => {
      if (err) {
        failure = err;
        return;
      }
      parts.push(chunk);
      if (final) done.push(new File(parts as BlobPart[], name));
    };
    entry.start();
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate);

  const reader = zip.stream().getReader();
  for (;;) {
    const { value, done: end } = await reader.read();
    unzip.push(value ?? new Uint8Array(0), end);
    if (failure) throw new Error(`Couldn't unpack ${zip.name}`);
    while (done.length) yield done.shift()!;
    if (end) break;
  }
}
