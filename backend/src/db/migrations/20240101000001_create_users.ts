import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';

  await knex.schema.createTable('users', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    }
    table.string('display_name', 100).notNullable();
    table.string('email', 255).notNullable().unique();
    table.string('password_hash', 255).notNullable();
    table.string('role', 10).notNullable().defaultTo('user');
    table.boolean('is_active').notNullable().defaultTo(true);
    table.boolean('email_notif_enabled').notNullable().defaultTo(true);
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('users');
}
