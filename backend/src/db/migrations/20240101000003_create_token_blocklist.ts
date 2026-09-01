import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('token_blocklist', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('user_id', 'CHAR(36)').notNullable().references('id').inTable('users').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    }
    table.string('token_jti', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.schema.table('token_blocklist', () => {}); // noop — indexes below
  await knex.raw('CREATE INDEX idx_blocklist_exp ON token_blocklist(expires_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('token_blocklist');
}
