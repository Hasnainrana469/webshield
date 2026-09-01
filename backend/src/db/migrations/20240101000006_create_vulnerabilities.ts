import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  const isMysql = knex.client.config.client === 'mysql2' || knex.client.config.client === 'mysql';
  await knex.schema.createTable('vulnerabilities', (table) => {
    if (isMysql) {
      table.specificType('id', 'CHAR(36)').primary().notNullable();
      table.specificType('scan_id', 'CHAR(36)').notNullable().references('id').inTable('scans').onDelete('CASCADE');
    } else {
      table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
      table.uuid('scan_id').notNullable().references('id').inTable('scans').onDelete('CASCADE');
    }
    table.string('name', 255).notNullable();
    table.text('description').nullable();
    table.string('risk_level', 15).notNullable();
    table.string('owasp_category', 60).notNullable().defaultTo('Unclassified');
    table.text('affected_url').nullable();
    table.string('affected_param', 255).nullable();
    table.text('poc_payload').nullable();
    table.text('screenshot_path').nullable();
    table.decimal('ai_score', 4, 2).nullable();
    table.text('ai_description').nullable();
    table.text('ai_remediation').nullable();
    table.timestamp('discovered_at').notNullable().defaultTo(knex.fn.now());
  });
  await knex.raw('CREATE INDEX idx_vuln_scan_id    ON vulnerabilities(scan_id)');
  await knex.raw('CREATE INDEX idx_vuln_risk_level ON vulnerabilities(risk_level)');
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('vulnerabilities');
}
