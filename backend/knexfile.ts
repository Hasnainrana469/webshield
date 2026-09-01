import type { Knex } from 'knex';
import * as dotenv from 'dotenv';

dotenv.config();

// Detect database client from DATABASE_URL
function getDbClient(url?: string): string {
  if (!url) return 'mysql2';
  if (url.startsWith('mysql://') || url.startsWith('mysql2://')) return 'mysql2';
  if (url.startsWith('postgresql://') || url.startsWith('postgres://')) return 'pg';
  return 'mysql2';
}

const dbUrl = process.env.DATABASE_URL;
const dbClient = getDbClient(dbUrl);

// Parse mysql:// URL into connection object (Knex mysql2 client doesn't parse URLs natively)
function parseMysqlUrl(url: string) {
  try {
    const u = new URL(url);
    return {
      host: u.hostname || 'localhost',
      port: parseInt(u.port || '3306', 10),
      database: (u.pathname || '/webshield').replace(/^\//, ''),
      user: decodeURIComponent(u.username || 'root'),
      password: decodeURIComponent(u.password || ''),
    };
  } catch {
    return { host: 'localhost', port: 3306, database: 'webshield', user: 'root', password: '' };
  }
}

function getConnection(url?: string) {
  if (!url) return parseMysqlUrl('mysql://root:@localhost:3306/webshield');
  if (dbClient === 'mysql2') return parseMysqlUrl(url);
  return url; // pg accepts connection strings directly
}

const config: { [key: string]: Knex.Config } = {
  development: {
    client: dbClient,
    connection: getConnection(dbUrl),
    migrations: {
      tableName: 'knex_migrations',
      directory: './src/db/migrations',
      extension: 'ts',
    },
    seeds: {
      directory: './src/db/seeds',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },

  test: {
    client: 'sqlite3',
    connection: ':memory:',
    useNullAsDefault: true,
    migrations: {
      tableName: 'knex_migrations',
      directory: './src/db/migrations',
      extension: 'ts',
    },
    pool: {
      min: 1,
      max: 5,
    },
  },

  production: {
    client: getDbClient(process.env.DATABASE_URL),
    connection: getConnection(process.env.DATABASE_URL),
    migrations: {
      tableName: 'knex_migrations',
      directory: './dist/db/migrations',
    },
    pool: {
      min: 2,
      max: 10,
    },
  },
};

export default config;
