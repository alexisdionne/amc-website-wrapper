import { parseCriteria, serializeCriteria } from './criteria';

/**
 * A saved alert filter. There is deliberately no `id` field - the id is derived
 * from `query`, so storing it would create a value that can disagree with itself.
 */
export interface Watch {
  name: string;
  /** URL query string, the same format the UI address bar holds. */
  query: string;
  /**
   * Name of the environment variable holding this watch's Discord webhook.
   * Absent means the default channel, DISCORD_WEBHOOK_URL.
   *
   * The variable NAME, never the URL - this file is committed, and a webhook
   * URL is a credential that lets anyone post to the channel. It is also
   * outside `watchId`, so moving a watch to another channel keeps its ledger
   * instead of re-seeding it silently.
   */
  webhookEnv?: string;
}

/**
 * FNV-1a, 32-bit. Not cryptographic - it only has to be stable, short, and
 * computable in both Node and the browser, which rules out node:crypto and the
 * async SubtleCrypto API since this module is shared by the UI and the notifier.
 *
 * The query is canonicalized through the codec first, so two queries that mean
 * the same thing in a different order produce the same id.
 */
export function watchId(watch: Watch): string {
  const canonical = serializeCriteria(parseCriteria(watch.query));
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** Shell-style environment variable name. Rejects a pasted webhook URL. */
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;

/**
 * Validates watches.json. A malformed entry fails the whole poll rather than
 * being skipped - a watch silently dropped is a watch that never alerts, which
 * is exactly the failure the user would not notice.
 */
export function parseWatches(raw: unknown): Watch[] {
  if (!Array.isArray(raw)) {
    throw new Error('watches.json: expected a top-level array');
  }
  return raw.map((entry, i) => {
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`watches.json[${i}]: expected an object`);
    }
    const { name, query, webhookEnv } = entry as Record<string, unknown>;
    if (typeof name !== 'string' || name === '') {
      throw new Error(`watches.json[${i}]: "name" must be a non-empty string`);
    }
    if (typeof query !== 'string' || query === '') {
      throw new Error(`watches.json[${i}]: "query" must be a non-empty string`);
    }
    if (webhookEnv !== undefined) {
      if (typeof webhookEnv !== 'string' || !ENV_NAME.test(webhookEnv)) {
        throw new Error(
          `watches.json[${i}]: "webhookEnv" must be an environment variable name ` +
            'like DISCORD_WEBHOOK_HIKING, not a webhook URL',
        );
      }
      return { name, query, webhookEnv };
    }
    return { name, query };
  });
}
