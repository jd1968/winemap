const path = require('path');
const dotenv = require('dotenv');
const { Client } = require('pg');

dotenv.config({ path: path.resolve(__dirname, '../.env'), quiet: true });

function getTargetDatabaseName() {
  if (process.env.PGDATABASE) {
    return process.env.PGDATABASE;
  }

  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    return databaseUrl.pathname.replace(/^\//, '') || 'winemap';
  }

  return 'winemap';
}

function getAdminConnectionConfig() {
  if (process.env.DATABASE_URL) {
    const databaseUrl = new URL(process.env.DATABASE_URL);
    databaseUrl.pathname = `/${process.env.PGADMIN_DATABASE || 'postgres'}`;

    return {
      connectionString: databaseUrl.toString()
    };
  }

  return {
    host: process.env.PGHOST || '127.0.0.1',
    port: Number(process.env.PGPORT || 5433),
    user: process.env.PGUSER || process.env.USER,
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGADMIN_DATABASE || 'postgres'
  };
}

async function main() {
  const adminClient = new Client(getAdminConnectionConfig());
  const databaseName = getTargetDatabaseName();

  await adminClient.connect();

  const existingDatabase = await adminClient.query(
    'SELECT 1 FROM pg_database WHERE datname = $1',
    [databaseName]
  );

  if (existingDatabase.rowCount === 0) {
    await adminClient.query(`CREATE DATABASE "${databaseName}"`);
    console.log(`Created database ${databaseName}`);
  } else {
    console.log(`Database ${databaseName} already exists`);
  }

  await adminClient.end();
}

main().catch((error) => {
  console.error('Could not create database', error);
  process.exit(1);
});
