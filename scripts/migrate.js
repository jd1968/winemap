const fs = require('fs');
const path = require('path');
const { query, closePool } = require('../server/db');

async function main() {
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  await query(schemaSql);
  console.log('Database schema is up to date');
}

main()
  .catch((error) => {
    console.error('Could not run migrations', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
