import type { Criteria } from './criteria';
import type { Activity } from './types';

/**
 * Five feed rows are evergreen placeholders rather than dated trips: three
 * "Join <chapter> 20s/30s WhatsApp" group links, one open-ended training, and one
 * row whose end date is typo'd as 2926. Range-overlap logic would otherwise match
 * every one of them against every window the user picks.
 *
 * Duration separates them cleanly - no real activity in the feed exceeds 365 days,
 * while every evergreen exceeds it by years. An absolute cutoff such as
 * `endDate >= '2050'` caught only 2 of the 5.
 */
const MAX_TRIP_DAYS = 365;
const DAY_MS = 86_400_000;

function isEvergreen(a: Activity): boolean {
  const start = Date.parse(a.startDate);
  const end = Date.parse(a.endDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return end - start > MAX_TRIP_DAYS * DAY_MS;
}

/**
 * Pure predicate shared by the React UI and the Discord notifier.
 * An empty array means "no constraint on this field", never "match nothing".
 */
export function matches(a: Activity, c: Criteria): boolean {
  if (c.types.length > 0) {
    const primary = c.types.includes(a.type);
    const secondary =
      c.includeSecondaryType && a.secondaryType !== undefined && c.types.includes(a.secondaryType);
    if (!primary && !secondary) return false;
  }

  if (c.chapters.length > 0 && !c.chapters.includes(a.chapterId)) return false;
  if (c.statuses.length > 0 && !c.statuses.includes(a.status)) return false;

  // Independent of status: an activity can be Full but accepting registrations,
  // or Published with its deadline already past.
  if (c.registrations.length > 0 && !c.registrations.includes(a.registration)) return false;

  // Only 36% of rows carry an audience, so an active audience filter necessarily
  // excludes rows that have none. Absent is treated as "does not match".
  if (c.audiences.length > 0) {
    if (a.audience === undefined || !c.audiences.includes(a.audience)) return false;
  }

  if (c.difficultyMin !== undefined && a.difficulty < c.difficultyMin) return false;
  if (c.difficultyMax !== undefined && a.difficulty > c.difficultyMax) return false;

  // Range overlap, not start-date containment. 184 of 602 activities are multi-day,
  // and filtering on startDate alone hides any trip spanning the window but
  // beginning before it. This is the bug the project exists to fix.
  if (c.windowStart !== undefined || c.windowEnd !== undefined) {
    if (isEvergreen(a)) return false;
    if (c.windowEnd !== undefined && a.startDate > c.windowEnd) return false;
    if (c.windowStart !== undefined && a.endDate < c.windowStart) return false;
  }

  if (c.keyword !== undefined && c.keyword !== '') {
    const needle = c.keyword.toLowerCase();
    const haystack = [a.name, a.keywords ?? '', a.type, a.subType, a.secondaryType ?? '']
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  return true;
}
