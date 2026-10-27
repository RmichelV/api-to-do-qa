import mysql from 'mysql2/promise';
import { loadConfig } from '../config/env.js';

// MySQL session strict mode (design §4). Applied to every pooled connection.
const STRICT_SQL_MODE =
  "STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";

/**
 * Applies the per-connection session settings (design §4): strict sql_mode
 * and UTC, both session-scoped in MySQL so they must run on every new
 * connection.
 *
 * Both SETs are enqueued together (Promise.all) before either resolves, so
 * no query from a borrower can slip into the queue between them: the pool
 * hands the connection out without awaiting this promise (plan T10, L35).
 * If either SET fails the connection is destroyed instead of being handed
 * out — a pooled connection that skips them would run without strict mode or
 * in another time zone and silently break the guarantees the repositories
 * rely on. Never rejects — the pool only needs to know the connection is
 * unusable.
 */
export function applySessionSettings(connection) {
  const promise = connection.promise();
  return Promise.all([
    promise.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`),
    promise.query("SET SESSION time_zone = '+00:00'"),
  ]).catch(() => {
    connection.destroy();
  });
}

/**
 * Creates the single application pool.
 * UTC ('Z'), strict mode, and multipleStatements disabled on purpose.
 */
export function createPool(config = loadConfig()) {
  const { db } = config;
  const pool = mysql.createPool({
    host: db.host,
    port: db.port,
    user: db.user,
    password: db.password,
    database: db.name,
    connectionLimit: db.connectionLimit,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: false,
    ssl: db.ssl ? {} : undefined,
  });

  pool.on('connection', applySessionSettings);

  return pool;
}
