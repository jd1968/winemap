const path = require('path');
const dotenv = require('dotenv');
const { Pool } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function getDatabaseConfig(overrides = {}) {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ...overrides
    };
  }

  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || 'winemap',
    ...overrides
  };
}

const pool = new Pool({
  ...getDatabaseConfig(),
  allowExitOnIdle: true
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function closePool() {
  await pool.end();
}

module.exports = {
  pool,
  query,
  closePool,
  getDatabaseConfig
};
