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

  return Object.freeze({
    nodeEnv: env.NODE_ENV,
    port: parseInt10(env.PORT ?? OPTIONAL.PORT, 'PORT'),
    appOrigin: env.APP_ORIGIN,
    db: Object.freeze({
      host: env.DB_HOST,
      port: parseInt10(env.DB_PORT, 'DB_PORT'),
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      ssl: parseBool(env.DB_SSL ?? OPTIONAL.DB_SSL, 'DB_SSL'),
      connectionLimit: parseInt10(env.DB_CONNECTION_LIMIT ?? OPTIONAL.DB_CONNECTION_LIMIT, 'DB_CONNECTION_LIMIT'),
    }),
    sessionDays: parseInt10(env.SESSION_DAYS ?? OPTIONAL.SESSION_DAYS, 'SESSION_DAYS'),
    trustProxy: parseNonNegativeInt10(env.TRUST_PROXY ?? OPTIONAL.TRUST_PROXY, 'TRUST_PROXY'),
  });
}
