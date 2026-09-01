import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('activity_logs', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('actor_user_id', 'CHAR(36)').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.specificType('target_resource_id', 'CHAR(36)').nullable();
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('actor_user_id').nullable().references('id').inTable('users').onDelete('SET NULL');
      table.uuid('target_resource_id').nullable();
    }
    table.string('event_type', 60).notNullable();
    table.string('target_resource_type', 60).nullable();
    table.text('description').notNullable();
    table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX idx_actlog_actor   ON activity_logs(actor_user_id)');
  await knex.raw('CREATE INDEX idx_actlog_created ON activity_logs(created_at)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('activity_logs');
}
