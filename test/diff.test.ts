import assert from 'node:assert/strict';
import { test } from 'node:test';

import { computeAlerts, emptyState, loadState, type AlertState } from '../scripts/diff';
import type { Activity, ActivityStatus } from '../shared/types';
import type { Watch } from '../shared/watch';

const WATCH: Watch = { name: 'Camping', query: 'type=Camping' };
const T0 = new Date('2026-09-01T00:00:00.000Z');
const later = (hours: number): Date => new Date(T0.getTime() + hours * 3600_000);

function activity(id: string, status: ActivityStatus = 'Published', type = 'Camping'): Activity {
  return {
    id,
    name: `Trip ${id}`,
    chapterId: 'c1',
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    startTime: '9:00 AM',
    timeZone: 'US EST',
    type,
    subType: 'Camping',
    difficulty: 3,
    difficultyLabel: '3 - Easy',
    program: 'Chapter',
    registrationType: 'Registration',
    status,
    openForRegistration: true,
    costs: [],
    leaders: [],
    url: `/s/oc-activity/${id}`,
  };
}

/** Arms a watch against the given feed, returning the post-seed state. */
function seeded(activities: Activity[]): AlertState {
  const { alerts, nextState } = computeAlerts({
    state: emptyState(),
    activities,
    watches: [WATCH],
    now: T0,
  });
  assert.equal(alerts.length, 0, 'seeding must post nothing');
  return nextState;
}

test('arming a watch seeds silently', () => {
  const { alerts, nextState } = computeAlerts({
    state: emptyState(),
    activities: [activity('a'), activity('b')],
    watches: [WATCH],
    now: T0,
  });
  assert.equal(alerts.length, 0);
  assert.equal(Object.keys(Object.values(nextState.watches)[0] ?? {}).length, 2);
});

test('a newly matching activity alerts once', () => {
  const state = seeded([activity('a')]);
  const { alerts } = computeAlerts({
    state,
    activities: [activity('a'), activity('b')],
    watches: [WATCH],
    now: later(1),
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, 'new');
  assert.equal(alerts[0]?.activity.id, 'b');
});

test('an unchanged rerun alerts nothing', () => {
  const state = seeded([activity('a')]);
  const { alerts } = computeAlerts({
    state,
    activities: [activity('a')],
    watches: [WATCH],
    now: later(1),
  });
  assert.equal(alerts.length, 0);
});

test('going Full alerts nothing but retains the ledger entry', () => {
  const state = seeded([activity('a')]);
  const { alerts, nextState } = computeAlerts({
    state,
    activities: [activity('a', 'Full')],
    watches: [WATCH],
    now: later(1),
  });
  assert.equal(alerts.length, 0);
  assert.ok(Object.values(nextState.watches)[0]?.['a'], 'entry must survive going Full');
});

test('reopening after the cooldown alerts as reopened', () => {
  let state = seeded([activity('a')]);
  state = computeAlerts({
    state,
    activities: [activity('a', 'Full')],
    watches: [WATCH],
    now: later(1),
  }).nextState;

  const { alerts } = computeAlerts({
    state,
    activities: [activity('a', 'Published')],
    watches: [WATCH],
    now: later(48),
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, 'reopened');
});

test('reopening inside the cooldown stays silent', () => {
  let state = seeded([activity('a')]);
  state = computeAlerts({
    state,
    activities: [activity('a', 'Full')],
    watches: [WATCH],
    now: later(1),
  }).nextState;

  const { alerts } = computeAlerts({
    state,
    activities: [activity('a', 'Published')],
    watches: [WATCH],
    now: later(2),
  });
  assert.equal(alerts.length, 0);
});

test('an activity leaving the feed is pruned from both tables', () => {
  const state = seeded([activity('a'), activity('b')]);
  const { nextState } = computeAlerts({
    state,
    activities: [activity('a')],
    watches: [WATCH],
    now: later(1),
  });
  assert.deepEqual(Object.keys(nextState.activities), ['a']);
  assert.deepEqual(Object.keys(Object.values(nextState.watches)[0] ?? {}), ['a']);
});

test('editing a watch query reseeds silently instead of refiring', () => {
  const state = seeded([activity('a')]);
  const edited: Watch = { name: 'Camping', query: 'type=Camping&dmax=5' };
  const { alerts, nextState } = computeAlerts({
    state,
    activities: [activity('a')],
    watches: [edited],
    now: later(1),
  });
  assert.equal(alerts.length, 0);
  assert.equal(Object.keys(nextState.watches).length, 1, 'old ledger is not carried over');
});

test('a first sighting that is already Full does not count as reopened', () => {
  const state = seeded([activity('a')]);
  const { alerts } = computeAlerts({
    state,
    activities: [activity('a'), activity('b', 'Full')],
    watches: [WATCH],
    now: later(1),
  });
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.kind, 'new', 'unseen activities are new, never reopened');
});

test('loadState degrades to empty rather than throwing', () => {
  assert.deepEqual(loadState(null), emptyState());
  assert.deepEqual(loadState({ version: 99 }), emptyState());
  assert.deepEqual(loadState('nonsense'), emptyState());
});

/**
 * The case the retention rule exists for. A watch filtered to Published stops
 * matching when the trip fills, so its ledger entry must survive the gap - or
 * the eventual reopen reads as a first sighting and reports the wrong kind.
 */
const OPEN_ONLY: Watch = { name: 'Open camping', query: 'status=Published&type=Camping' };

test('a watch filtered to Published retains entries through a Full spell', () => {
  const armed = computeAlerts({
    state: emptyState(),
    activities: [activity('a', 'Published')],
    watches: [OPEN_ONLY],
    now: T0,
  });
  assert.equal(armed.alerts.length, 0);

  // Fills up: no longer matches the watch at all.
  const filled = computeAlerts({
    state: armed.nextState,
    activities: [activity('a', 'Full')],
    watches: [OPEN_ONLY],
    now: later(1),
  });
  assert.equal(filled.alerts.length, 0);
  assert.ok(
    Object.values(filled.nextState.watches)[0]?.['a'],
    'entry must survive even though the activity no longer matches',
  );

  // A spot opens well after the cooldown.
  const reopened = computeAlerts({
    state: filled.nextState,
    activities: [activity('a', 'Published')],
    watches: [OPEN_ONLY],
    now: later(48),
  });
  assert.equal(reopened.alerts.length, 1);
  assert.equal(
    reopened.alerts[0]?.kind,
    'reopened',
    'must report reopened, not new - proving the entry was retained',
  );
});
