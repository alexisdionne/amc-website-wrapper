import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseWatches, watchId, type Watch } from '../shared/watch';

const HIKE = 'Hiking, Local Walks, & Trail Running';

test('id is stable for the same query', () => {
  const w: Watch = { name: 'a', query: 'type=Camping&chapter=001' };
  assert.equal(watchId(w), watchId({ name: 'different name', query: w.query }));
});

test('id ignores parameter order', () => {
  const a = watchId({ name: 'a', query: 'type=Camping&type=Backpacking' });
  const b = watchId({ name: 'b', query: 'type=Backpacking&type=Camping' });
  assert.equal(a, b);
});

test('id ignores a leading question mark', () => {
  assert.equal(
    watchId({ name: 'a', query: '?type=Camping' }),
    watchId({ name: 'a', query: 'type=Camping' }),
  );
});

test('editing the filters mints a different id', () => {
  const before = watchId({ name: 'w', query: `type=${encodeURIComponent(HIKE)}` });
  const after = watchId({ name: 'w', query: `type=${encodeURIComponent(HIKE)}&dmax=3` });
  assert.notEqual(before, after);
});

test('id is eight lowercase hex characters', () => {
  assert.match(watchId({ name: 'w', query: 'type=Camping' }), /^[0-9a-f]{8}$/);
});

test('distinct queries do not collide across a realistic set', () => {
  const queries = [
    'type=Camping',
    'type=Backpacking',
    `type=${encodeURIComponent(HIKE)}`,
    'chapter=0015000001Sg061AAB',
    'chapter=0015000001Sg061AAB&dmin=1&dmax=3',
    'status=Published',
    'q=waterfall',
    'from=2026-09-01&to=2026-09-30',
    'sec=1&type=Camping',
  ];
  const ids = new Set(queries.map((query) => watchId({ name: 'x', query })));
  assert.equal(ids.size, queries.length);
});

test('parseWatches accepts a valid file', () => {
  const parsed = parseWatches([{ name: 'Hiking', query: 'type=Camping' }]);
  assert.deepEqual(parsed, [{ name: 'Hiking', query: 'type=Camping' }]);
});

test('parseWatches rejects malformed entries loudly', () => {
  assert.throws(() => parseWatches({}), /expected a top-level array/);
  assert.throws(() => parseWatches([null]), /expected an object/);
  assert.throws(() => parseWatches([{ query: 'type=Camping' }]), /"name"/);
  assert.throws(() => parseWatches([{ name: 'x' }]), /"query"/);
  assert.throws(() => parseWatches([{ name: '', query: 'x' }]), /"name"/);
});

test('parseWatches accepts a webhook env name', () => {
  const parsed = parseWatches([
    { name: 'Hiking', query: 'type=Camping', webhookEnv: 'DISCORD_WEBHOOK_HIKING' },
  ]);
  assert.equal(parsed[0]?.webhookEnv, 'DISCORD_WEBHOOK_HIKING');
});

test('parseWatches rejects a webhook URL in the committed file', () => {
  const url = 'https://discord.com/api/webhooks/123/abc';
  assert.throws(
    () => parseWatches([{ name: 'x', query: 'y', webhookEnv: url }]),
    /not a webhook URL/,
  );
  assert.throws(
    () => parseWatches([{ name: 'x', query: 'y', webhookEnv: 'lower_case' }]),
    /webhookEnv/,
  );
});

test('rerouting a watch keeps its id, so the ledger survives', () => {
  const query = 'type=Camping';
  assert.equal(
    watchId({ name: 'w', query }),
    watchId({ name: 'w', query, webhookEnv: 'DISCORD_WEBHOOK_HIKING' }),
  );
});
