import type { Chapter, RawActivity } from '../shared/types';

const ORIGIN = 'https://activities.outdoors.org';
const AURA_PATH = '/s/sfsites/aura?r=1&aura.ApexAction.execute=1';
const UA = 'amc-website-wrapper/0.1 (personal activity notifier)';
/** Search call measured at ~13s for 2.3 MB. Timeout sits well clear of that. */
const TIMEOUT_MS = 60_000;
/** Live feed sits at 601. A partial response must never overwrite a good snapshot. */
const MIN_EXPECTED_ROWS = 400;

export interface AuraBootstrap {
  fwuid: string;
  appHash: string;
}

interface AuraEnvelope<T> {
  actions?: Array<{
    state?: string;
    returnValue?: { returnValue?: T } | null;
    error?: unknown[];
  }>;
}

async function fetchWithTimeout(
  url: string,
  init: { method: string; body?: URLSearchParams; headers?: Record<string, string> },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, {
      method: init.method,
      ...(init.body === undefined ? {} : { body: init.body }),
      headers: { 'User-Agent': UA, ...init.headers },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * fwuid rotates on Salesforce's thrice-yearly upgrades, so it is never hardcoded.
 * Both values sit URL-encoded in the markup of /s/.
 */
export async function bootstrap(): Promise<AuraBootstrap> {
  const res = await fetchWithTimeout(`${ORIGIN}/s/`, { method: 'GET' });
  if (!res.ok) throw new Error(`bootstrap: GET /s/ returned HTTP ${res.status}`);
  const html = await res.text();

  const fwuid = /fwuid%22%3A%22([^%"]+)/.exec(html)?.[1];
  const appHash =
    /APPLICATION%40markup%3A%2F%2Fsiteforce%3AcommunityApp%22%3A%22([^%"]+)/.exec(html)?.[1];

  if (!fwuid || !appHash) {
    throw new Error(
      'bootstrap: could not extract fwuid/app hash from /s/. Salesforce markup likely changed.',
    );
  }
  return { fwuid, appHash };
}

async function callApex<T>(
  boot: AuraBootstrap,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const message = JSON.stringify({
    actions: [
      {
        id: '1;a',
        descriptor: 'aura://ApexActionController/ACTION$execute',
        callingDescriptor: 'UNKNOWN',
        params: {
          namespace: '',
          classname: 'OC_ActivitySearchController',
          method,
          params,
          cacheable: false,
          isContinuation: false,
        },
      },
    ],
  });

  const context = JSON.stringify({
    mode: 'PROD',
    fwuid: boot.fwuid,
    app: 'siteforce:communityApp',
    loaded: { 'APPLICATION@markup://siteforce:communityApp': boot.appHash },
    dn: [],
    globals: {},
    uad: false,
  });

  const body = new URLSearchParams({
    message,
    'aura.context': context,
    'aura.pageURI': '/s/',
    'aura.token': 'null', // guest access - the site really does send the string "null"
  });

  const res = await fetchWithTimeout(`${ORIGIN}${AURA_PATH}`, {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  if (!res.ok) throw new Error(`apex ${method}: HTTP ${res.status}`);

  const envelope = (await res.json()) as AuraEnvelope<T>;
  const action = envelope.actions?.[0];
  if (!action) throw new Error(`apex ${method}: response contained no action`);
  if (action.state !== 'SUCCESS') {
    const detail = JSON.stringify(action.error ?? []).slice(0, 300);
    throw new Error(`apex ${method}: state=${action.state} ${detail}`);
  }
  const value = action.returnValue?.returnValue;
  if (value === undefined || value === null) {
    throw new Error(`apex ${method}: empty returnValue`);
  }
  return value;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[aura] ${label} failed (${msg}) - retrying once in 5s`);
    await new Promise((r) => setTimeout(r, 5_000));
    return fn();
  }
}

export interface RawFeed {
  activities: RawActivity[];
  chapters: Chapter[];
}

export async function fetchFeed(): Promise<RawFeed> {
  const boot = await withRetry('bootstrap', bootstrap);

  const activities = await withRetry('searchForActivitiesApplyFilters', () =>
    callApex<RawActivity[]>(boot, 'searchForActivitiesApplyFilters', {
      filtersJsonSpecs: '{}',
    }),
  );
  if (!Array.isArray(activities)) {
    throw new Error('searchForActivitiesApplyFilters: expected an array');
  }
  if (activities.length < MIN_EXPECTED_ROWS) {
    throw new Error(
      `refusing to continue: got ${activities.length} rows, expected >= ${MIN_EXPECTED_ROWS}. ` +
        'A truncated response must never overwrite a good snapshot.',
    );
  }

  const rawChapters = await withRetry('getChapters', () =>
    callApex<Array<{ Id: string; Name: string }>>(boot, 'getChapters', {}),
  );
  if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
    throw new Error('getChapters: expected a non-empty array');
  }

  return {
    activities,
    chapters: rawChapters.map((c) => ({ id: c.Id, name: c.Name })),
  };
}
