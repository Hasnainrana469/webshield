# Implementation Plan: WebShield

## Overview

WebShield is implemented as a full-stack TypeScript monorepo with a Node.js/Express backend and a React/Vite frontend. The plan follows the module execution order defined in the design: infrastructure first, then Auth, then Scanner_Engine and its modules, then AI/Report/Notification services, then the React frontend, and finally Docker and deployment configuration.

All backend code is TypeScript (Node.js 20 + Express 4 + Knex.js + PostgreSQL 15). All frontend code is TypeScript (React 18 + Vite + Tailwind CSS + shadcn/ui + TanStack Query + React Router v6 + Recharts). Property-based tests use `fast-check` inside Jest. Each property test is annotated with its property number from the design document.

---

## Tasks

- [x] 1. Project scaffold and shared infrastructure
  - Initialize monorepo directory structure: `backend/`, `frontend/`, `docker/`
  - Set up `backend/` as a TypeScript Node.js project: `tsconfig.json`, `package.json`, Jest config with `testEnvironment: node` and `testTimeout: 30000`
  - Install backend core dependencies: `express`, `knex`, `pg`, `jsonwebtoken`, `bcrypt`, `helmet`, `express-rate-limit`, `nodemailer`, `fast-check`, `supertest`, `@types/*`
  - Set up `frontend/` as a Vite + React 18 + TypeScript project; install `tailwindcss`, `shadcn/ui`, `@tanstack/react-query`, `react-router-dom`, `recharts`
  - Create `.env.example` with all required environment variables: `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRY`, `ZAP_API_URL`, `ZAP_API_KEY`, `OPENAI_API_KEY`, `SMTP_*`, `FRONTEND_URL`, `VITE_API_BASE_URL`
  - _Requirements: 24.5_

- [x] 2. Database schema migrations
  - [x] 2.1 Create Knex migration files for all tables
    - Write migrations for `users`, `password_reset_tokens`, `token_blocklist`, `scans`, `scan_modules`, `vulnerabilities`, `scan_site_maps`, `reports`, `activity_logs`
    - Include all constraints, indexes, and CHECK clauses from the design schema
    - _Requirements: 1.1, 4.1, 14.1, 20.2_
  - [ ]* 2.2 Write unit tests for migration rollback idempotency
    - Verify `migrate.latest()` then `migrate.rollback()` then `migrate.latest()` leaves schema intact
    - _Requirements: 24.3_

- [x] 3. Auth_Service — core authentication
  - [x] 3.1 Implement user registration endpoint `POST /api/v1/auth/register`
    - Validate display name (2–100 chars), email (RFC 5322), password (8–128 chars, upper, lower, digit, special char)
    - Hash password with bcrypt (cost factor ≥ 12) before INSERT
    - Return 201 `{ user_id, display_name, email, role }` on success
    - Return 409 on duplicate email, 422 on validation failure
    - Write Activity_Log record for `user_registration`
    - _Requirements: 1.1, 1.2, 1.5, 20.1_
  - [ ]* 3.2 Write property test — password hash strength (Property 1)
    - **Property 1: Password hash strength**
    - **Validates: Requirements 1.5**
    - For any valid registration input, assert stored hash is a bcrypt hash with cost ≥ 12
  - [ ]* 3.3 Write property test — duplicate email rejection (Property 2)
    - **Property 2: Registration uniqueness — duplicate email rejection**
    - **Validates: Requirements 1.2**
    - For any email already registered, assert re-registration returns HTTP 409
  - [x] 3.4 Implement user login endpoint `POST /api/v1/auth/login`
    - Validate credentials; compare password with bcrypt
    - Issue JWT (HS256, 24-hour expiry, include `jti`, `user_id`, `role` claims)
    - Return 401 (no field discrimination) on invalid credentials
    - Write Activity_Log record for `user_login`
    - _Requirements: 1.3, 1.4, 20.1_
  - [x] 3.5 Implement logout endpoint `POST /api/v1/auth/logout`
    - Insert token's `jti` and `expires_at` into `token_blocklist`
    - Return 204
    - Write Activity_Log record for `user_logout`
    - _Requirements: 1.9, 1.10, 20.1_
  - [ ]* 3.6 Write property test — JWT post-logout invalidation (Property 3)
    - **Property 3: JWT post-logout invalidation (round-trip)**
    - **Validates: Requirements 1.9, 1.10**
    - For any authenticated user, assert any protected endpoint returns 401 after logout with same JWT
  - [x] 3.7 Implement password reset flow
    - `POST /api/v1/auth/forgot-password`: generate HMAC token (1-hour expiry), store hash in `password_reset_tokens`, send email; return 200 or 404
    - `POST /api/v1/auth/reset-password`: verify token, validate new password, update hash, mark token `used_at`; return 400 on expired/used token
    - _Requirements: 1.6, 1.7, 1.8_

