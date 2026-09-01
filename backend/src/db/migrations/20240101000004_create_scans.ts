import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('scans', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('user_id', 'CHAR(36)').notNullable().references('id').inTable('users').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    }
    table.text('target_url').notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    // JSON (MySQL) / JSONB (PostgreSQL) — Knex normalises this
    if (isMysql) {
      table.specificType('selected_modules', 'JSON').notNullable();
    } else {
      table.jsonb('selected_modules').notNullable();
    }
    table.smallint('progress_pct').notNullable().defaultTo(0);
    table.timestamp('started_at').nullable();
    table.timestamp('completed_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX idx_scans_user_id ON scans(user_id)');
  await knex.raw('CREATE INDEX idx_scans_status  ON scans(status)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scans');
}
