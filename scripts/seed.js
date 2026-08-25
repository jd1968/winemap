const { query, closePool } = require('../server/db');

async function main() {
  const regionCountResult = await query('SELECT COUNT(*)::int AS count FROM regions');
  const regionCount = regionCountResult.rows[0]?.count || 0;

  if (regionCount > 0) {
    console.log(`Database-first mode: keeping existing PostgreSQL content (${regionCount} regions found).`);
    return;
  }

  console.log('Database-first mode: no JSON seed source is configured. Populate PostgreSQL directly.');
}

main()
  .catch((error) => {
    console.error('Could not run database-first seed step', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
