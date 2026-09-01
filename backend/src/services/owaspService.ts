/**
 * owaspService — OWASP category completeness utilities.
 *
 * Functions:
 *  - ensureOwaspCategoryCompleteness: assigns 'Unclassified' to any
 *    vulnerability with a null or empty owasp_category for the given scan.
 *  - getOwaspCategorySummary: returns a count of vulnerabilities grouped
 *    by owasp_category for the given scan.
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4
 */

import { Knex } from 'knex';

// ---------------------------------------------------------------------------
// ensureOwaspCategoryCompleteness (Requirements 14.1, 14.3)
// ---------------------------------------------------------------------------

/**
 * Queries all vulnerabilities for the given scan that have a NULL or empty
 * owasp_category value, and updates those records to 'Unclassified'.
 *
 * Called by scanOrchestrator immediately before the final status update.
 */
export async function ensureOwaspCategoryCompleteness(
  scanId: string,
  db: Knex,
): Promise<void> {
  await db('vulnerabilities')
    .where({ scan_id: scanId })
    .where(function () {
      this.whereNull('owasp_category').orWhere('owasp_category', '');
    })
    .update({ owasp_category: 'Unclassified' });
}

// ---------------------------------------------------------------------------
// getOwaspCategorySummary (Requirement 14.4)
// ---------------------------------------------------------------------------

/**
 * Returns a record mapping each owasp_category to its vulnerability count
 * for the given scan.
 *
 * Example: { 'A05:2021 – Security Misconfiguration': 3, 'Unclassified': 1 }
 */
export async function getOwaspCategorySummary(
  scanId: string,
  db: Knex,
): Promise<Record<string, number>> {
  const rows = await db('vulnerabilities')
    .where({ scan_id: scanId })
    .select('owasp_category')
    .count('* as count')
    .groupBy('owasp_category');

  const summary: Record<string, number> = {};

  for (const row of rows as Array<{ owasp_category: string; count: string | number }>) {
    const category = row.owasp_category ?? 'Unclassified';
    summary[category] = Number(row.count);
  }

  return summary;
}