- [ ] 4. Auth_Service — JWT middleware and RBAC
  - [x] 4.1 Implement JWT verification middleware
    - Check `Authorization: Bearer <token>` header; verify signature, expiry, and token_blocklist
    - Return 401 for absent, malformed, expired, invalid-signature, or blocklisted tokens
    - _Requirements: 2.4_
  - [ ]* 4.2 Write property test — token rejection for all invalid variants (Property 5)
    - **Property 5: Token rejection for all invalid token variants**
    - **Validates: Requirements 2.4**
    - Generate arbitrary tokens that are absent, malformed, expired, or have invalid signatures; assert all return 401
  - [x] 4.3 Implement role-guard middleware
    - Permit "user" tokens access to user-role endpoints only
    - Permit "admin" tokens access to both user and admin endpoints
    - Return 403 for valid tokens with insufficient role or unrecognized role values
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 2.6_
  - [ ]* 4.4 Write property test — role access control correctness (Property 4)
    - **Property 4: Role access control correctness**
    - **Validates: Requirements 2.2, 2.3, 2.5**
    - For any (user, endpoint) pair, assert "user" tokens are denied admin endpoints (403) and "admin" tokens are permitted both
  - [x] 4.5 Wire middleware chain onto all protected routes
    - Order: `Helmet.js → Rate_Limiter → JWT_Verify → Role_Guard → Route Handler`
    - _Requirements: 21.1, 21.2, 21.3_

- [x] 5. Checkpoint — Auth core complete
  - Ensure all auth tests pass, ask the user if questions arise.

- [x] 6. Auth_Service — profile management
  - [x] 6.1 Implement profile endpoints
    - `GET /api/v1/users/me` — return authenticated user profile
    - `PUT /api/v1/users/me` — update display name (2–100 chars) and/or email (RFC 5322); return 200, 409 on duplicate email, 422 on invalid format
    - `PUT /api/v1/users/me/password` — verify current password, validate new password against policy, update hash; return 400 on wrong current password, 422 on invalid new password
    - `PUT /api/v1/users/me/settings` — toggle `email_notif_enabled`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
  - [ ]* 6.2 Write property test — profile update field validation (Property 6)
    - **Property 6: Profile update field validation**
    - **Validates: Requirements 3.3**
    - For any update request with invalid RFC 5322 email or display name outside [2, 100] chars, assert HTTP 422

- [x] 7. API security middleware
  - [x] 7.1 Configure Helmet.js middleware on all routes
    - Apply `helmet()` to the Express app; verify security headers are present
    - _Requirements: 21.1_
  - [x] 7.2 Implement rate limiting middleware
    - Unauthenticated requests: max 20 per minute per IP (return 429 + `Retry-After` header on breach)
    - Authenticated requests: max 100 per minute per user account
    - _Requirements: 21.2, 21.3, 21.4_
  - [ ]* 7.3 Write property test — unauthenticated rate limiter cap (Property 24)
    - **Property 24: Rate limiter — unauthenticated request cap**
    - **Validates: Requirements 21.2, 21.4**
    - For any IP, assert the 21st request within a 60-second window returns 429 with `Retry-After`
  - [x] 7.4 Implement input sanitization and parameterized queries
    - Add server-side input sanitization middleware for all user-supplied strings
    - Confirm all Knex queries use parameterized bindings (no raw string interpolation)
    - _Requirements: 21.5, 21.6_

