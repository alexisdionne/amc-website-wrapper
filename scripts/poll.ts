import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { fetchFeed } from './aura';
import { normalizeChapters, normalizeFeed, stableStringify } from './normalize';

const DATA_DIR = fileURLToPath(new URL('../data/', import.meta.url));

async function writeJson(name: string, value: unknown): Promise<number> {
  const body = stableStringify(value);
  await writeFile(`${DATA_DIR}${name}`, body, 'utf8');
  return Buffer.byteLength(body);
}

/**
 * Fetch, normalize, write. Diffing and Discord notification are deliberately not
 * here yet - the workflow commits data/ after this exits, so anything that reads
 * the previous snapshot must run before the commit step, not after.
 */
async function main(): Promise<void> {
  const started = Date.now();

  const feed = await fetchFeed();
  const { activities, details } = normalizeFeed(feed.activities);
  const chapters = normalizeChapters(feed.chapters);

  await mkdir(DATA_DIR, { recursive: true });
  const indexBytes = await writeJson('activities.json', activities);
  const detailBytes = await writeJson('details.json', details);
  const chapterBytes = await writeJson('chapters.json', chapters);

  const kb = (n: number): string => `${Math.round(n / 1024)} KB`;
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `wrote activities.json ${activities.length} rows (${kb(indexBytes)}), ` +
      `details.json (${kb(detailBytes)}), ` +
      `chapters.json ${chapters.length} rows (${kb(chapterBytes)}) in ${secs}s`,
  );
}

await main();
