import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { normalizeFeed, stableStringify } from '../scripts/normalize';
import { EMPTY_CRITERIA, parseCriteria, serializeCriteria, type Criteria } from '../shared/criteria';
import { matches } from '../shared/match';
import type { RawActivity } from '../shared/types';

const raw = JSON.parse(
  readFileSync(new URL('./fixtures/activities.sample.json', import.meta.url), 'utf8'),
) as RawActivity[];
const { activities } = normalizeFeed(raw);

const HIKE = 'Hiking, Local Walks, & Trail Running';
const TARGETS = [HIKE, 'Backpacking', 'Camping'];
const DAY_MS = 86_400_000;
const spanDays = (a: { startDate: string; endDate: string }): number =>
  (Date.parse(a.endDate) - Date.parse(a.startDate)) / DAY_MS;
const select = (c: Partial<Criteria>) =>
  activities.filter((a) => matches(a, { ...EMPTY_CRITERIA, ...c }));

test('fixture normalizes to 12 activities sorted by id', () => {
  assert.equal(activities.length, 12);
  const ids = activities.map((a) => a.id);
  assert.deepEqual(ids, [...ids].sort());
});

test('empty criteria constrains nothing', () => {
  assert.equal(select({}).length, 12);
});

test('date window uses range overlap, not start-date containment', () => {
  const windowStart = '2026-09-10';
  const windowEnd = '2026-09-20';
  const hits = select({ windowStart, windowEnd });

  assert.equal(hits.length, 3);
  for (const a of hits) {
    assert.ok(a.startDate <= windowEnd && a.endDate >= windowStart, `${a.id} does not overlap`);
  }

  // The regression guard: every one of these begins before the window opens,
  // so filtering on startDate alone would surface none of them.
  const startDateOnly = activities.filter(
    (a) => a.startDate >= windowStart && a.startDate <= windowEnd,
  );
  assert.equal(startDateOnly.length, 0);
});

test('a trip entirely containing the window still matches', () => {
  const windowStart = '2026-09-10';
  const windowEnd = '2026-09-20';
  const spanning = activities.filter(
    (a) => a.startDate < windowStart && a.endDate > windowEnd && spanDays(a) <= 365,
  );
  assert.ok(spanning.length > 0);
  for (const a of spanning) {
    assert.equal(matches(a, { ...EMPTY_CRITERIA, windowStart, windowEnd }), true);
  }
});

test('evergreen rows are excluded once a window is set', () => {
  const evergreen = activities.filter((a) => spanDays(a) > 365);
  assert.equal(evergreen.length, 3, 'fixture carries three evergreen rows');
  for (const a of evergreen) {
    assert.equal(
      matches(a, { ...EMPTY_CRITERIA, windowStart: '2026-09-10', windowEnd: '2026-09-20' }),
      false,
      `${a.id} leaked into a windowed view`,
    );
  }
});

test('evergreen rows stay visible when no window is set', () => {
  for (const a of activities.filter((x) => spanDays(x) > 365)) {
    assert.equal(matches(a, EMPTY_CRITERIA), true);
  }
});

test('duration catches evergreens an end-date cutoff misses', () => {
  const evergreen = activities.filter((a) => spanDays(a) > 365);
  const caughtByYearCutoff = evergreen.filter((a) => a.endDate >= '2050-01-01');
  assert.equal(caughtByYearCutoff.length, 2);
  assert.equal(evergreen.length, 3, 'the 2034 row is only caught by duration');
});

test('a 364-day activity is not treated as evergreen', () => {
  const boundary = activities.find((a) => Math.round(spanDays(a)) === 364);
  assert.ok(boundary, 'fixture must retain the 364-day boundary row');
  assert.equal(
    matches(boundary, { ...EMPTY_CRITERIA, windowStart: '2026-06-01', windowEnd: '2026-06-30' }),
    true,
  );
});

test('type filter matches the main type only by default', () => {
  assert.equal(select({ types: TARGETS }).length, 3);
});