- [x] 8. Scanner_Engine — scan lifecycle
  - [x] 8.1 Implement scan CRUD endpoints
    - `POST /api/v1/scans` — validate target URL (HTTP/HTTPS, public host, no RFC 1918/loopback, non-empty modules), INSERT scan with status "pending", return 201 + scan_id
    - `GET /api/v1/scans` — paginated list of caller's scans
    - `GET /api/v1/scans/:id` — scan detail with module statuses and progress
    - `DELETE /api/v1/scans/:id` — delete stopped/completed scan
    - Write Activity_Log record for `scan_creation`
    - _Requirements: 4.1, 4.2, 20.1_
  - [ ]* 8.2 Write property test — scan creation valid input yields pending (Property 7)
    - **Property 7: Scan creation with valid input yields "pending" scan**
    - **Validates: Requirements 4.1**
    - For any valid URL + non-empty module list, assert response is 201 and scan status is "pending"
  - [ ]* 8.3 Write property test — scan creation rejects invalid inputs (Property 8)
    - **Property 8: Scan creation validation rejects all invalid inputs**
    - **Validates: Requirements 4.2**
    - For malformed URLs, non-HTTP/HTTPS schemes, private/loopback IPs, or empty module lists, assert HTTP 422
  - [x] 8.4 Implement scan state machine transitions
    - `POST /api/v1/scans/:id/start` — transition "pending" → "running"; return 409 if not "pending"; enforce max 3 concurrent running scans per user (return 429)
    - `POST /api/v1/scans/:id/stop` — transition "running" → "stopped"; return 409 if not "running"
    - On all modules complete: transition → "completed"; if all modules failed: → "failed"
    - Write Activity_Log records for `scan_start`, `scan_stop`, `scan_completion`
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.12, 20.1_
  - [ ]* 8.5 Write property test — concurrent scan limit enforcement (Property 9)
    - **Property 9: Concurrent scan limit enforcement**
    - **Validates: Requirements 4.10, 4.11**
    - For any user with 3 running scans, assert additional start request returns HTTP 429
  - [x] 8.6 Implement progress tracking and module error isolation
    - Use `setInterval` to update `progress_pct` in DB every 10 seconds while scan is running
    - Wrap each module execution in `Promise.race` with per-module timeout; on error/timeout set module status "failed"/"timed_out", persist error message to `scan_modules`, write Activity_Log entry, continue to next module
    - _Requirements: 4.8, 4.9_

- [x] 9. Scan Module — HttpHeaderModule
  - [x] 9.1 Implement HttpHeaderModule
    - Fetch target URL with `node-fetch` and evaluate: Content-Security-Policy, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security, Referrer-Policy, Permissions-Policy
    - Create Vulnerability records per the risk table in the design (absent CSP → Medium, absent Referrer-Policy → Low, etc.)
    - Map all findings to OWASP `A05:2021 – Security Misconfiguration`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 9.2 Write property test — HTTP header analysis risk levels (Property 10)
    - **Property 10: HTTP header analysis produces correct risk levels**
    - **Validates: Requirements 5.4**
    - For any header set, assert absent/misconfigured CSP → Risk_Level "medium" and absent/misconfigured Referrer-Policy → Risk_Level "low"

- [x] 10. Scan Module — SslTlsModule
  - [x] 10.1 Implement SslTlsModule
    - Use Node.js `tls` module to connect and inspect certificates
    - Check: HTTPS accessibility (no redirect → High), certificate expiry (expired → High, within 30 days → Medium), TLS version (1.0 or 1.1 → Medium)
    - Map all findings to OWASP `A02:2021 – Cryptographic Failures`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_
  - [ ]* 10.2 Write property test — SSL/TLS certificate expiry risk classification (Property 11)
    - **Property 11: SSL/TLS analysis — certificate expiry risk classification**
    - **Validates: Requirements 6.4, 6.5**
    - For any TLS certificate, assert expired cert → Risk_Level "high" and cert expiring within 30 days → Risk_Level "medium"

- [x] 11. Scan Module — PortScanModule
  - [x] 11.1 Implement PortScanModule
    - Spawn `nmap -sV --open -T4 -oX - <host>` as child process with 300-second timeout
    - Parse XML output using `fast-xml-parser`
    - Persist each open port as a finding; assign Risk_Level "High" for known high-risk ports (FTP/21, Telnet/23, MySQL/3306, PostgreSQL/5432, MongoDB/27017), Risk_Level "Low" for all others
    - Map findings to OWASP `A05:2021 – Security Misconfiguration`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_
  - [ ]* 11.2 Write property test — port risk classification (Property 12)
    - **Property 12: Port risk classification**
    - **Validates: Requirements 7.3**
    - For any Nmap result, assert known high-risk ports → Risk_Level "high" and all others → Risk_Level "low"

- [x] 12. Scan Module — CrawlerModule
  - [x] 12.1 Implement CrawlerModule
    - Use Puppeteer in headless mode to crawl target up to depth 5, capped at 500 URLs
    - Discover and record: all reachable internal URLs, form action URLs, methods, and input field names
    - Persist discovered site map as structured JSON in `scan_site_maps` table
    - If URL cap reached, stop crawling, persist discovered URLs, write warning to Activity_Log
    - Attach resulting `SiteMap` to `ScanContext` for downstream modules
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_
  - [ ]* 12.2 Write unit tests for CrawlerModule URL cap and form discovery
    - Mock Puppeteer; test that crawl stops at 500 URLs and warning is logged
    - Test that form fields (action, method, names) are correctly captured
    - _Requirements: 8.2, 8.4, 8.5_

