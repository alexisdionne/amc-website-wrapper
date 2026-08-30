import { parseCriteria } from '../shared/criteria';
import { matches } from '../shared/match';
import type { Activity, ActivityStatus } from '../shared/types';
import { watchId, type Watch } from '../shared/watch';

export type AlertKind = 'new' | 'reopened';

/** Suppress a repeat alert for the same watch/activity pair within this window. */
export const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface AlertState {
  version: 1;
  /** Global status history. Reopen is a property of the activity, not of any
   *  watch, so storing it once avoids duplicating the feed across every watch. */
  activities: Record<string, { status: string; seenAt: string }>;
  watches: Record<string, Record<string, { notifiedAt: string; kind: AlertKind }>>;
}

export interface Alert {
  watchId: string;
  watchName: string;
  kind: AlertKind;
  activity: Activity;
}

export function emptyState(): AlertState {
  return { version: 1, activities: {}, watches: {} };
}

/**
 * An unreadable or future-versioned state file degrades to empty rather than
 * throwing. Empty means every watch re-seeds silently, which posts nothing -
 * the safe direction. Throwing would stall the poller; trusting it blindly
 * could fire hundreds of false alerts.
 */
export function loadState(raw: unknown): AlertState {
  if (typeof raw !== 'object' || raw === null) return emptyState();
  const s = raw as Partial<AlertState>;
  if (s.version !== 1 || typeof s.activities !== 'object' || typeof s.watches !== 'object') {
    console.warn('[diff] unrecognized alert-state.json - reseeding silently');
    return emptyState();
  }
  return { version: 1, activities: { ...s.activities }, watches: { ...s.watches } };
}

const AVAILABLE: ActivityStatus = 'Published';

export interface DiffInput {
  state: AlertState;
  activities: Activity[];
  watches: Watch[];
  now: Date;
  cooldownMs?: number;
}

export function computeAlerts(input: DiffInput): { alerts: Alert[]; nextState: AlertState } {
  const { state, activities, watches, now } = input;
  const cooldownMs = input.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const nowIso = now.toISOString();
  const inFeed = new Set(activities.map((a) => a.id));

  // 1. Which activities became available since the previous run. An id absent
  //    from the table is not reopened - it is simply new to us.
  const reopened = new Set<string>();
  for (const a of activities) {
    const previous = state.activities[a.id];
    if (previous && previous.status !== AVAILABLE && a.status === AVAILABLE) {
      reopened.add(a.id);
    }
  }

  // 2. Rebuild the status table from the current feed, dropping departed rows.
  const nextActivities: AlertState['activities'] = {};
  for (const a of activities) nextActivities[a.id] = { status: a.status, seenAt: nowIso };

  const alerts: Alert[] = [];
  const nextWatches: AlertState['watches'] = {};

  for (const watch of watches) {
    const id = watchId(watch);
    const criteria = parseCriteria(watch.query);
    const previousLedger = state.watches[id];
    const ledger: Record<string, { notifiedAt: string; kind: AlertKind }> = {};

    // Carry forward everything still in the feed, including activities that no
    // longer match. Dropping non-matching entries would make a later reopen
    // indistinguishable from a first sighting.
    if (previousLedger) {
      for (const [activityId, entry] of Object.entries(previousLedger)) {
        if (inFeed.has(activityId)) ledger[activityId] = entry;
      }
    }

    const matched = activities.filter((a) => matches(a, criteria));

    if (!previousLedger) {
      // Unseen watch: record current matches without posting. Arming a watch
      // must not replay everything already in the feed.
      for (const a of matched) ledger[a.id] = { notifiedAt: nowIso, kind: 'new' };
      nextWatches[id] = ledger;
      continue;
    }

    for (const a of matched) {
      const entry = ledger[a.id];
      if (!entry) {
        ledger[a.id] = { notifiedAt: nowIso, kind: 'new' };
        alerts.push({ watchId: id, watchName: watch.name, kind: 'new', activity: a });
        continue;
      }
      if (reopened.has(a.id) && now.getTime() - Date.parse(entry.notifiedAt) >= cooldownMs) {
        ledger[a.id] = { notifiedAt: nowIso, kind: 'reopened' };
        alerts.push({ watchId: id, watchName: watch.name, kind: 'reopened', activity: a });
      }
    }

    nextWatches[id] = ledger;
  }

  return {
    alerts,
    nextState: { version: 1, activities: nextActivities, watches: nextWatches },
  };
}
