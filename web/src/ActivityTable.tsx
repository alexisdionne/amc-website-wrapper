import { useMemo, useState } from 'react';

import type { Activity, Chapter } from '../../shared/types';

const AMC_ORIGIN = 'https://activities.outdoors.org';

const COLUMNS = [
  { key: 'dates', label: 'Dates' },
  { key: 'name', label: 'Activity' },
  { key: 'chapter', label: 'Chapter' },
  { key: 'type', label: 'Type' },
  { key: 'difficulty', label: 'Difficulty' },
  { key: 'status', label: 'Status' },
  { key: 'cost', label: 'Cost' },
  { key: 'leaders', label: 'Leader' },
] as const;

type ColKey = (typeof COLUMNS)[number]['key'];
type Direction = 'asc' | 'desc';

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Availability order, not alphabetical - "what can I still join" is the useful sort. */
const STATUS_RANK: Record<string, number> = { Published: 0, Waitlist: 1, Full: 2 };

function comparator(key: ColKey, chapterName: (id: string) => string) {
  switch (key) {
    case 'dates':
      return (a: Activity, b: Activity) =>
        cmp(a.startDate, b.startDate) || cmp(a.endDate, b.endDate);
    case 'name':
      return (a: Activity, b: Activity) => cmp(a.name.toLowerCase(), b.name.toLowerCase());
    case 'chapter':
      return (a: Activity, b: Activity) => cmp(chapterName(a.chapterId), chapterName(b.chapterId));
    case 'type':
      return (a: Activity, b: Activity) => cmp(a.type, b.type);
    case 'difficulty':
      return (a: Activity, b: Activity) => a.difficulty - b.difficulty;
    case 'status':
      return (a: Activity, b: Activity) =>
        (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    case 'cost':
      // Unpriced sorts last ascending - absence is not "free".
      return (a: Activity, b: Activity) => (a.costs[0] ?? Infinity) - (b.costs[0] ?? Infinity);
    case 'leaders':
      return (a: Activity, b: Activity) =>
        cmp((a.leaders[0] ?? '').toLowerCase(), (b.leaders[0] ?? '').toLowerCase());
  }
}

interface Props {
  activities: Activity[];
  chapters: Chapter[];
}

export function ActivityTable({ activities, chapters }: Props): React.JSX.Element {
  const [sortKey, setSortKey] = useState<ColKey>('dates');
  const [direction, setDirection] = useState<Direction>('asc');
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set());

  const chapterName = useMemo(() => {
    const byId = new Map(chapters.map((c) => [c.id, c.name]));
    return (id: string): string => byId.get(id) ?? id;
  }, [chapters]);

  const rows = useMemo(() => {
    const sign = direction === 'asc' ? 1 : -1;
    const compare = comparator(sortKey, chapterName);
    // Tiebreak on id so equal keys never reorder between renders.
    return [...activities].sort((a, b) => sign * compare(a, b) || cmp(a.id, b.id));
  }, [activities, sortKey, direction, chapterName]);

  const shown = COLUMNS.filter((c) => !hidden.has(c.key));

  const sortBy = (key: ColKey): void => {
    if (key === sortKey) setDirection(direction === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(key);
      setDirection('asc');
    }
  };

  const toggleColumn = (key: ColKey): void => {
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setHidden(next);
  };

  return (
    <>
      <fieldset>
        <legend>Columns</legend>
        <div className="columns-toggle">
          {COLUMNS.map((c) => (
            <label key={c.key}>
              <input
                type="checkbox"
                checked={!hidden.has(c.key)}
                onChange={() => toggleColumn(c.key)}
              />{' '}
              {c.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {shown.map((c) => (
                <th
                  key={c.key}
                  aria-sort={
                    sortKey === c.key ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'
                  }
                >
                  <button type="button" onClick={() => sortBy(c.key)}>
                    {c.label}
                    {sortKey === c.key ? (direction === 'asc' ? ' \u25B2' : ' \u25BC') : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                {shown.map((c) => {
                  switch (c.key) {
                    case 'dates':
                      return (
                        <td key={c.key} className="tabular">
                          {a.startDate === a.endDate ? a.startDate : `${a.startDate} - ${a.endDate}`}
                        </td>
                      );
                    case 'name':
                      return (
                        <td key={c.key} className="wrap">
                          <a href={`${AMC_ORIGIN}${a.url}`} target="_blank" rel="noreferrer">
                            {a.name}
                          </a>
                        </td>
                      );
                    case 'chapter':
                      return <td key={c.key}>{chapterName(a.chapterId)}</td>;
                    case 'type':
                      return <td key={c.key}>{a.type}</td>;
                    case 'difficulty':
                      return (
                        <td key={c.key} className="tabular">
                          {a.difficultyLabel}
                        </td>
                      );
                    case 'status':
                      return (
                        <td key={c.key}>
                          <span className={`chip chip-${a.status.toLowerCase()}`}>{a.status}</span>
                        </td>
                      );
                    case 'cost':
                      return (
                        <td key={c.key} className="tabular">
                          {a.costs.length > 0 ? `$${a.costs[0]}` : <span className="muted">-</span>}
                        </td>
                      );
                    case 'leaders':
                      return <td key={c.key}>{a.leaders[0] ?? <span className="muted">-</span>}</td>;
                  }
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
