import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('password_reset_tokens', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('user_id', 'CHAR(36)').notNullable().references('id').inTable('users').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    }
    table.string('token_hash', 255).notNullable().unique();
    table.timestamp('expires_at').notNullable();
    table.timestamp('used_at').nullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('password_reset_tokens');
}
