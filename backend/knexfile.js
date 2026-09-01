require('dotenv').config();

function getDbClient(url) {
  if (!url) return 'mysql2';
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) return 'mysql2';
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) return 'pg';
  return 'mysql2';
}

function parseMysqlUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname || 'localhost',
      port: Number(parsed.port || 3306),
      database: (parsed.pathname || '/webshield').replace(/^\//, ''),
      user: decodeURIComponent(parsed.username || 'root'),
      password: decodeURIComponent(parsed.password || ''),
    };
  } catch {
    return { host: 'localhost', port: 3306, database: 'webshield', user: 'root', password: '' };
  }
}

const dbUrl = process.env.DATABASE_URL;
const dbClient = getDbClient(dbUrl);
const connection = !dbUrl || dbClient === 'mysql2' ? parseMysqlUrl(dbUrl || 'mysql://root:@localhost:3306/webshield') : dbUrl;

module.exports = {
  development: {
    client: dbClient,
    connection,
    migrations: { tableName: 'knex_migrations', directory: './src/db/migrations', extension: 'ts' },
    pool: { min: 2, max: 10 },
  },
  test: {
    client: 'sqlite3',
    connection: ':memory:',
    useNullAsDefault: true,
    migrations: { tableName: 'knex_migrations', directory: './src/db/migrations', extension: 'ts' },
    pool: { min: 1, max: 5 },
  },
  production: {
    client: dbClient,
    connection,
    migrations: { tableName: 'knex_migrations', directory: './dist/db/migrations' },
    pool: { min: 2, max: 10 },
  },
};