import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Alert } from '../scripts/diff';
import { buildEmbed, buildMessages, buildRoutedMessages } from '../scripts/notify';
import type { Activity } from '../shared/types';

const chapterName = (id: string): string => (id === 'c1' ? 'AMC Boston Chapter' : id);

function activity(id: string, over: Partial<Activity> = {}): Activity {
  return {
    id,
    name: `Trip ${id}`,
    chapterId: 'c1',
    startDate: '2026-10-01',
    endDate: '2026-10-01',
    startTime: '9:00 AM',
    timeZone: 'US EST',
    type: 'Camping',
    subType: 'Camping',
    difficulty: 3,
    difficultyLabel: '3 - Easy',
    program: 'Chapter',
    registrationType: 'Registration',
    status: 'Published',
    registration: 'open',
    costs: [],
    leaders: [],
    url: `/s/oc-activity/${id}`,
    ...over,
  };
}

const alert = (kind: 'new' | 'reopened', a: Activity, watchId = 'abcd1234'): Alert => ({
  watchId,
  watchName: 'Camping',
  kind,
  activity: a,
});

test('embed links to the real AMC activity page', () => {
  const e = buildEmbed(alert('new', activity('x')), chapterName);
  assert.equal(e.url, 'https://activities.outdoors.org/s/oc-activity/x');
});

test('embed titles distinguish new from reopened', () => {
  assert.match(buildEmbed(alert('new', activity('x')), chapterName).title, /^New: /);
  assert.match(
    buildEmbed(alert('reopened', activity('x')), chapterName).title,
    /^Reopened - spot available: /,
  );
});

test('kinds use different colours', () => {
  const a = buildEmbed(alert('new', activity('x')), chapterName).color;
  const b = buildEmbed(alert('reopened', activity('x')), chapterName).color;
  assert.notEqual(a, b);
});

test('long names are truncated within the title limit', () => {
  const e = buildEmbed(alert('new', activity('x', { name: 'z'.repeat(500) })), chapterName);
  assert.ok(e.title.length <= 200, `title was ${e.title.length}`);
  assert.ok(e.title.endsWith('...'));
});

test('embed omits cost entirely', () => {
  const e = buildEmbed(alert('new', activity('x', { costs: [40] })), chapterName);
  assert.equal(
    e.fields.some((f) => f.name === 'Cost'),
    false,
  );
});

test('leader field is omitted when there is no leader', () => {
  const e = buildEmbed(alert('new', activity('x')), chapterName);
  assert.equal(
    e.fields.some((f) => f.name === 'Leader'),
    false,
  );
});

test('leader field appears when present', () => {
  const e = buildEmbed(alert('new', activity('x', { leaders: ['Celia Revell Binder'] })), chapterName);
  assert.equal(e.fields.find((f) => f.name === 'Leader')?.value, 'Celia Revell Binder');
});

test('chapter id is resolved to a name', () => {
  const e = buildEmbed(alert('new', activity('x')), chapterName);
  assert.equal(e.fields.find((f) => f.name === 'Chapter')?.value, 'AMC Boston Chapter');
});

test('multi-day activities show a date range', () => {
  const e = buildEmbed(alert('new', activity('x', { endDate: '2026-10-04' })), chapterName);
  assert.equal(e.fields.find((f) => f.name === 'Dates')?.value, '2026-10-01 - 2026-10-04');
});

test('no alerts produces no messages, so nothing is posted', () => {
  assert.deepEqual(buildMessages([], chapterName), []);
});

test('messages batch at ten embeds', () => {
  const alerts = Array.from({ length: 23 }, (_, i) => alert('new', activity(`a${i}`)));
  const messages = buildMessages(alerts, chapterName);
  assert.deepEqual(
    messages.map((m) => m.embeds.length),
    [10, 10, 3],
  );
});

test('reopened alerts lead the batch', () => {
  const alerts = [
    alert('new', activity('n1')),
    alert('reopened', activity('r1')),
    alert('new', activity('n2')),
  ];
  const [first] = buildMessages(alerts, chapterName);
  assert.equal(first?.embeds[0]?.title.startsWith('Reopened'), true);
});

test('footer is truncated so one long watch name cannot fail the whole batch', () => {
  const a: Alert = {
    watchId: 'x',
    watchName: 'w'.repeat(5000),
    kind: 'new',
    activity: activity('x'),
  };
  const e = buildEmbed(a, chapterName);
  assert.ok(e.footer.text.length <= 100, `footer was ${e.footer.text.length}`);
});

test('alerts split by destination channel', () => {
  const route = (id: string): string =>
    id === 'young' ? 'DISCORD_WEBHOOK_YOUNG' : 'DISCORD_WEBHOOK_HIKING';
  const routed = buildRoutedMessages(
    [
      alert('new', activity('a'), 'young'),
      alert('new', activity('b'), 'hike'),
      alert('new', activity('c'), 'young'),
    ],
    chapterName,
    route,
  );
  assert.deepEqual([...routed.keys()], ['DISCORD_WEBHOOK_YOUNG', 'DISCORD_WEBHOOK_HIKING']);
  assert.equal(routed.get('DISCORD_WEBHOOK_YOUNG')?.[0]?.embeds.length, 2);
  assert.equal(routed.get('DISCORD_WEBHOOK_HIKING')?.[0]?.embeds.length, 1);
});

test('the ten-embed cap applies per channel, not across them', () => {
  const alerts = Array.from({ length: 12 }, (_, i) =>
    alert('new', activity(`a${i}`), i < 6 ? 'x' : 'y'),
  );
  const routed = buildRoutedMessages(alerts, chapterName, (id) => `DISCORD_WEBHOOK_${id.toUpperCase()}`);
  assert.deepEqual(
    [...routed.values()].map((m) => m.length),
    [1, 1],
  );
});

test('no alerts routes nowhere', () => {
  assert.equal(buildRoutedMessages([], chapterName, () => 'X').size, 0);
});