test('includeSecondaryType widens the match', () => {
  assert.equal(select({ types: TARGETS, includeSecondaryType: true }).length, 4);
});

test('type values containing commas survive as filter input', () => {
  const hits = select({ types: [HIKE] });
  assert.ok(hits.length > 0);
  for (const a of hits) assert.equal(a.type, HIKE);
});

test('status filter selects only the requested statuses', () => {
  const hits = select({ statuses: ['Published'] });
  assert.equal(hits.length, 8);
  for (const a of hits) assert.equal(a.status, 'Published');
});

test('difficulty range is inclusive on both bounds', () => {
  const hits = select({ difficultyMin: 1, difficultyMax: 3 });
  assert.equal(hits.length, 8);
  for (const a of hits) assert.ok(a.difficulty >= 1 && a.difficulty <= 3);
});

test('multi-chapter selection returns rows from every chapter chosen', () => {
  const chapters = [...new Set(activities.map((a) => a.chapterId))].slice(0, 2);
  const hits = select({ chapters });
  assert.equal(new Set(hits.map((a) => a.chapterId)).size, 2);
  for (const a of hits) assert.ok(chapters.includes(a.chapterId));
});

test('audience filter excludes rows carrying no audience', () => {
  const withAudience = activities.find((a) => a.audience !== undefined);
  assert.ok(withAudience?.audience);
  const hits = select({ audiences: [withAudience.audience] });
  assert.ok(hits.length > 0);
  for (const a of hits) assert.equal(a.audience, withAudience.audience);
  assert.ok(activities.some((a) => a.audience === undefined));
});

test('round-trips values containing commas, ampersands and URL syntax', () => {
  const c: Criteria = {
    ...EMPTY_CRITERIA,
    types: [HIKE, 'Nature & Arts'],
    keyword: 'a&b, c ?=#',
    includeSecondaryType: true,
    difficultyMin: 2,
    windowEnd: '2026-12-31',
  };
  assert.equal(stableStringify(parseCriteria(serializeCriteria(c))), stableStringify(c));
});

test('serialization is independent of input order', () => {
  assert.equal(
    serializeCriteria(parseCriteria('type=Camping&type=Backpacking')),
    serializeCriteria(parseCriteria('type=Backpacking&type=Camping')),
  );
});

test('a leading question mark is accepted', () => {
  assert.deepEqual(parseCriteria('?type=Camping'), parseCriteria('type=Camping'));
});

test('property: 2000 generated criteria round-trip exactly', () => {
  const pool = {
    types: [HIKE, 'Backpacking', 'Camping', 'Nature & Arts'],
    chapters: ['0015000001Sg061AAB', '001VX00000utYFKYA2'],
    statuses: ['Published', 'Full', 'Waitlist'] as const,
    audiences: ['Family Friendly', '20s & 30s'],
    keywords: ['waterfall', 'a&b, c', '', 'x?=&#'],
  };
  const pick = <T>(arr: readonly T[]): T[] => arr.filter(() => Math.random() < 0.5);

  for (let i = 0; i < 2000; i++) {
    const kw = pool.keywords[Math.floor(Math.random() * pool.keywords.length)]!;
    const c: Criteria = {
      ...EMPTY_CRITERIA,
      types: pick(pool.types).sort(),
      chapters: pick(pool.chapters).sort(),
      statuses: pick(pool.statuses).sort(),
      audiences: pick(pool.audiences).sort(),
      includeSecondaryType: Math.random() < 0.5,
      ...(Math.random() < 0.5 ? { difficultyMin: 1 + Math.floor(Math.random() * 6) } : {}),
      ...(Math.random() < 0.5 ? { windowStart: '2026-09-01' } : {}),
      ...(kw === '' ? {} : { keyword: kw }),
    };
    assert.equal(stableStringify(parseCriteria(serializeCriteria(c))), stableStringify(c));
  }
});
