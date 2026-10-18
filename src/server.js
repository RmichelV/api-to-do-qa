import { createApp } from './app.js';
import { loadConfig } from './config/env.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config);

createApp({ config, pool }).listen(config.port, () => {
  console.log(`Server is running on http://localhost:${config.port}`);
});

function shutdown() {
  pool.end().finally(() => process.exit(0));
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
