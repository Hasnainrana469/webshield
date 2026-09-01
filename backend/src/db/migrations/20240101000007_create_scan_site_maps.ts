import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('scan_site_maps', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('scan_id', 'CHAR(36)').notNullable().unique().references('id').inTable('scans').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('scan_id').notNullable().unique().references('id').inTable('scans').onDelete('CASCADE');
    }
    if (isMysql) {
      table.specificType('urls', 'JSON').notNullable().defaultTo('[]');
      table.specificType('forms', 'JSON').notNullable().defaultTo('[]');
    } else {
      table.jsonb('urls').notNullable().defaultTo('[]');
      table.jsonb('forms').notNullable().defaultTo('[]');
    }
    table.integer('url_count').notNullable().defaultTo(0);
    table.boolean('was_capped').notNullable().defaultTo(false);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('scan_site_maps');
}
