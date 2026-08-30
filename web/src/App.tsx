import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  EMPTY_CRITERIA,
  parseCriteria,
  serializeCriteria,
  type Criteria,
} from '../../shared/criteria';
import { matches } from '../../shared/match';
import type { Activity, Chapter } from '../../shared/types';
import { ActivityTable } from './ActivityTable';
import { FilterPanel } from './FilterPanel';

/**
 * AMC's own label for the hiking category. Hardcoded because a default needs a
 * concrete value; if AMC renames it the filter silently matches nothing, so the
 * app warns when no loaded activity carries it.
 */
const HIKING = 'Hiking, Local Walks, & Trail Running';

const DEFAULT_CRITERIA: Criteria = {
  ...EMPTY_CRITERIA,
  types: [HIKING, 'Backpacking', 'Camping'],
};

type FeedState =
  | { status: 'loading' }
  | { status: 'error'; error: Error }
  | { status: 'ready'; activities: Activity[]; chapters: Chapter[] };

function useFeed(): FeedState {
  const [state, setState] = useState<FeedState>({ status: 'loading' });

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    let cancelled = false;

    const load = async (): Promise<void> => {
      const [activities, chapters] = await Promise.all([
        fetch(`${base}activities.json`).then((r) => r.json() as Promise<Activity[]>),
        fetch(`${base}chapters.json`).then((r) => r.json() as Promise<Chapter[]>),
      ]);
      if (!cancelled) setState({ status: 'ready', activities, chapters });
    };

    void load().catch((err: unknown) => {
      if (!cancelled) {
        setState({ status: 'error', error: err instanceof Error ? err : new Error(String(err)) });
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}

/**
 * Filter state lives in the URL, serialized by the same codec watches.json uses.
 * replaceState rather than pushState: every checkbox click would otherwise add a
 * history entry and turn Back into an undo button.
 */
function useCriteriaUrl(): [Criteria, (next: Criteria) => void] {
  const [criteria, setLocal] = useState<Criteria>(() =>
    window.location.search === '' ? DEFAULT_CRITERIA : parseCriteria(window.location.search),
  );

  const setCriteria = useCallback((next: Criteria): void => {
    const qs = serializeCriteria(next);
    window.history.replaceState(null, '', qs === '' ? window.location.pathname : `?${qs}`);
    setLocal(next);
  }, []);

  // Reflect the starting state into the URL so the view is always bookmarkable,
  // including the default one.
  useEffect(() => {
    if (window.location.search === '') setCriteria(DEFAULT_CRITERIA);
  }, [setCriteria]);

  useEffect(() => {
    const onPop = (): void => setLocal(parseCriteria(window.location.search));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return [criteria, setCriteria];
}

export function App(): React.JSX.Element {
  const feed = useFeed();
  const [criteria, setCriteria] = useCriteriaUrl();

  const activities = feed.status === 'ready' ? feed.activities : [];
  const visible = useMemo(
    () => activities.filter((a) => matches(a, criteria)),
    [activities, criteria],
  );

  useEffect(() => {
    if (feed.status !== 'ready') return;
    const known = new Set(feed.activities.map((a) => a.type));
    const missing = DEFAULT_CRITERIA.types.filter((t) => !known.has(t));
    if (missing.length > 0) {
      console.warn(
        `[App] default type not present in feed - AMC may have renamed: ${missing.join(', ')}`,
      );
    }
  }, [feed]);

  if (feed.status === 'loading') return <p>Loading activities...</p>;
  if (feed.status === 'error') return <p role="alert">Failed to load: {feed.error.message}</p>;

  return (
    <main>
      <h1>AMC Activities</h1>
      <p>
        {visible.length} of {feed.activities.length} activities across {feed.chapters.length}{' '}
        chapters.
      </p>
      <FilterPanel
        activities={feed.activities}
        chapters={feed.chapters}
        criteria={criteria}
        onChange={setCriteria}
      />
      <ActivityTable activities={visible} chapters={feed.chapters} />
    </main>
  );
}
