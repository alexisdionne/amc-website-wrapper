import { useMemo } from 'react';

import { EMPTY_CRITERIA, type Criteria } from '../../shared/criteria';
import { matches } from '../../shared/match';
import type {
  Activity,
  ActivityStatus,
  Chapter,
  RegistrationState,
} from '../../shared/types';

const STATUSES: ActivityStatus[] = ['Published', 'Waitlist', 'Full'];

/** Ordered by usefulness, not alphabetically: what you can join, then what is coming. */
const REGISTRATIONS: Array<{ value: RegistrationState; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'not-yet', label: 'Not yet open' },
  { value: 'closed', label: 'Closed' },
];
const DIFFICULTIES = [1, 2, 3, 4, 5, 6];

interface Props {
  activities: Activity[];
  chapters: Chapter[];
  criteria: Criteria;
  onChange: (next: Criteria) => void;
}

const toggle = (list: string[], value: string): string[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort();

/**
 * Counts each option against the other active filters but NOT against its own
 * dimension - so a chapter's number is "what checking this adds", not "what is
 * already showing". One pass over the rows per dimension, memoized.
 */
function facetCounts(
  activities: Activity[],
  base: Criteria,
  key: (a: Activity) => string | undefined,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const a of activities) {
    if (!matches(a, base)) continue;
    const k = key(a);
    if (k !== undefined) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return counts;
}

export function FilterPanel({ activities, chapters, criteria, onChange }: Props): React.JSX.Element {
  const chapterCounts = useMemo(
    () => facetCounts(activities, { ...criteria, chapters: [] }, (a) => a.chapterId),
    [activities, criteria],
  );

  /**
   * Unfiltered totals, so 'inactive' means the chapter genuinely has no activities
   * rather than none matching the current filters. Those are different facts and
   * the label must not conflate them.
   */
  const chapterTotals = useMemo(
    () => facetCounts(activities, EMPTY_CRITERIA, (a) => a.chapterId),
    [activities],
  );
  const typeCounts = useMemo(
    () => facetCounts(activities, { ...criteria, types: [] }, (a) => a.type),
    [activities, criteria],
  );

  /**
   * Chapters with no activities at all are hidden. A selected one stays listed
   * even when empty - otherwise a bookmarked or watch-derived selection would
   * filter invisibly with no way to clear it.
   */
  const visibleChapters = useMemo(
    () =>
      chapters.filter(
        (c) => (chapterTotals.get(c.id) ?? 0) > 0 || criteria.chapters.includes(c.id),
      ),
    [chapters, chapterTotals, criteria.chapters],
  );
  const registrationCounts = useMemo(
    () => facetCounts(activities, { ...criteria, registrations: [] }, (a) => a.registration),
    [activities, criteria],
  );

  const allTypes = useMemo(() => [...new Set(activities.map((a) => a.type))].sort(), [activities]);

  /** exactOptionalPropertyTypes forbids assigning undefined, so clearing deletes the key. */
  const setOptional = (
    key: 'difficultyMin' | 'difficultyMax' | 'windowStart' | 'windowEnd' | 'keyword',
    raw: string,
  ): void => {
    const next: Criteria = { ...criteria };
    if (raw === '') {
      delete next[key];
    } else if (key === 'difficultyMin' || key === 'difficultyMax') {
      next[key] = Number(raw);
    } else {
      next[key] = raw;
    }
    onChange(next);
  };

  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <fieldset>
        <legend>Activity type</legend>
        {allTypes.map((t) => (
          <label key={t} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={criteria.types.includes(t)}
              onChange={() => onChange({ ...criteria, types: toggle(criteria.types, t) })}
            />{' '}
            {t} <span className="muted tabular">({typeCounts.get(t) ?? 0})</span>
          </label>
        ))}
        <label style={{ display: 'block' }}>
          <input
            type="checkbox"
            checked={criteria.includeSecondaryType}
            onChange={() =>
              onChange({ ...criteria, includeSecondaryType: !criteria.includeSecondaryType })
            }
          />{' '}
          Also match secondary activity type
        </label>
      </fieldset>

      <fieldset>
        <legend>Chapter</legend>
        {visibleChapters.map((c) => {
          const n = chapterCounts.get(c.id) ?? 0;
          return (
            <label key={c.id} style={{ display: 'block' }}>
              <input
                type="checkbox"
                checked={criteria.chapters.includes(c.id)}
                onChange={() => onChange({ ...criteria, chapters: toggle(criteria.chapters, c.id) })}
              />{' '}
              {c.name} <span className="muted tabular">({n})</span>
            </label>
          );
        })}
      </fieldset>

      <fieldset>
        <legend>Status</legend>
        {STATUSES.map((s) => (
          <label key={s} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={criteria.statuses.includes(s)}
              onChange={() =>
                onChange({
                  ...criteria,
                  statuses: toggle(criteria.statuses, s) as ActivityStatus[],
                })
              }
            />{' '}
            {s}
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Registration</legend>
        {REGISTRATIONS.map((r) => (
          <label key={r.value} style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={criteria.registrations.includes(r.value)}
              onChange={() =>
                onChange({
                  ...criteria,
                  registrations: toggle(criteria.registrations, r.value) as RegistrationState[],
                })
              }
            />{' '}
            {r.label}{' '}
            <span className="muted tabular">({registrationCounts.get(r.value) ?? 0})</span>
          </label>
        ))}
        <p className="muted">
          Separate from status - an activity can be full but still accepting registrations.
        </p>
      </fieldset>

      <fieldset>
        <legend>Difficulty</legend>
        <label>
          From{' '}
          <select
            value={criteria.difficultyMin ?? ''}
            onChange={(e) => setOptional('difficultyMin', e.target.value)}
          >
            <option value="">any</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>{' '}
        <label>
          to{' '}
          <select
            value={criteria.difficultyMax ?? ''}
            onChange={(e) => setOptional('difficultyMax', e.target.value)}
          >
            <option value="">any</option>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </fieldset>

      <fieldset>
        <legend>Dates</legend>
        <label>
          From{' '}
          <input
            type="date"
            value={criteria.windowStart ?? ''}
            onChange={(e) => setOptional('windowStart', e.target.value)}
          />
        </label>{' '}
        <label>
          to{' '}
          <input
            type="date"
            value={criteria.windowEnd ?? ''}
            onChange={(e) => setOptional('windowEnd', e.target.value)}
          />
        </label>
        <p className="muted">
          Matches any trip overlapping the window, including multi-day trips that start before it.
        </p>
      </fieldset>

      <fieldset>
        <legend>Keyword</legend>
        <label>
          Search names and keywords{' '}
          <input
            type="search"
            value={criteria.keyword ?? ''}
            onChange={(e) => setOptional('keyword', e.target.value)}
          />
        </label>
      </fieldset>
    </form>
  );
}
