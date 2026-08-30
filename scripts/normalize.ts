import type {
  Activity,
  ActivityDetails,
  Chapter,
  RawActivity,
  RegistrationState,
} from '../shared/types';

/** Locale-independent. localeCompare would make output machine-dependent and break byte-stability. */
const byCodePoint = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const KNOWN_STATUS = new Set(['Published', 'Full', 'Waitlist']);

/** Preview length. Full text stays on the AMC page, reachable via Activity.url. */
const PREVIEW_CHARS = 300;

/**
 * Descriptions arrive as raw HTML averaging 1.6 KB, 1.35 MB across the feed.
 * Slicing markup mid-tag produces broken output, so tags are stripped and the
 * common entities decoded before truncating on a word boundary.
 *
 * SECURITY: this is tag stripping, not sanitization. A regex cannot safely
 * neutralize hostile HTML, and this input comes from a third party. The output
 * is safe only because it is rendered as text, where React escapes it. Never
 * pass it to dangerouslySetInnerHTML or an equivalent - sanitize properly first.
 */
export function toPreview(html: string): string {
  const text = html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  if (text.length <= PREVIEW_CHARS) return text;
  const cut = text.slice(0, PREVIEW_CHARS);
  const lastSpace = cut.lastIndexOf(' ');
  const body = lastSpace > PREVIEW_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${body.trimEnd()}...`;
}

/**
 * Unknown Status__c values are warned about, never thrown on. A new value such as
 * "Cancelled" simply compares unequal to "Published", so the activity reads as
 * unavailable - and fires a Reopened alert if it later becomes Published.
 * Throwing here would let one unexpected row kill the whole poll.
 */
function warnUnknownStatuses(rows: RawActivity[]): void {
  const unknown = new Set(rows.map((r) => r.Status__c).filter((s) => !KNOWN_STATUS.has(s)));
  if (unknown.size > 0) {
    console.warn(`[normalize] unrecognized Status__c values: ${[...unknown].join(', ')}`);
  }
}

/**
 * Only three combinations of the three source booleans occur, verified against
 * all 601 rows of a live response:
 *
 *   Open_for_registration=true,  OpenDatePassed=true,  ByDatePassed=false -> open     (538)
 *   Open_for_registration=false, OpenDatePassed=false, ByDatePassed=false -> not-yet   (54)
 *   Open_for_registration=false, OpenDatePassed=true,  ByDatePassed=true  -> closed     (9)
 *
 * Open_for_registration__c alone is not an availability signal - it is true on
 * 43 activities whose Status__c is Full. Capacity lives in Status__c.
 */
function registrationState(raw: RawActivity): RegistrationState {
  if (raw.Open_for_registration__c) return 'open';
  return raw.Register_By_Date_Passed__c ? 'closed' : 'not-yet';
}

export function normalizeActivity(raw: RawActivity): Activity {
  const difficulty = Number(/^(\d)/.exec(raw.Main_Activity_Difficulty_Rating__c)?.[1] ?? 0);

  const loc = raw.Start_Location__c;
  const location =
    loc && (loc.city ?? loc.state ?? loc.country)
      ? {
          ...(loc.city ? { city: loc.city } : {}),
          ...(loc.state ? { state: loc.state } : {}),
          ...(loc.country ? { country: loc.country } : {}),
        }
      : undefined;

  // Source sends 0/0 rather than omitting coords for the 52 rows that lack them.
  const hasCoords = raw.Start_Latitude__c !== 0 && raw.Start_Longitude__c !== 0;

  return {
    id: raw.Id,
    name: raw.Activity_Name__c,
    chapterId: raw.Account__c,
    startDate: raw.Start_Date__c,
    endDate: raw.End_Date__c,
    startTime: raw.Start_Time__c,
    timeZone: raw.Time_Zone__c,
    type: raw.Main_Activity_Type__c,
    subType: raw.Main_Activity_Sub_Type__c,
    ...(raw.Secondary_Activity_Type__c ? { secondaryType: raw.Secondary_Activity_Type__c } : {}),
    difficulty,
    difficultyLabel: raw.Main_Activity_Difficulty_Rating__c,
    program: raw.Program_Type__c,
    ...(raw.Audience_Type__c ? { audience: raw.Audience_Type__c } : {}),
    registrationType: raw.Registration_Type__c,
    status: raw.Status__c,
    registration: registrationState(raw),
    ...(raw.Registration_Open_Date__c
      ? { registrationOpenDate: raw.Registration_Open_Date__c }
      : {}),
    ...(raw.Register_By_Date__c ? { registerByDate: raw.Register_By_Date__c } : {}),
    costs: (raw.Activity_Costs__r ?? []).map((c) => c.Amount__c),
    leaders: (raw.OC_Trip_Leaders__r ?? []).map((l) => l.Contact__r.Name),
    ...(location ? { location } : {}),
    ...(hasCoords ? { coords: { lat: raw.Start_Latitude__c, lon: raw.Start_Longitude__c } } : {}),
    ...(raw.Keywords__c ? { keywords: raw.Keywords__c } : {}),
    url: `/s/oc-activity/${raw.Id}`,
  };
}

export function normalizeFeed(rows: RawActivity[]): {
  activities: Activity[];
  details: ActivityDetails;
} {
  warnUnknownStatuses(rows);
  const sorted = [...rows].sort((a, b) => byCodePoint(a.Id, b.Id));
  const details: ActivityDetails = {};
  for (const r of sorted) details[r.Id] = toPreview(r.Description__c);
  return { activities: sorted.map(normalizeActivity), details };
}

export function normalizeChapters(chapters: Chapter[]): Chapter[] {
  return [...chapters].sort((a, b) => byCodePoint(a.id, b.id));
}

/**
 * Byte-stable JSON. Salesforce does not guarantee key order, and without this every
 * one of the 48 daily polls commits a near-full 0.73 MB blob instead of a small delta.
 */
export function stableStringify(value: unknown): string {
  return `${JSON.stringify(sortKeysDeep(value), null, 2)}\n`;
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(src)
        .sort(byCodePoint)
        .map((k) => [k, sortKeysDeep(src[k])]),
    );
  }
  return value;
}
