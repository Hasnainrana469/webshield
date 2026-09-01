import Knex from 'knex';
import * as dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const environment = process.env.NODE_ENV || 'development';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const knexConfig = require('../../knexfile.js');
const config = knexConfig.default ? knexConfig.default[environment] : knexConfig[environment];

/**
 * Knex query builder instance.
 *
 * SECURITY NOTE: Knex uses parameterized bindings for all query builder
 * methods by default (Requirement 21.6).
 *
 * UUID NOTE: MySQL/MariaDB does not have gen_random_uuid(). All service
 * insert calls should include an `id` field. Use the `withId()` helper:
 *   db(table).insert(withId({ ... }))
 */
const db = Knex(config);

export const isMysql =
  config?.client === 'mysql2' || config?.client === 'mysql';

/**
 * Wraps an insert payload to include a generated UUID `id` if MySQL is the
 * database client and the payload does not already have an `id`.
 */
export function withId<T extends Record<string, unknown>>(
  payload: T,
): T & { id: string } {
  if (isMysql && !payload['id']) {
    return { ...payload, id: uuidv4() } as T & { id: string };
  }
  return payload as T & { id: string };
}

/**
 * Wraps an array of insert payloads to include generated UUID `id` fields.
 */
export function withIds<T extends Record<string, unknown>>(
  payloads: T[],
): (T & { id: string })[] {
  return payloads.map(withId);
}

export { uuidv4 };
export default db;
export { db };
