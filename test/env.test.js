import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'development',
  PORT: '4000',
  APP_ORIGIN: 'http://localhost:4000',
  DB_HOST: '127.0.0.1',
  DB_PORT: '3306',
  DB_NAME: 'api_to_do_qa',
  DB_USER: 'qa_app',
  DB_PASSWORD: 'secret',
  DB_SSL: 'false',
  DB_CONNECTION_LIMIT: '5',
  SESSION_DAYS: '7',
  TRUST_PROXY: '0',
};

test('loadConfig returns a frozen config from valid env', () => {
  const config = loadConfig(validEnv);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.port, 4000);
  assert.equal(config.db.host, '127.0.0.1');
  assert.equal(config.db.port, 3306);
  assert.equal(config.db.name, 'api_to_do_qa');
  assert.equal(config.db.user, 'qa_app');
  assert.equal(config.db.ssl, false);
  assert.equal(config.db.connectionLimit, 5);
  assert.equal(config.sessionDays, 7);
  assert.equal(config.trustProxy, 0);
  assert.ok(Object.isFrozen(config));
  assert.ok(Object.isFrozen(config.db));
});

test('loadConfig fills optional defaults', () => {
  const { PORT, DB_SSL, DB_CONNECTION_LIMIT, SESSION_DAYS, TRUST_PROXY, ...required } = validEnv;
  const config = loadConfig(required);
  assert.equal(config.port, 4000);
  assert.equal(config.db.ssl, false);
  assert.equal(config.db.connectionLimit, 5);
  assert.equal(config.sessionDays, 7);
  assert.equal(config.trustProxy, 0);
});

test('loadConfig lists every missing required variable', () => {
  const { DB_HOST, DB_USER, ...rest } = validEnv;
  assert.throws(
    () => loadConfig(rest),
    (err) => {
      assert.match(err.message, /Missing required/);
      assert.match(err.message, /DB_HOST/);
      assert.match(err.message, /DB_USER/);
      return true;
    }
  );
});

test('loadConfig rejects non-numeric ports and bad booleans', () => {
  assert.throws(() => loadConfig({ ...validEnv, DB_PORT: 'abc' }), /DB_PORT/);
  assert.throws(() => loadConfig({ ...validEnv, DB_SSL: 'yes' }), /DB_SSL/);
  assert.throws(() => loadConfig({ ...validEnv, DB_CONNECTION_LIMIT: '0' }), /DB_CONNECTION_LIMIT/);
});

// Production hardening (design §5.6, plan T10).
const productionEnv = {
  ...validEnv,
  NODE_ENV: 'production',
  APP_ORIGIN: 'https://bughunterssite.com',
  TRUST_PROXY: '1',
};

test('loadConfig accepts a valid production config', () => {
  const config = loadConfig(productionEnv);
  assert.equal(config.nodeEnv, 'production');
  assert.equal(config.trustProxy, 1);
  assert.equal(config.appOrigin, 'https://bughunterssite.com');
});

test('production requires TRUST_PROXY=1, a non-empty DB_PASSWORD and an https APP_ORIGIN', () => {
  const withoutTrustProxy = { ...productionEnv };
  delete withoutTrustProxy.TRUST_PROXY;
  assert.throws(() => loadConfig(withoutTrustProxy), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...productionEnv, TRUST_PROXY: '0' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...productionEnv, TRUST_PROXY: '2' }), /TRUST_PROXY/);
  assert.throws(() => loadConfig({ ...productionEnv, DB_PASSWORD: '' }), /DB_PASSWORD/);
  assert.throws(
    () => loadConfig({ ...productionEnv, APP_ORIGIN: 'http://bughunterssite.com' }),
    /APP_ORIGIN/
  );
  assert.throws(() => loadConfig({ ...productionEnv, APP_ORIGIN: 'not-a-url' }), /APP_ORIGIN/);
});

test('development keeps the relaxed settings (http origin, empty password, no proxy)', () => {
  const config = loadConfig({
    ...validEnv,
    APP_ORIGIN: 'http://localhost:4000',
    DB_PASSWORD: '',
    TRUST_PROXY: '0',
  });
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.appOrigin, 'http://localhost:4000');
  assert.equal(config.db.password, '');
  assert.equal(config.trustProxy, 0);
});

test('loadConfig rejects malformed or out-of-range ports', () => {
  const badPorts = ['4000abc', '4000.5', '0', '65536', '-1', ' 4000', '', '0x10', '4e3'];
  for (const value of badPorts) {
    assert.throws(() => loadConfig({ ...validEnv, PORT: value }), /PORT/, `PORT=${JSON.stringify(value)}`);
    assert.throws(() => loadConfig({ ...validEnv, DB_PORT: value }), /DB_PORT/, `DB_PORT=${JSON.stringify(value)}`);
  }
  const config = loadConfig({ ...validEnv, PORT: '1', DB_PORT: '65535' });
  assert.equal(config.port, 1);
  assert.equal(config.db.port, 65535);
});