- [x] 13. Scan Module — SqlInjectionModule
  - [x] 13.1 Implement SqlInjectionModule
    - OWASP ZAP Active Scan: call ZAP REST API `/JSON/ascan/action/scan/` against discovered URLs
    - Custom payload set: inject error-based and time-based payloads into every form parameter and query string parameter; measure response time against baseline; delays ≥ 5 seconds → Critical vulnerability
    - Create Vulnerability records with Risk_Level "Critical" including triggering parameter name and payload
    - Map all findings to OWASP `A03:2021 – Injection`
    - _Requirements: 9.1, 9.2, 9.3, 9.4_
  - [ ]* 13.2 Write property test — SQL injection time-based detection threshold (Property 13)
    - **Property 13: SQL injection time-based detection threshold**
    - **Validates: Requirements 9.3**
    - For any parameter where a time-based payload causes ≥ 5-second delay above baseline, assert Vulnerability is created with Risk_Level "critical"

- [x] 14. Scan Module — XssModule
  - [x] 14.1 Implement XssModule
    - Reflected XSS: inject `<script>alert('xss')</script>` and variants into all parameters; scan response body for unencoded payload with regex; create Vulnerability records with Risk_Level "High" + PoC URL
    - DOM XSS: use Puppeteer to inject payloads into URL fragments and JS-sink parameters; listen for `window.alert` via `page.on('dialog')`; create Vulnerability records with Risk_Level "High" + PoC payload
    - Map all findings to OWASP `A03:2021 – Injection`
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
  - [ ]* 14.2 Write property test — Reflected XSS detection payload round-trip (Property 14)
    - **Property 14: Reflected XSS detection — payload round-trip**
    - **Validates: Requirements 10.1, 10.2**
    - For any response body containing an injected XSS payload in unencoded form, assert Vulnerability is created with Risk_Level "high" including triggering payload

- [x] 15. Scan Module — DirectoryDiscoveryModule
  - [x] 15.1 Implement DirectoryDiscoveryModule
    - Probe predefined path list using `node-fetch` HEAD requests: /admin, /wp-admin, /.env, /.git/config, /backup, /config, /robots.txt, /sitemap.xml, .bak/.old/.sql extensions
    - Sensitive file (`.env`, `.git/config`, `*.sql`, `*.bak`, `*.old`) + HTTP 200 → Risk_Level "Critical"
    - Any path returning HTTP 200 or 403 → Risk_Level "Low"
    - Map all findings to OWASP `A05:2021 – Security Misconfiguration`
    - _Requirements: 11.1, 11.2, 11.3, 11.4_
  - [ ]* 15.2 Write property test — directory discovery risk classification (Property 15)
    - **Property 15: Directory discovery risk classification**
    - **Validates: Requirements 11.2, 11.3**
    - For any probe result, assert sensitive file path + HTTP 200 → "critical", any other path + 200/403 → "low"

- [x] 16. Scan Module — SensitiveInfoModule
  - [x] 16.1 Implement SensitiveInfoModule
    - Iterate all crawled URLs, fetch response bodies and headers, apply regex patterns: API key/credential patterns → Critical (A02), stack traces/debug info → Medium (A05), internal IPs/emails → Low (A05)
    - Store pattern type only in Vulnerability record — never the matched key value
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5_
  - [ ]* 16.2 Write property test — sensitive info no key values stored (Property 16)
    - **Property 16: Sensitive information exposure — no key values stored**
    - **Validates: Requirements 12.2**
    - For any response body containing API key pattern match, assert Vulnerability record contains pattern type but NOT the matched value

- [x] 17. Scan Module — CookieSecurityModule
  - [x] 17.1 Implement CookieSecurityModule
    - Fetch target with `node-fetch`, parse `Set-Cookie` headers using `tough-cookie`
    - Session-like cookies (name matches `session|auth|token|sid`, case-insensitive) missing `HttpOnly` → one Vulnerability per cookie, Risk_Level "Medium"
    - Any cookie missing `Secure` when target supports HTTPS → Risk_Level "Low"
    - Any cookie missing `SameSite` → Risk_Level "Low"
    - Map all findings to OWASP `A07:2021 – Identification and Authentication Failures`
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_
  - [ ]* 17.2 Write property test — session cookie HttpOnly enforcement (Property 17)
    - **Property 17: Cookie security — session cookie HttpOnly enforcement**
    - **Validates: Requirements 13.2**
    - For any cookie with session-like name lacking HttpOnly, assert exactly one Vulnerability is created with Risk_Level "medium"

