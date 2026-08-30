import type { ActivityStatus, RegistrationState } from './types';

/**
 * The one criteria representation in this project. The UI address bar, bookmarks,
 * and watches.json all hold the string this module produces. Browse and alert
 * cannot drift because there is only one codec.
 */
export interface Criteria {
  /** Matched against Activity.type, and Activity.secondaryType when includeSecondaryType. */
  types: string[];
  includeSecondaryType: boolean;
  chapters: string[];
  statuses: ActivityStatus[];
  /** Registration timing. Independent of `statuses`, which is capacity. */
  registrations: RegistrationState[];
  audiences: string[];
  difficultyMin?: number;
  difficultyMax?: number;
  /** YYYY-MM-DD. Compared lexicographically - ISO dates sort correctly as strings. */
  windowStart?: string;
  windowEnd?: string;
  keyword?: string;
}

export const EMPTY_CRITERIA: Criteria = {
  types: [],
  includeSecondaryType: false,
  chapters: [],
  statuses: [],
  registrations: [],
  audiences: [],
};

/**
 * Repeated keys, not comma-joined lists: type values legitimately contain commas
 * and ampersands, e.g. "Hiking, Local Walks, & Trail Running".
 * Output key order and value order are fixed so equal criteria always serialize
 * to an identical string.
 */
export function serializeCriteria(c: Criteria): string {
  const p = new URLSearchParams();
  for (const v of [...c.types].sort()) p.append('type', v);
  for (const v of [...c.chapters].sort()) p.append('chapter', v);
  for (const v of [...c.statuses].sort()) p.append('status', v);
  for (const v of [...c.registrations].sort()) p.append('reg', v);
  for (const v of [...c.audiences].sort()) p.append('audience', v);
  if (c.includeSecondaryType) p.set('sec', '1');
  if (c.difficultyMin !== undefined) p.set('dmin', String(c.difficultyMin));
  if (c.difficultyMax !== undefined) p.set('dmax', String(c.difficultyMax));
  if (c.windowStart !== undefined) p.set('from', c.windowStart);
  if (c.windowEnd !== undefined) p.set('to', c.windowEnd);
  if (c.keyword !== undefined && c.keyword !== '') p.set('q', c.keyword);
  return p.toString();
}

export function parseCriteria(qs: string): Criteria {
  const p = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);

  const int = (key: string): number | undefined => {
    const raw = p.get(key);
    if (raw === null) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) ? n : undefined;
  };
  const text = (key: string): string | undefined => {
    const raw = p.get(key);
    return raw === null || raw === '' ? undefined : raw;
  };

  const dmin = int('dmin');
  const dmax = int('dmax');
  const from = text('from');
  const to = text('to');
  const q = text('q');

  return {
    types: p.getAll('type').sort(),
    chapters: p.getAll('chapter').sort(),
    statuses: p.getAll('status').sort() as ActivityStatus[],
    registrations: p.getAll('reg').sort() as RegistrationState[],
    audiences: p.getAll('audience').sort(),
    includeSecondaryType: p.get('sec') === '1',
    ...(dmin === undefined ? {} : { difficultyMin: dmin }),
    ...(dmax === undefined ? {} : { difficultyMax: dmax }),
    ...(from === undefined ? {} : { windowStart: from }),
    ...(to === undefined ? {} : { windowEnd: to }),
    ...(q === undefined ? {} : { keyword: q }),
  };
}
