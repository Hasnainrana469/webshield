/**
 * Activity log helper.
 * Writes a record to the activity_logs table for significant system events.
 * Errors are swallowed and printed to stderr so they never crash the calling operation.
 *
 * Supported event types (Requirement 20.1):
 *  - user_registration
 *  - user_login
 *  - user_logout
 *  - scan_creation
 *  - scan_start
 *  - scan_stop
 *  - scan_completion
 *  - report_generation
 *  - admin_role_change
 *  - admin_account_deactivation
 *
 * Requirements: 20.1, 20.2
 */

import db, { withId } from '../db';

// ---------------------------------------------------------------------------
// Event type definition
// ---------------------------------------------------------------------------

/**
 * All supported activity log event types.
 * Additional internal event types (e.g. 'scan_module_error') may also be passed
 * as a string for internal diagnostics.
 */
export type ActivityEventType =
  | 'user_registration'
  | 'user_login'
  | 'user_logout'
  | 'scan_creation'
  | 'scan_start'
  | 'scan_stop'
  | 'scan_completion'
  | 'report_generation'
  | 'admin_role_change'
  | 'admin_account_deactivation'
  | string; // allow internal/diagnostic types without breaking callers

// ---------------------------------------------------------------------------
// Options interface
// ---------------------------------------------------------------------------

export interface LogEventOptions {
  /**
   * Event type. One of the 10 required types from Requirement 20.1, or an
   * internal diagnostic type string.
   */
  eventType: ActivityEventType;
  /** The user who performed the action (nullable). */
  actorUserId?: string | null;
  /** The primary resource affected by this event (nullable). */
  targetResourceId?: string | null;
  /** The resource type, e.g. 'user', 'scan', 'report' (nullable). */
  targetResourceType?: string | null;
  /** Human-readable description. */
  description: string;
}

// ---------------------------------------------------------------------------
// logEvent
// ---------------------------------------------------------------------------

/**
 * Inserts an Activity_Log record into the activity_logs table.
 *
 * Fields written (Requirement 20.2):
 *  - event_type
 *  - actor_user_id
 *  - target_resource_id
 *  - target_resource_type
 *  - description
 *  - created_at (set by DB default)
 *
 * Never throws — on DB error, logs to stderr and returns.
 */
export async function logEvent(options: LogEventOptions): Promise<void> {
  try {
    await db('activity_logs').insert(withId({
      event_type: options.eventType,
      actor_user_id: options.actorUserId ?? null,
      target_resource_id: options.targetResourceId ?? null,
      target_resource_type: options.targetResourceType ?? null,
      description: options.description,
    }));
  } catch (err) {
    console.error('[activityLog] Failed to write activity log record:', err);
  }
}