- [x] 18. OWASP category mapping and scan completion
  - [x] 18.1 Implement OWASP category completeness check
    - On scan completion, verify every associated Vulnerability has a non-null `owasp_category`
    - If any Vulnerability lacks a mapping, assign "Unclassified"
    - Produce and persist aggregated vuln counts grouped by `owasp_category` with the Scan record
    - _Requirements: 14.1, 14.2, 14.3, 14.4_
  - [ ]* 18.2 Write property test — OWASP category completeness on scan completion (Property 18)
    - **Property 18: OWASP category completeness on scan completion**
    - **Validates: Requirements 14.1, 14.3**
    - For any completed Scan, assert every Vulnerability has a non-null owasp_category value

- [x] 19. Checkpoint — Scanner modules complete
  - Ensure all scanner module tests pass, ask the user if questions arise.

- [x] 20. Vulnerability endpoints
  - [x] 20.1 Implement vulnerability list and detail endpoints
    - `GET /api/v1/scans/:id/vulnerabilities` — paginated (default 20 per page), filterable by `risk_level` and `owasp`, sortable by `risk_score`, `risk_level`, `discovered_at` (default: `risk_score` desc)
    - `GET /api/v1/scans/:id/vulnerabilities/:vid` — single vulnerability detail
    - _Requirements: 23.1, 23.2, 23.3, 23.4_
  - [ ]* 20.2 Write property test — vulnerability table filter correctness (Property 22)
    - **Property 22: Vulnerability table filter correctness**
    - **Validates: Requirements 23.3**
    - For any vulnerability list and applied Risk_Level filter, assert every returned record matches the filter and no others appear
  - [ ]* 20.3 Write property test — vulnerability table sort correctness (Property 23)
    - **Property 23: Vulnerability table sort correctness**
    - **Validates: Requirements 23.4**
    - For any vulnerability list sorted by risk score descending, assert every consecutive pair satisfies score[i] >= score[i+1]

- [x] 21. Activity logging service
  - [x] 21.1 Implement ActivityLog service
    - Write a reusable `logEvent(eventType, actorUserId, targetResourceId?, targetResourceType?, description)` function using Knex
    - Cover all 10 required event types: user_registration, user_login, user_logout, scan_creation, scan_start, scan_stop, scan_completion, report_generation, admin_role_change, admin_account_deactivation
    - _Requirements: 20.1, 20.2_
  - [ ]* 21.2 Write property test — activity log completeness (Property 25)
    - **Property 25: Activity log completeness**
    - **Validates: Requirements 20.1, 20.2**
    - For each significant system event, assert exactly one Activity_Log record is created with event_type, actor_user_id, target_resource_id (if applicable), timestamp, and description
  - [x] 21.3 Implement `GET /api/v1/admin/activity-logs` endpoint
    - Paginated at 50 records per page, ordered by timestamp descending, admin-only
    - _Requirements: 18.1, 20.3_

- [x] 22. AI_Assistant service
  - [x] 22.1 Implement AI_Assistant service wrapper
    - Implement `explainVulnerability(vuln)` — return plain-language description + remediation steps
    - Implement `scoreRisk(vuln)` — return numeric score 0–10
    - Implement `generateExecutiveSummary(scan)` — return ≤ 500-word summary
    - Implement `prioritizeVulnerabilities(vulns)` — return list ordered by risk score descending
    - Wrap all calls in try/catch; on failure return null AI fields and write `ai_service_failure` to activity_logs
    - Support both OpenAI GPT-4o and Google Gemini via environment variable toggle
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5_
  - [x] 22.2 Implement AI endpoints
    - `GET /api/v1/scans/:id/vulnerabilities/:vid/explain` → AIExplanation
    - `GET /api/v1/scans/:id/summary` → ExecutiveSummary
    - `GET /api/v1/scans/:id/prioritized` → PrioritizedVulnerabilities
    - _Requirements: 15.1, 15.3, 15.4_
  - [ ]* 22.3 Write property test — AI risk score bounds (Property 19)
    - **Property 19: AI risk score bounds**
    - **Validates: Requirements 15.2**
    - For any Vulnerability processed by AI_Assistant, assert 0 ≤ score ≤ 10
  - [ ]* 22.4 Write property test — AI executive summary length constraint (Property 20)
    - **Property 20: AI executive summary length constraint**
    - **Validates: Requirements 15.3**
    - For any completed Scan, assert generated executive summary contains ≤ 500 words
  - [ ]* 22.5 Write property test — AI prioritized list ordering (Property 21)
    - **Property 21: AI prioritized list is sorted by risk score descending**
    - **Validates: Requirements 15.4**
    - For any Scan with 2+ Vulnerabilities, assert every consecutive pair in the prioritized list satisfies score[i] >= score[i+1]

