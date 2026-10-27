import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applySessionSettings } from '../src/db/pool.js';

// Per-connection session settings (design §4, plan T10): if either SET fails
// the connection must be discarded instead of being handed to the pool
// without strict mode or UTC. Unit test with a fake mysql2 connection —
// a real server never rejects these SETs, so the failure path cannot be
// exercised against TEST_DB_*.

function fakeConnection({ failOn } = {}) {
  const connection = {
    queries: [],
    destroyed: 0,
    promise() {
      return {
        query: async (sql) => {
          connection.queries.push(sql);
          if (failOn !== undefined && connection.queries.length === failOn) {
            throw new Error('SET failed');
          }
          return [[]];
        },
      };
    },
    destroy() {
      connection.destroyed += 1;
    },
  };
  return connection;
}

test('applySessionSettings sets sql_mode first and time_zone second', async () => {
  const connection = fakeConnection();
  await applySessionSettings(connection);
  assert.equal(connection.destroyed, 0);
  assert.equal(connection.queries.length, 2);
  assert.match(connection.queries[0], /^SET SESSION sql_mode/);
  assert.match(connection.queries[1], /^SET SESSION time_zone/);
});

test('applySessionSettings discards the connection when a SET fails', async () => {
  const onFirst = fakeConnection({ failOn: 1 });
  await applySessionSettings(onFirst);
  assert.equal(onFirst.destroyed, 1, 'connection must be destroyed on the first SET');

  const onSecond = fakeConnection({ failOn: 2 });
  await applySessionSettings(onSecond);
  assert.equal(onSecond.destroyed, 1, 'connection must be destroyed on the second SET');
  assert.equal(onSecond.queries.length, 2);
});

// Correction (plan T10, L35): both SETs must be handed to the connection in
// the same tick, before any of them can resolve, so no borrower query can be
// queued between them. The queries never settle here: a sequential
// implementation would enqueue only the first one.
test('applySessionSettings enqueues both SETs before any of them resolves', () => {
  const connection = {
    queries: [],
    destroyed: 0,
    promise() {
      return {
        query: (sql) => {
          connection.queries.push(sql);
          return new Promise(() => {});
        },
      };
    },
    destroy() {
      connection.destroyed += 1;
    },
  };
  applySessionSettings(connection);
  assert.equal(connection.queries.length, 2, 'both SETs must be queued synchronously');
  assert.match(connection.queries[0], /^SET SESSION sql_mode/);
  assert.match(connection.queries[1], /^SET SESSION time_zone/);
});
