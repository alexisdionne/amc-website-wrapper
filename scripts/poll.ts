import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { parseWatches, watchId } from '../shared/watch';
import { fetchFeed } from './aura';
import { computeAlerts, loadState } from './diff';
import { normalizeChapters, normalizeFeed, stableStringify } from './normalize';
import { buildRoutedMessages, postAlerts, type DiscordMessage } from './notify';

const ROOT = new URL('../', import.meta.url);
/** Served to GitHub Pages via Vite's publicDir - public by definition. */
const DATA_DIR = fileURLToPath(new URL('data/', ROOT));
/** Internal bookkeeping, deliberately outside publicDir. */
const STATE_DIR = fileURLToPath(new URL('state/', ROOT));
const WATCHES_FILE = fileURLToPath(new URL('watches.json', ROOT));
/** Where a watch with no explicit webhookEnv delivers. */
const DEFAULT_WEBHOOK_ENV = 'DISCORD_WEBHOOK_URL';

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

async function writeJson(path: string, value: unknown): Promise<number> {
  const body = stableStringify(value);
  await writeFile(path, body, 'utf8');
  return Buffer.byteLength(body);
}

const kb = (n: number): string => `${Math.round(n / 1024)} KB`;

async function main(): Promise<void> {
  const started = Date.now();

  const feed = await fetchFeed();
  const { activities, details } = normalizeFeed(feed.activities);
  const chapters = normalizeChapters(feed.chapters);

  await mkdir(DATA_DIR, { recursive: true });
  const indexBytes = await writeJson(`${DATA_DIR}activities.json`, activities);
  const detailBytes = await writeJson(`${DATA_DIR}details.json`, details);
  await writeJson(`${DATA_DIR}chapters.json`, chapters);
  console.log(
    `feed: ${activities.length} activities (${kb(indexBytes)}), ` +
      `${chapters.length} chapters, details ${kb(detailBytes)}, ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );

  const watches = parseWatches((await readJson(WATCHES_FILE)) ?? []);
  if (watches.length === 0) {
    console.log('no watches configured - skipping alert stage');
    return;
  }

  await mkdir(STATE_DIR, { recursive: true });
  const statePath = `${STATE_DIR}alert-state.json`;
  const state = loadState(await readJson(statePath));

  const { alerts, nextState } = computeAlerts({
    state,
    activities,
    watches,
    now: new Date(),
  });

  const byId = new Map(chapters.map((c) => [c.id, c.name]));
  const chapterName = (id: string): string => byId.get(id) ?? id;

  if (alerts.length === 0) {
    // Nothing to deliver, so persisting cannot lose anything. This is also the
    // path that records a silent seed for a newly armed watch.
    await writeJson(statePath, nextState);
    console.log(`no alerts across ${watches.length} watch(es)`);
    return;
  }

  const envByWatch = new Map(watches.map((w) => [watchId(w), w.webhookEnv ?? DEFAULT_WEBHOOK_ENV]));
  const routed = buildRoutedMessages(
    alerts,
    chapterName,
    (id) => envByWatch.get(id) ?? DEFAULT_WEBHOOK_ENV,
  );

  const deliveries: Array<{ env: string; url: string; messages: DiscordMessage[] }> = [];
  const missing: string[] = [];
  for (const [env, messages] of routed) {
    const url = process.env[env];
    if (url === undefined || url === '') missing.push(env);
    else deliveries.push({ env, url, messages });
  }

  if (missing.length > 0) {
    // Withholds every channel, not only the unconfigured one. Posting the rest
    // without persisting would repost them on each run, and persisting after a
    // partial post would mark the withheld alerts delivered.
    //
    // Deliberately does NOT persist: writing the ledger here would mark these
    // alerts as delivered when nothing was sent, and they would never fire again.
    console.warn(
      `[poll] ${alerts.length} alert(s) withheld - not set: ${missing.join(', ')}. ` +
        'State not written, so these will be delivered once it is configured.',
    );
    for (const a of alerts) console.warn(`  ${a.kind}: ${a.activity.name} (${a.watchName})`);
    return;
  }

  // Notify first, then persist. If any post fails, state stays untouched and the
  // next run retries every channel - at-least-once delivery, so a channel that
  // already succeeded can repeat an alert, but none is ever silently lost.
  let sent = 0;
  for (const { env, url, messages } of deliveries) {
    await postAlerts(url, messages);
    sent += messages.length;
    console.log(`  ${env}: ${messages.length} message(s)`);
  }
  await writeJson(statePath, nextState);
  console.log(
    `posted ${alerts.length} alert(s) in ${sent} message(s) across ${deliveries.length} channel(s)`,
  );
}

await main();
