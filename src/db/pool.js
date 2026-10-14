import mysql from 'mysql2/promise';
import { loadConfig } from '../config/env.js';

// MySQL session strict mode (design §4). Applied to every pooled connection.
const STRICT_SQL_MODE =
  "STRICT_ALL_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO";

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

  // Strict mode and UTC are per-connection in MySQL, so set them on each new one.
  pool.on('connection', (connection) => {
    connection.query(`SET SESSION sql_mode = '${STRICT_SQL_MODE}'`);
    connection.query("SET SESSION time_zone = '+00:00'");
  });

  return pool;
}
