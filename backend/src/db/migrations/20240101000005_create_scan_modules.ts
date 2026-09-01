import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('scan_modules', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('scan_id', 'CHAR(36)').notNullable().references('id').inTable('scans').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('scan_id').notNullable().references('id').inTable('scans').onDelete('CASCADE');
    }
    table.string('module_name', 100).notNullable();
    table.string('status', 20).notNullable().defaultTo('pending');
    table.timestamp('started_at').nullable();
    table.timestamp('completed_at').nullable();
    table.text('error_message').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scan_modules');
}