- [ ] 23. Report_Generator service
  - [x] 23.1 Implement Report_Generator
    - Use Puppeteer to render internal HTML report template to PDF
    - Report sections: cover page, AI executive summary, risk summary chart, OWASP breakdown, vulnerability findings table (sorted by risk score desc), per-vulnerability detail pages with PoC + screenshots, appendix (site map + raw scan log)
    - Embed Puppeteer screenshots as base64 in PDF
    - Complete report generation within 60 seconds for up to 100 vulnerabilities (return 504 + Activity_Log entry on timeout)
    - Persist Report record with scan_id, format, file_path, file_size_bytes, created_at
    - Write Activity_Log record for `report_generation`
    - _Requirements: 16.1, 16.2, 16.4, 16.5, 16.6, 20.1_
  - [x] 23.2 Implement report endpoints
    - `POST /api/v1/scans/:id/reports` — generate PDF and HTML reports, return 201 + { report_id, pdf_url, html_url }
    - `GET /api/v1/reports` — list authenticated user's reports
    - `GET /api/v1/reports/:id/download/pdf` — return binary with `Content-Type: application/pdf`
    - `GET /api/v1/reports/:id/download/html` — return binary with `Content-Type: text/html`
    - _Requirements: 16.1, 16.3_
  - [ ]* 23.3 Write unit tests for report generation timeout handling
    - Mock Puppeteer to simulate 60-second timeout; assert 504 response and Activity_Log entry
    - _Requirements: 16.5_

- [x] 24. Notification_Service
  - [x] 24.1 Implement Notification_Service with EventEmitter bus
    - Listen for `scan.completed` and emit completion email (target URL, time, vuln count, critical count)
    - Listen for `vulnerability.critical` and emit immediate alert email
    - Retry logic: 3 attempts with exponential back-off (1s, 2s, 4s); on exhaustion write failure to activity_logs
    - Respect `email_notif_enabled` flag — skip email if false
    - Use Nodemailer + SMTP configuration from environment variables
    - _Requirements: 19.1, 19.2, 19.3, 19.4_
  - [ ]* 24.2 Write unit tests for notification retry and opt-out
    - Mock SMTP transport; verify 3 retries on failure then Activity_Log write and no further retries
    - Verify no email sent when `email_notif_enabled` is false
    - _Requirements: 19.3, 19.4_

- [x] 25. Admin endpoints
  - [x] 25.1 Implement admin user management endpoints
    - `GET /api/v1/admin/users` — paginated user list with display name, email, role, created_at, scan count
    - `GET /api/v1/admin/users/:id` — single user detail
    - `PUT /api/v1/admin/users/:id/role` — update role, write Activity_Log record for `admin_role_change`
    - `PUT /api/v1/admin/users/:id/deactivate` — set `is_active = false`, prevent future auth; return 400 if admin tries to deactivate own account; write Activity_Log record for `admin_account_deactivation`
    - _Requirements: 18.2, 18.3, 18.4, 18.5, 20.1_
  - [x] 25.2 Implement admin stats endpoint
    - `GET /api/v1/admin/stats` — total users, total scans, vulnerability statistics aggregated across all scans
    - `GET /api/v1/admin/scans` — all scans across all users (paginated)
    - _Requirements: 18.1_

- [x] 26. Checkpoint — Backend complete
  - Ensure all backend tests pass and all endpoints are reachable, ask the user if questions arise.

- [x] 27. Frontend foundation
  - [x] 27.1 Configure Tailwind CSS design system and global styles
    - Define custom colors in `tailwind.config.ts`: navy `#0a0f1e`, surface `#111827`, neon-blue `#00d4ff`, cyber-green `#00ff94`, critical `#ff4757`, high `#ff6348`, medium `#ffa502`, low `#2ed573`
    - Set base font: Inter (body), JetBrains Mono (code/payloads)
    - Configure Glassmorphism card style (`backdrop-filter: blur(16px)`, semi-transparent dark background, 1px neon border on hover)
    - _Requirements: 22.3_
  - [x] 27.2 Set up React Router v6 routes and auth guards
    - Implement `<AuthProvider>` with JWT storage, context, and route guard HOC
    - Configure all routes from the page inventory: `/`, `/features`, `/about`, `/login`, `/register`, `/dashboard`, `/scans`, `/scans/new`, `/scans/:id`, `/scans/:id/vulnerabilities/:vid`, `/reports`, `/settings`, `/admin`, `/admin/users`, `/admin/logs`
    - Implement `<PrivateLayout>` (Sidebar + TopNavBar) and `<AdminLayout>`
    - _Requirements: 22.1, 22.2_
  - [x] 27.3 Build shared component library
    - `SkeletonLoader` — placeholder for any data-fetching panel (triggered at >200ms)
    - `RiskBadge` — color-coded chip: Critical=red, High=orange, Medium=yellow, Low=blue, Info=gray
    - `ScanStatusChip` — animated chip: Running=pulsing green
    - `GlassCard` — Glassmorphism card wrapper
    - `ProgressRing` — SVG circular progress indicator for running scans
    - `ConfirmDialog` — modal confirmation for destructive actions
    - `ErrorBoundary` — React error boundary with fallback UI
    - _Requirements: 17.4, 22.3, 22.4_
  - [x] 27.4 Configure TanStack Query client with global loading and error handling
    - Set up `<QueryClientProvider>` with appropriate `staleTime` and `retry` settings
    - Configure global error handling to surface API errors in UI
    - _Requirements: 17.4_

