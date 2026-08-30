import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { Activity, Chapter } from '../../shared/types';

interface Loaded {
  activities: Activity[];
  chapters: Chapter[];
}

/**
 * Placeholder shell. Proves three things before any UI is written: data/ is
 * served from publicDir, shared types resolve across the web target, and the
 * base path works under the /<repo>/ prefix Pages uses.
 * Replaced by <App /> in the next step.
 */
function Bootstrap(): React.JSX.Element {
  const [state, setState] = useState<Loaded | Error | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL;
    Promise.all([
      fetch(`${base}activities.json`).then((r) => r.json() as Promise<Activity[]>),
      fetch(`${base}chapters.json`).then((r) => r.json() as Promise<Chapter[]>),
    ])
      .then(([activities, chapters]) => setState({ activities, chapters }))
      .catch((err: unknown) => setState(err instanceof Error ? err : new Error(String(err))));
  }, []);

  if (state === null) return <p>Loading...</p>;
  if (state instanceof Error) return <p>Failed to load: {state.message}</p>;

  return (
    <main>
      <h1>AMC Activities</h1>
      <p>
        {state.activities.length} activities across {state.chapters.length} chapters.
      </p>
    </main>
  );
}

const container = document.getElementById('root');
if (!container) throw new Error('#root is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <Bootstrap />
  </StrictMode>,
);
