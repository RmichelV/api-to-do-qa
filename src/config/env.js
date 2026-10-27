import fs from 'node:fs';
import path from 'node:path';

// Load local .env (git-ignored) when the file exists. Production uses the
// hosting panel's variables instead, so this is a no-op there.
const envPath = path.resolve(process.cwd(), '.env');
if (fs.existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

const REQUIRED = [
  'NODE_ENV',
  'APP_ORIGIN',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

const OPTIONAL = {
  PORT: '4000',
  DB_SSL: 'false',
  DB_CONNECTION_LIMIT: '5',
  SESSION_DAYS: '7',
  TRUST_PROXY: '0',
};

function parseBool(value, name) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`[config] ${name} must be "true" or "false", got "${value}"`);
}

function parseInt10(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`[config] ${name} must be a positive integer, got "${value}"`);
  }
  return parsed;
}

// Ports are different from any other integer: "4000abc", "4000.5" or "70000"
// must never reach listen()/createPool() (design §8, plan T10).
function parsePort(value, name) {
  const text = typeof value === 'number' ? String(value) : value;
  if (typeof text !== 'string' || !/^\d+$/.test(text)) {
    throw new Error(`[config] ${name} must be an integer between 1 and 65535, got "${value}"`);
  }
  const parsed = Number.parseInt(text, 10);
  if (parsed < 1 || parsed > 65535) {
    throw new Error(`[config] ${name} must be an integer between 1 and 65535, got "${value}"`);
  }
  return parsed;
}

// Production hardening (design §5.6, plan T10). Behind Caddy the app must
// trust the proxy, otherwise req.ip is the proxy and X-Forwarded-Proto is
// ignored: the rate limit would count every client as one and the HTTPS
// redirect would loop. DB_PASSWORD must not be blank and APP_ORIGIN must
// already be https, because the session cookie is Secure in production.
function assertProductionConfig(env, trustProxy) {
  const problems = [];
  if (trustProxy !== 1) {
    problems.push(
      `TRUST_PROXY must be 1 (Caddy is the reverse proxy), got "${env.TRUST_PROXY ?? OPTIONAL.TRUST_PROXY}"`
    );
  }
  if (!env.DB_PASSWORD) {
    problems.push('DB_PASSWORD must not be empty');
  }
  let originIsHttps = false;
  try {
    originIsHttps = new URL(env.APP_ORIGIN).protocol === 'https:';
  } catch {
    originIsHttps = false;
  }
  if (!originIsHttps) {
    problems.push(`APP_ORIGIN must be an https:// URL, got "${env.APP_ORIGIN}"`);
  }
  if (problems.length > 0) {
    throw new Error(`[config] Invalid production configuration: ${problems.join('; ')}.`);
  }
}

function parseNonNegativeInt10(value, name) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`[config] ${name} must be a non-negative integer, got "${value}"`);
  }
  return parsed;
}

export function loadConfig(env = process.env) {
  const missing = REQUIRED.filter((key) => env[key] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env (local) or set them in the hosting panel (production).'
    );
  }

  const port = parsePort(env.PORT ?? OPTIONAL.PORT, 'PORT');
  const dbPort = parsePort(env.DB_PORT, 'DB_PORT');
  const trustProxy = parseNonNegativeInt10(env.TRUST_PROXY ?? OPTIONAL.TRUST_PROXY, 'TRUST_PROXY');
  if (env.NODE_ENV === 'production') {
    assertProductionConfig(env, trustProxy);
  }

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    port,
    appOrigin: env.APP_ORIGIN,
    db: Object.freeze({
      host: env.DB_HOST,
      port: dbPort,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: parseBool(env.DB_SSL ?? OPTIONAL.DB_SSL, 'DB_SSL'),
      connectionLimit: parseInt10(env.DB_CONNECTION_LIMIT ?? OPTIONAL.DB_CONNECTION_LIMIT, 'DB_CONNECTION_LIMIT'),
    }),
    sessionDays: parseInt10(env.SESSION_DAYS ?? OPTIONAL.SESSION_DAYS, 'SESSION_DAYS'),
    trustProxy,
  });
}