- [x] 28. Frontend auth pages
  - [x] 28.1 Implement LoginPage and RegisterPage
    - `LoginPage` (`/login`): email + password form; on success store JWT in AuthProvider, redirect to `/dashboard`
    - `RegisterPage` (`/register`): display name, email, password fields with client-side validation matching backend policy; show field-level error messages
    - Both pages apply dark Glassmorphism card style
    - _Requirements: 1.1, 1.3, 22.1_
  - [x] 28.2 Implement SettingsPage
    - Display current profile; form for updating display name and email
    - Separate form for changing password (current + new + confirm)
    - Toggle for `email_notif_enabled`
    - _Requirements: 3.1, 3.4, 19.4, 22.1_

- [x] 29. Frontend public pages
  - [x] 29.1 Implement LandingPage, FeaturesPage, and AboutPage
    - LandingPage (`/`): hero section, feature highlights, CTA buttons for login/register
    - FeaturesPage (`/features`): list of all 9 scan modules with descriptions
    - AboutPage (`/about`): project/team information
    - All pages use dark theme with Glassmorphism styling and are fully responsive
    - _Requirements: 22.1, 22.3_

- [x] 30. User Dashboard
  - [x] 30.1 Implement UserDashboard page
    - Display stat cards: total scan count, total vulnerability count, critical vulnerability count, 5 most recent scans
    - Display `<RiskDistributionChart>` (Recharts BarChart — vuln counts by Risk_Level)
    - Display `<ScanActivityTimeline>` (Recharts LineChart — scans per day over last 30 days)
    - Use `<SkeletonLoader>` for all panels while data is loading from TanStack Query
    - _Requirements: 17.1, 17.2, 17.3, 17.4_
  - [ ]* 30.2 Write unit tests for chart data transformation functions
    - Test that raw API responses are correctly aggregated into Recharts-compatible data shapes
    - _Requirements: 17.2, 17.3_

- [ ] 31. Scan management pages
  - [ ] 31.1 Implement ScanManagement and NewScanForm pages
    - `ScanManagement` (`/scans`): paginated list of user's scans with status chips; Start/Stop/Delete actions with `<ConfirmDialog>` for destructive actions
    - `NewScanForm` (`/scans/new`): target URL input with validation; module selection checkboxes; submit to `POST /api/v1/scans` then redirect to scan detail
    - _Requirements: 4.1, 4.2, 22.1_
  - [x] 31.2 Implement ScanDetails page
    - Display: scan status chip, target URL, timestamps, duration, progress ring (if running), list of module statuses
    - `<VulnerabilityTable>`: sortable by risk_score/risk_level/discovered_at, filterable by Risk_Level and OWASP category, paginated
    - Poll scan status via TanStack Query `refetchInterval` while status is "running"
    - _Requirements: 23.1, 23.3, 23.4, 4.9_
  - [x] 31.3 Implement VulnerabilityDetails page
    - Display: name, OWASP category, Risk_Level badge, affected URL/parameter, AI description + remediation, risk score, PoC payload, screenshot
    - Button to fetch AI explanation on demand; show "AI explanation unavailable" if AI fails
    - _Requirements: 23.2, 15.1, 15.5_

- [x] 32. Reports page
  - [x] 32.1 Implement ReportsPage and report generation
    - `ReportsPage` (`/reports`): list of generated reports with scan target, format, date; download buttons for PDF and HTML
    - "Generate Report" button on ScanDetails page for completed scans; calls `POST /api/v1/scans/:id/reports`
    - Download links call `/api/v1/reports/:id/download/pdf` and `/api/v1/reports/:id/download/html`
    - _Requirements: 16.1, 16.3, 22.1_

