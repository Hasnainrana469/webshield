const { Client } = require('pg');

const conn = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres';

(async () => {
  const client = new Client({ connectionString: conn });
  try {
    await client.connect();
    const dbName = 'webshield';
    const res = await client.query(`SELECT 1 FROM pg_database WHERE datname=$1`, [dbName]);
    if (res.rows.length > 0) {
      console.log(`Database '${dbName}' already exists.`);
    } else {
      await client.query(`CREATE DATABASE "${dbName}"`);
      console.log(`Database '${dbName}' created.`);
    }
  } catch (err) {
    console.error('Error creating database:', err.message || err);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