- [x] 33. Admin Panel pages
  - [x] 33.1 Implement AdminPanel dashboard page
    - `/admin`: display total users, total scans, aggregated vulnerability stats, link to activity log viewer
    - _Requirements: 18.1_
  - [x] 33.2 Implement UserManagement page
    - `/admin/users`: paginated user list with display name, email, role, created_at, scan count; Role change and Deactivate actions with `<ConfirmDialog>`; prevent self-deactivation in UI
    - _Requirements: 18.2, 18.3, 18.4, 18.5_
  - [x] 33.3 Implement ActivityLogViewer page
    - `/admin/logs`: paginated activity log (50 per page), ordered by timestamp descending, with event type, actor, target, and description columns
    - _Requirements: 18.1, 20.3_

- [x] 34. Responsive layout and mobile support
  - [x] 34.1 Implement responsive sidebar and mobile layout
    - Collapse sidebar into hamburger menu when viewport < 768px
    - Adapt all dashboard and list layouts to single-column mobile-friendly format
    - Ensure all pages pass a responsive check at sm (640px), md (768px), lg (1024px), xl (1280px) breakpoints
    - _Requirements: 22.5_

- [x] 35. Checkpoint — Frontend complete
  - Ensure all frontend components render correctly and TanStack Query integrations work end-to-end, ask the user if questions arise.

- [ ] 36. Docker and deployment configuration
  - [x] 36.1 Write backend Dockerfile
    - Multi-stage build: `node:20-alpine` builder stage (TypeScript compile), runner stage with `nmap`, `nmap-scripts`, `chromium` installed via `apk`
    - Set `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
    - Expose port 3001
    - _Requirements: 24.1_
  - [ ] 36.2 Write docker-compose.yml
    - Define services: `postgres` (postgres:15-alpine with health check), `zap` (ghcr.io/zaproxy/zaproxy:stable), `api` (depends_on postgres healthy + zap started)
    - Mount `pgdata` volume; pass all environment variables via environment references
    - _Requirements: 24.2_
  - [~] 36.3 Implement database migration on container startup
    - In `backend/src/index.ts`: call `knex.migrate.latest()` before `app.listen()`; log success and fail fast on migration error
    - _Requirements: 24.3_
  - [~] 36.4 Configure Vercel deployment for frontend
    - Add `vercel.json` with SPA rewrite rule: `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }`
    - Ensure `VITE_API_BASE_URL` is the only required environment variable at build time
    - _Requirements: 24.4, 24.5_

- [~] 37. Final checkpoint — All systems integrated
  - Ensure all backend and frontend tests pass, Docker Compose starts cleanly, migrations run successfully, and all API endpoints are reachable from the frontend, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at major milestones
- Property tests use `fast-check` with `numRuns: 100` minimum and are tagged with design property numbers
- Unit tests use Jest + Supertest for backend; Vitest for frontend
- All Knex queries use parameterized bindings — no raw string interpolation
- Puppeteer is reused across: CrawlerModule, DOM XSS detection, screenshot capture, and PDF report rendering
- The ZAP container must be running before the API container attempts SQL injection or XSS scans
- Environment variables must be populated in `.env` (local) before running `docker-compose up`
- Tasks marked with `*` are NOT to be implemented automatically — they require explicit user instruction

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["2.2", "3.1", "4.1", "4.3"] },
    { "id": 2, "tasks": ["3.2", "3.3", "3.4", "3.5", "4.2", "4.4", "7.1"] },
    { "id": 3, "tasks": ["3.6", "3.7", "4.5", "6.1", "7.2", "7.4"] },
    { "id": 4, "tasks": ["6.2", "7.3", "8.1", "8.4"] },
    { "id": 5, "tasks": ["8.2", "8.3", "8.5", "8.6", "21.1"] },
    { "id": 6, "tasks": ["9.1", "10.1", "11.1", "12.1", "21.2", "21.3"] },
    { "id": 7, "tasks": ["9.2", "10.2", "11.2", "12.2", "13.1", "14.1", "15.1", "16.1", "17.1", "18.1"] },
    { "id": 8, "tasks": ["13.2", "14.2", "15.2", "16.2", "17.2", "18.2", "20.1"] },
    { "id": 9, "tasks": ["20.2", "20.3", "22.1", "23.1", "24.1", "25.1", "25.2"] },
    { "id": 10, "tasks": ["22.2", "22.3", "22.4", "22.5", "23.2", "23.3", "24.2"] },
    { "id": 11, "tasks": ["27.1", "27.2", "27.3", "27.4", "36.1", "36.2", "36.3", "36.4"] },
    { "id": 12, "tasks": ["28.1", "28.2", "29.1", "30.1"] },
    { "id": 13, "tasks": ["30.2", "31.1", "31.2", "31.3", "32.1", "33.1", "33.2", "33.3", "34.1"] }
  ]
}
```
