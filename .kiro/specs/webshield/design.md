# Design Document — WebShield

## Overview

WebShield is an AI-powered automated web security scanning platform designed to BSIT/BSCS final-year project standards. It allows authenticated users to scan websites and web applications for common security vulnerabilities, receive AI-assisted remediation guidance, and generate professional security reports. The platform is structured around a RESTful API backend, a single-page React frontend, and integrations with third-party scanning tools (OWASP ZAP, Nmap, Puppeteer).

### Design Goals

- **Correctness** — every scan module produces deterministic, well-typed vulnerability records with OWASP mappings and risk levels.
- **Security** — the platform practices what it preaches: JWTs, bcrypt, parameterized queries, Helmet.js, and strict RBAC throughout.
- **Extensibility** — scan modules are isolated plug-ins; adding a new module requires no changes to the orchestrator core.
- **Deployability** — Docker-first design with environment-variable-driven configuration; frontend deployable to Vercel, backend to Railway/Render.
- **Observability** — every significant lifecycle event writes an Activity_Log record; all errors surface to logs.

---

## Architecture

### High-Level System Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                         Client Layer                         │
│        React/Vite SPA (Vercel)                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │  Auth UI │  │Dashboard │  │Scan Mgmt │  │Admin Panel │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └─────┬──────┘  │
└───────┼─────────────┼─────────────┼───────────────┼─────────┘
        │             │  HTTPS/REST │               │
        ▼             ▼             ▼               ▼
┌──────────────────────────────────────────────────────────────┐
│                     API Gateway Layer                        │
│              Node.js / Express (Railway/Render)              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Helmet.js │ Rate_Limiter │ JWT Middleware │ CORS     │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │Auth_Service│  │Scanner_    │  │Report_     │            │
│  │            │  │Engine      │  │Generator   │            │
│  └────────────┘  └─────┬──────┘  └────────────┘            │
│                        │                                     │
│  ┌────────────┐  ┌─────▼──────┐  ┌────────────┐            │
│  │AI_Assistant│  │Scan Module │  │Notification│            │
│  │            │  │Orchestrator│  │_Service    │            │
│  └────────────┘  └─────┬──────┘  └────────────┘            │
└───────────────────────┬┼────────────────────────────────────┘
                        ││
        ┌───────────────┼┼─────────────────┐
        │               ││                 │
        ▼               ▼▼                 ▼
┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│  PostgreSQL  │  │ Tool Layer   │  │ External APIs│
│  Database    │  │  (Docker)    │  │              │
│              │  │  Nmap        │  │  AI Provider │
│  Knex.js     │  │  OWASP ZAP   │  │  (OpenAI /   │
│  Migrations  │  │  Puppeteer   │  │   Gemini)    │
└──────────────┘  └──────────────┘  │  SMTP/Email  │
                                     └──────────────┘
```

### Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| Frontend | React 18 + Vite + TypeScript | Fast HMR, excellent ecosystem, Vercel-native |
| UI Library | Tailwind CSS + shadcn/ui | Dark theme, Glassmorphism cards, rapid composition |
| Charts | Recharts | Lightweight, React-native, suitable for dashboards |
| State Management | TanStack Query (React Query) | Server state caching, loading skeletons built-in |
| Routing | React Router v6 | Client-side routing with route guards |
| Backend | Node.js 20 LTS + Express 4 | Wide ecosystem, native async/await, ZAP/Nmap CLI friendly |
| ORM / Query Builder | Knex.js | SQL builder with migration support, parameterized queries by default |
| Database | PostgreSQL 15 | Relational integrity for RBAC, scans, and vulnerabilities |
| Authentication | JWT (jsonwebtoken) + bcrypt | Stateless auth, industry-standard password hashing |
| PDF Generation | Puppeteer (headless Chrome) | Reuses existing Puppeteer instance; also used for crawling |
| Email | Nodemailer + SMTP | Simple, provider-agnostic |
| Security Middleware | Helmet.js, express-rate-limit | Secure headers, rate limiting |
| Containerization | Docker + Docker Compose | Reproducible builds, easy local dev |
| Port Scanning | Nmap (CLI via child_process) | Authoritative port/service detection |
| Web Scanning | OWASP ZAP (REST API) | Comprehensive active/passive scanning |
| Browser Automation | Puppeteer | Crawling, DOM XSS, screenshot capture |

---

## Components and Interfaces

### 1. Auth_Service

Responsible for all identity and access operations.

**Responsibilities:**
- User registration with bcrypt password hashing (cost ≥ 12)
- JWT issuance (24-hour expiry, HS256) and validation
- Token blocklist (Redis or in-memory Set) for logout invalidation
- Password reset token generation (1-hour HMAC token stored in DB)
- Profile management (display name, email, password change)
- Role enforcement helpers consumed by the middleware layer

**Key Interfaces:**
```
POST /api/auth/register        → { user_id, display_name, email, role }
POST /api/auth/login           → { token, user }
POST /api/auth/logout          → 204
POST /api/auth/forgot-password → 200 / 404
POST /api/auth/reset-password  → 200 / 400
GET  /api/users/me             → UserProfile
PUT  /api/users/me             → UserProfile
PUT  /api/users/me/password    → 200 / 400 / 422
```

**Middleware chain (all protected routes):**
```
Request → Helmet.js → Rate_Limiter → JWT_Verify → Role_Guard → Route Handler
```

---

### 2. Scanner_Engine

The orchestration core that manages scan lifecycle and delegates to scan modules.

**Responsibilities:**
- Scan record CRUD (create, start, stop, status transitions)
- Module orchestration (sequential execution, error isolation)
- Concurrency enforcement (max 3 per user)
- Progress tracking (DB update ≥ every 10 seconds via setInterval)
- Vulnerability record persistence
- OWASP category assignment delegation

**Scan Status Machine:**
```
pending ──start──► running ──all-modules-done──► completed
                     │
                     ├──all-modules-failed──► failed
                     │
                     └──user-stop──► stopped
```

**Module Registry (plug-in pattern):**
```typescript
interface ScanModule {
  name: string;
  execute(context: ScanContext): Promise<ModuleResult>;
  timeout?: number; // seconds, default 300
}

interface ScanContext {
  scanId: string;
  targetUrl: string;
  siteMap?: SiteMap;   // populated after crawl
  db: Knex;
  logger: Logger;
}

interface ModuleResult {
  status: 'completed' | 'failed' | 'timed_out';
  findings: Finding[];
  duration: number;
}
```

**Module Execution Order:**
1. `HttpHeaderModule`
2. `SslTlsModule`
3. `PortScanModule` (Nmap)
4. `CrawlerModule` (Puppeteer — populates siteMap for downstream modules)
5. `SqlInjectionModule` (ZAP + custom payloads)
6. `XssModule` (ZAP + Puppeteer)
7. `DirectoryDiscoveryModule`
8. `SensitiveInfoModule`
9. `CookieSecurityModule`

**Key Interfaces:**
```
POST /api/scans              → { scan_id, status: "pending" }
POST /api/scans/:id/start    → { scan_id, status: "running" }
POST /api/scans/:id/stop     → { scan_id, status: "stopped" }
GET  /api/scans              → PaginatedList<ScanSummary>
GET  /api/scans/:id          → ScanDetail (with modules, progress)
GET  /api/scans/:id/vulnerabilities → PaginatedList<Vulnerability>
```

---

### 3. Scan Modules

#### 3.1 HttpHeaderModule

Fetches the target URL with `node-fetch` and evaluates six security headers:

| Header | Absent Risk | Misconfigured Risk |
|---|---|---|
| Content-Security-Policy | Medium | Medium |
| X-Frame-Options | Medium | Low |
| X-XSS-Protection | Low | Low |
| Strict-Transport-Security | High | Medium |
| Referrer-Policy | Low | Low |
| Permissions-Policy | Low | Low |

OWASP mapping: `A05:2021 – Security Misconfiguration`

#### 3.2 SslTlsModule

Uses Node.js built-in `tls` module to connect and inspect certificates.

| Condition | Risk |
|---|---|
| No HTTPS redirect | High |
| Certificate expired | High |
| Certificate expires within 30 days | Medium |
| TLS 1.0 or 1.1 negotiated | Medium |

OWASP mapping: `A02:2021 – Cryptographic Failures`

#### 3.3 PortScanModule

Spawns `nmap -sV --open -T4 <host>` as a child process with a 300-second timeout. Parses XML output (`-oX -`) using `fast-xml-parser`. High-risk service list:

| Port | Service | Risk |
|---|---|---|
| 21 | FTP | High |
| 23 | Telnet | High |
| 3306 | MySQL (exposed) | High |
| 5432 | PostgreSQL (exposed) | High |
| 27017 | MongoDB (exposed) | High |
| Other open | Any | Low |

OWASP mapping: `A05:2021 – Security Misconfiguration`

#### 3.4 CrawlerModule

Uses Puppeteer in headless mode to crawl the target up to depth 5, capped at 500 URLs. Discovered URLs, forms (action, method, fields), and screenshots are persisted as structured JSON in the `scan_site_maps` table. The resulting `SiteMap` object is attached to `ScanContext` for use by downstream modules.

#### 3.5 SqlInjectionModule

Two detection strategies:
1. **OWASP ZAP Active Scan** — calls ZAP REST API (`/JSON/ascan/action/scan/`) against discovered URLs.
2. **Custom payload set** — sends error-based payloads (`' OR '1'='1`, `'; DROP TABLE`) and time-based payloads (`'; WAITFOR DELAY '0:0:5'--`, `'; SELECT SLEEP(5)--`) against every form parameter and query string parameter. Measures response time against a baseline; delays ≥ 5 seconds create a `Critical` vulnerability.

OWASP mapping: `A03:2021 – Injection`

#### 3.6 XssModule

1. **Reflected XSS** — injects `<script>alert('xss')</script>` and variants into all parameters; scans response body for unencoded payload using a regex matcher.
2. **DOM XSS** — uses Puppeteer to inject payloads into URL fragments and JS-sink parameters; listens for `window.alert` calls via `page.on('dialog')`.

Both findings: Risk_Level `High`, includes PoC URL/payload.

OWASP mapping: `A03:2021 – Injection`

#### 3.7 DirectoryDiscoveryModule

Probes a predefined wordlist of paths using `node-fetch` with HEAD requests. Risk assignment:

| Condition | Risk |
|---|---|
| Sensitive file (`.env`, `.git/config`, `*.sql`, `*.bak`, `*.old`) + HTTP 200 | Critical |
| Any path HTTP 200 or 403 | Low |

OWASP mapping: `A05:2021 – Security Misconfiguration`

#### 3.8 SensitiveInfoModule

Iterates all crawled URLs, fetches their response bodies and headers, and applies regex patterns:

| Pattern | Risk | OWASP |
|---|---|---|
| API key / credential patterns (`[Aa]PI[_-]?[Kk]ey\s*[:=]\s*\S+`, AWS key regex, etc.) | Critical | A02 |
| Stack trace (`at Object.<anonymous>`, `Exception in thread`) | Medium | A05 |
| Debug info (`X-Debug`, `SERVER_SOFTWARE`) | Medium | A05 |
| Internal IP (RFC 1918: `10\.`, `192\.168\.`, `172\.(1[6-9]|2\d|3[01])\.`) | Low | A05 |
| Email address | Low | A05 |

Note: only the pattern *type* is stored in the vulnerability record, not the matched value.

#### 3.9 CookieSecurityModule

Fetches the target with `node-fetch` and parses `Set-Cookie` headers using the `tough-cookie` library. Evaluates three attributes per cookie:

| Condition | Risk |
|---|---|
| Session-like cookie (name matches `session|auth|token|sid`) missing `HttpOnly` | Medium |
| Any cookie missing `Secure` (and target supports HTTPS) | Low |
| Any cookie missing `SameSite` | Low |

OWASP mapping: `A07:2021 – Identification and Authentication Failures`

---

### 4. AI_Assistant

Wraps an external AI provider (OpenAI GPT-4o or Google Gemini) with structured prompts.

**Operations:**

| Operation | Input | Output |
|---|---|---|
| `explainVulnerability(vuln)` | Vulnerability record | Plain-language description + remediation steps |
| `scoreRisk(vuln)` | Vulnerability record | Numeric score 0–10 |
| `generateExecutiveSummary(scan)` | Completed Scan + Vulnerabilities | ≤ 500-word executive summary |
| `prioritizeVulnerabilities(vulns)` | List of Vulnerabilities | Same list ordered by risk score desc |

All AI operations are wrapped in try/catch; on failure, raw data is returned and the failure is written to `activity_logs`.

**Key Interfaces:**
```
GET  /api/scans/:id/vulnerabilities/:vid/explain  → AIExplanation
GET  /api/scans/:id/summary                       → ExecutiveSummary
GET  /api/scans/:id/prioritized                   → PrioritizedVulnerabilities
```

---

### 5. Report_Generator

Produces PDF and HTML reports from completed scans. Uses Puppeteer to render an internal HTML template to PDF. Screenshot assets captured during crawling are embedded as base64.

**Report sections:**
1. Cover page — scan metadata, target URL, date, duration
2. Executive Summary (from AI_Assistant)
3. Risk Summary chart (vulnerability counts by Risk_Level)
4. OWASP Category breakdown
5. Vulnerability findings table (sorted by risk score desc)
6. Per-vulnerability detail pages — description, PoC, remediation, screenshot
7. Appendix — full site map, raw scan log

**SLA:** report generation must complete within 60 seconds for up to 100 vulnerabilities.

**Key Interfaces:**
```
POST /api/scans/:id/reports        → { report_id, pdf_url, html_url }
GET  /api/reports/:id/download/pdf → binary (application/pdf)
GET  /api/reports/:id/download/html → binary (text/html)
```

---

### 6. Notification_Service

Event-driven, listens to scan lifecycle events via an internal EventEmitter bus.

**Triggers:**
- `scan.completed` → send completion email (target URL, time, vuln count, critical count)
- `vulnerability.critical` → send immediate critical-finding alert

**Retry logic:** 3 attempts with exponential back-off (1s, 2s, 4s). On exhaustion, writes to `activity_logs` and stops.

Respects `email_notifications_enabled` flag in user profile.

---

## Data Models

### ER Diagram

```
┌──────────────────────┐        ┌──────────────────────┐
│        users         │        │   password_reset_     │
│──────────────────────│        │       tokens          │
│ id (PK, UUID)        │◄──────┐│──────────────────────│
│ display_name         │       ││ id (PK, UUID)         │
│ email (UNIQUE)       │       ││ user_id (FK → users)  │
│ password_hash        │       ││ token_hash            │
│ role (user|admin)    │       ││ expires_at            │
│ is_active            │       ││ used_at               │
│ email_notif_enabled  │       ││ created_at            │
│ created_at           │       │└──────────────────────┘
│ updated_at           │       │
└──────────┬───────────┘       │
           │ 1                 │
           │                   │
           │ N                 │
┌──────────▼───────────┐       │  ┌──────────────────────┐
│        scans         │       │  │    activity_logs      │
│──────────────────────│       │  │──────────────────────│
│ id (PK, UUID)        │       └──┤ id (PK, UUID)         │
│ user_id (FK → users) │          │ event_type            │
│ target_url           │          │ actor_user_id (FK)    │
│ status               │          │ target_resource_id    │
│   (pending|running|  │          │ target_resource_type  │
│    completed|stopped │          │ description           │
│    |failed)          │          │ created_at            │
│ selected_modules     │          └──────────────────────┘
│   (JSONB array)      │
│ progress_pct         │
│ started_at           │
│ completed_at         │
│ created_at           │
└──────────┬───────────┘
           │ 1
           │
    ┌──────┼──────┐
    │      │      │
    N      N      N
    │      │      │
    ▼      ▼      ▼
┌──────────────┐  ┌────────────────┐  ┌──────────────────┐
│scan_modules  │  │vulnerabilities │  │    reports       │
│──────────────│  │────────────────│  │──────────────────│
│id (PK, UUID) │  │id (PK, UUID)   │  │id (PK, UUID)     │
│scan_id (FK)  │  │scan_id (FK)    │  │scan_id (FK)      │
│module_name   │  │name            │  │format (pdf|html) │
│status        │  │description     │  │file_path         │
│  (pending|   │  │risk_level      │  │file_size_bytes   │
│   running|   │  │  (informational│  │created_at        │
│   completed| │  │   |low|medium| │  └──────────────────┘
│   failed|    │  │   high|        │
│   timed_out) │  │   critical)    │
│started_at    │  │owasp_category  │
│completed_at  │  │affected_url    │
│error_message │  │affected_param  │
│created_at    │  │poc_payload     │
└──────────────┘  │screenshot_path │
                  │ai_score        │
                  │ai_description  │
                  │ai_remediation  │
                  │discovered_at   │
                  └────────────────┘

┌──────────────────────────────────────┐
│            scan_site_maps            │
│──────────────────────────────────────│
│ id (PK, UUID)                        │
│ scan_id (FK → scans, UNIQUE)         │
│ urls (JSONB array of URL strings)    │
│ forms (JSONB array of FormRecord)    │
│ url_count                            │
│ was_capped (boolean)                 │
│ created_at                           │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│           token_blocklist            │
│──────────────────────────────────────│
│ id (PK, UUID)                        │
│ token_jti (UNIQUE)                   │
│ user_id (FK → users)                 │
│ expires_at                           │
│ created_at                           │
└──────────────────────────────────────┘
```

### Schema Details

**`users` table**
```sql
CREATE TABLE users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name           VARCHAR(100) NOT NULL,
  email                  VARCHAR(255) NOT NULL UNIQUE,
  password_hash          VARCHAR(255) NOT NULL,
  role                   VARCHAR(10)  NOT NULL DEFAULT 'user'
                           CHECK (role IN ('user', 'admin')),
  is_active              BOOLEAN NOT NULL DEFAULT TRUE,
  email_notif_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`scans` table**
```sql
CREATE TABLE scans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_url       TEXT NOT NULL,
  status           VARCHAR(20) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','completed','stopped','failed')),
  selected_modules JSONB NOT NULL,
  progress_pct     SMALLINT NOT NULL DEFAULT 0,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_scans_user_id     ON scans(user_id);
CREATE INDEX idx_scans_status      ON scans(status);
```

**`vulnerabilities` table**
```sql
CREATE TABLE vulnerabilities (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id          UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  description      TEXT,
  risk_level       VARCHAR(15) NOT NULL
                     CHECK (risk_level IN ('informational','low','medium','high','critical')),
  owasp_category   VARCHAR(60) NOT NULL DEFAULT 'Unclassified',
  affected_url     TEXT,
  affected_param   VARCHAR(255),
  poc_payload      TEXT,
  screenshot_path  TEXT,
  ai_score         NUMERIC(4,2),
  ai_description   TEXT,
  ai_remediation   TEXT,
  discovered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_vuln_scan_id     ON vulnerabilities(scan_id);
CREATE INDEX idx_vuln_risk_level  ON vulnerabilities(risk_level);
```

**`scan_modules` table**
```sql
CREATE TABLE scan_modules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id       UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  module_name   VARCHAR(100) NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','running','completed','failed','timed_out')),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`reports` table**
```sql
CREATE TABLE reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id         UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
  format          VARCHAR(10) NOT NULL CHECK (format IN ('pdf','html')),
  file_path       TEXT NOT NULL,
  file_size_bytes INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`activity_logs` table**
```sql
CREATE TABLE activity_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type           VARCHAR(60) NOT NULL,
  actor_user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  target_resource_id   UUID,
  target_resource_type VARCHAR(60),
  description          TEXT NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_actlog_actor      ON activity_logs(actor_user_id);
CREATE INDEX idx_actlog_created    ON activity_logs(created_at DESC);
```

**`password_reset_tokens` table**
```sql
CREATE TABLE password_reset_tokens (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**`token_blocklist` table**
```sql
CREATE TABLE token_blocklist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_jti   VARCHAR(255) NOT NULL UNIQUE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_blocklist_jti ON token_blocklist(token_jti);
CREATE INDEX idx_blocklist_exp ON token_blocklist(expires_at);
```

**`scan_site_maps` table**
```sql
CREATE TABLE scan_site_maps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id     UUID NOT NULL REFERENCES scans(id) ON DELETE CASCADE UNIQUE,
  urls        JSONB NOT NULL DEFAULT '[]',
  forms       JSONB NOT NULL DEFAULT '[]',
  url_count   INTEGER NOT NULL DEFAULT 0,
  was_capped  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### JSON Type Definitions

```typescript
// stored in scan_site_maps.forms
interface FormRecord {
  action_url: string;
  method: 'GET' | 'POST';
  fields: string[];        // input name attributes
  page_url: string;        // URL where form was found
}

// stored in scans.selected_modules
type SelectedModule =
  | 'http_headers'
  | 'ssl_tls'
  | 'port_scan'
  | 'crawler'
  | 'sql_injection'
  | 'xss'
  | 'directory_discovery'
  | 'sensitive_info'
  | 'cookie_security';
```

---

## API Endpoint Design

All endpoints are prefixed with `/api/v1`. All protected endpoints require `Authorization: Bearer <token>`.

### Authentication Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | None | Register new user |
| POST | `/auth/login` | None | Obtain JWT |
| POST | `/auth/logout` | User | Invalidate JWT |
| POST | `/auth/forgot-password` | None | Request reset link |
| POST | `/auth/reset-password` | None | Consume reset token |

### User Profile Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/users/me` | User | Get own profile |
| PUT | `/users/me` | User | Update display name / email |
| PUT | `/users/me/password` | User | Change password |
| PUT | `/users/me/settings` | User | Toggle email notifications |

### Scan Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/scans` | User | Create scan (returns 201 + scan_id) |
| GET | `/scans` | User | List own scans (paginated) |
| GET | `/scans/:id` | User | Get scan detail + module statuses |
| POST | `/scans/:id/start` | User | Transition pending → running |
| POST | `/scans/:id/stop` | User | Transition running → stopped |
| DELETE | `/scans/:id` | User | Delete a stopped/completed scan |
| GET | `/scans/:id/vulnerabilities` | User | List vulnerabilities (filterable, sortable) |
| GET | `/scans/:id/vulnerabilities/:vid` | User | Get single vulnerability |
| GET | `/scans/:id/vulnerabilities/:vid/explain` | User | AI explanation |
| GET | `/scans/:id/summary` | User | AI executive summary |
| GET | `/scans/:id/prioritized` | User | AI-prioritized vulnerability list |
| POST | `/scans/:id/reports` | User | Generate report |

### Report Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/reports` | User | List own reports |
| GET | `/reports/:id/download/pdf` | User | Download PDF binary |
| GET | `/reports/:id/download/html` | User | Download HTML binary |

### Admin Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/admin/stats` | Admin | System-wide statistics |
| GET | `/admin/users` | Admin | Paginated user list |
| GET | `/admin/users/:id` | Admin | Single user detail |
| PUT | `/admin/users/:id/role` | Admin | Change user role |
| PUT | `/admin/users/:id/deactivate` | Admin | Deactivate user account |
| GET | `/admin/activity-logs` | Admin | Paginated activity log |
| GET | `/admin/scans` | Admin | All scans across all users |

### Request / Response Schemas (Selected)

**POST `/auth/register`**
```json
// Request
{
  "display_name": "Alice Smith",
  "email": "alice@example.com",
  "password": "P@ssw0rd123!"
}
// Response 201
{
  "user_id": "uuid",
  "display_name": "Alice Smith",
  "email": "alice@example.com",
  "role": "user"
}
```

**POST `/scans`**
```json
// Request
{
  "target_url": "https://example.com",
  "modules": ["http_headers", "ssl_tls", "port_scan", "crawler", "xss"]
}
// Response 201
{
  "scan_id": "uuid",
  "status": "pending",
  "target_url": "https://example.com",
  "created_at": "2024-01-15T10:00:00Z"
}
```

**GET `/scans/:id/vulnerabilities`**
```
Query params:
  risk_level  = informational | low | medium | high | critical
  owasp       = A01:2021 | A02:2021 | ... | A10:2021
  sort_by     = risk_score | risk_level | discovered_at   (default: risk_score)
  order       = asc | desc   (default: desc)
  page        = integer (default: 1)
  per_page    = integer 1–100 (default: 20)
```

---

## Frontend Pages and Component Structure

### Page Inventory

| Route | Component | Auth | Role |
|---|---|---|---|
| `/` | `LandingPage` | No | Public |
| `/features` | `FeaturesPage` | No | Public |
| `/about` | `AboutPage` | No | Public |
| `/login` | `LoginPage` | No | Public |
| `/register` | `RegisterPage` | No | Public |
| `/dashboard` | `UserDashboard` | Yes | User |
| `/scans` | `ScanManagement` | Yes | User |
| `/scans/new` | `NewScanForm` | Yes | User |
| `/scans/:id` | `ScanDetails` | Yes | User |
| `/scans/:id/vulnerabilities/:vid` | `VulnerabilityDetails` | Yes | User |
| `/reports` | `ReportsPage` | Yes | User |
| `/settings` | `SettingsPage` | Yes | User |
| `/admin` | `AdminPanel` | Yes | Admin |
| `/admin/users` | `UserManagement` | Yes | Admin |
| `/admin/logs` | `ActivityLogViewer` | Yes | Admin |

### Component Tree (Authenticated Shell)

```
<App>
  <AuthProvider>          ← JWT storage, refresh, context
    <QueryClientProvider> ← TanStack Query
      <Router>
        <PublicRoutes>    ← Landing, Login, Register
        <PrivateLayout>   ← Authenticated shell
          <Sidebar>       ← Role-aware navigation links
          <TopNavBar>     ← User menu, notifications badge
          <MainContent>
            <Outlet>      ← Page component injected here
          </MainContent>
        </PrivateLayout>
        <AdminLayout>     ← Admin-only shell (extends PrivateLayout)
      </Router>
    </QueryClientProvider>
  </AuthProvider>
</App>
```

### Key Shared Components

| Component | Purpose |
|---|---|
| `SkeletonLoader` | Placeholder for any data-fetching panel (>200ms) |
| `VulnerabilityTable` | Sortable, filterable table with Risk_Level badges |
| `RiskBadge` | Color-coded chip: Critical=red, High=orange, Medium=yellow, Low=blue, Info=gray |
| `ScanStatusChip` | Animated chip: Running=pulsing green, etc. |
| `RiskDistributionChart` | Recharts BarChart — vuln counts by Risk_Level |
| `ScanActivityTimeline` | Recharts LineChart — scans per day over 30 days |
| `GlassCard` | Tailwind + backdrop-blur Glassmorphism card wrapper |
| `ProgressRing` | SVG circular progress indicator for running scans |
| `ConfirmDialog` | Modal confirmation for destructive actions |
| `ErrorBoundary` | React error boundary with fallback UI |

### Design System

- **Color palette:** `navy (#0a0f1e)`, `surface (#111827)`, `neon-blue (#00d4ff)`, `cyber-green (#00ff94)`, `critical (#ff4757)`, `high (#ff6348)`, `medium (#ffa502)`, `low (#2ed573)`
- **Typography:** Inter (body), JetBrains Mono (code/payloads)
- **Cards:** `backdrop-filter: blur(16px)`, semi-transparent dark backgrounds, 1px neon border on hover
- **Responsive breakpoints:** `sm: 640px`, `md: 768px` (sidebar collapses), `lg: 1024px`, `xl: 1280px`

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Password hash strength

*For any* valid registration input (email, password, display name), the password stored in the database SHALL be a bcrypt hash with a cost factor of at least 12.

**Validates: Requirements 1.5**

---

### Property 2: Registration uniqueness — duplicate email rejection

*For any* email address that is already registered in the system, a subsequent registration attempt using the same email SHALL be rejected with HTTP 409, regardless of the other fields supplied.

**Validates: Requirements 1.2**

---

### Property 3: JWT post-logout invalidation (round-trip)

*For any* authenticated user, a JWT that was obtained at login and then presented after a successful logout SHALL be rejected with HTTP 401 on any protected endpoint.

**Validates: Requirements 1.9, 1.10**

---

### Property 4: Role access control correctness

*For any* (user, endpoint) pair, the access decision (permit/deny) SHALL be determined solely by the role embedded in the user's JWT relative to the required role of the endpoint: a "user" token SHALL be denied any admin-only endpoint (HTTP 403), and an "admin" token SHALL be permitted both user and admin endpoints.

**Validates: Requirements 2.2, 2.3, 2.5**

---

### Property 5: Token rejection for all invalid token variants

*For any* token that is absent, malformed, unparseable, expired, or carries an invalid signature, every protected endpoint SHALL return HTTP 401.

**Validates: Requirements 2.4**

---

### Property 6: Profile update field validation

*For any* profile update request supplying an email with an invalid RFC 5322 format or a display name outside the range [2, 100] characters, the Auth_Service SHALL reject the request with HTTP 422.

**Validates: Requirements 3.3**

---

### Property 7: Scan creation with valid input yields "pending" scan

*For any* valid HTTP/HTTPS target URL (reachable public host) and non-empty selected module list, a scan creation request SHALL produce exactly one Scan record with status "pending" and return HTTP 201.

**Validates: Requirements 4.1**

---

### Property 8: Scan creation validation rejects all invalid inputs

*For any* scan creation request containing a malformed URL, a non-HTTP/HTTPS scheme, a private/loopback IP address, or an empty module list, the Scanner_Engine SHALL return HTTP 422.

**Validates: Requirements 4.2**

---

### Property 9: Concurrent scan limit enforcement

*For any* user who already has 3 scans in "running" status, any additional start request SHALL be rejected with HTTP 429, regardless of which scans are targeted.

**Validates: Requirements 4.10, 4.11**

---

### Property 10: HTTP header analysis produces correct risk levels

*For any* HTTP response header set, the HttpHeaderModule SHALL assign Risk_Level "Medium" to an absent or misconfigured Content-Security-Policy and Risk_Level "Low" to an absent or misconfigured Referrer-Policy.

**Validates: Requirements 5.4**

---

### Property 11: SSL/TLS analysis — certificate expiry risk classification

*For any* TLS certificate, the SslTlsModule SHALL assign Risk_Level "High" when the certificate is already expired, and Risk_Level "Medium" when the certificate expires within 30 days of the scan date.

**Validates: Requirements 6.4, 6.5**

---

### Property 12: Port risk classification

*For any* Nmap result containing an open port, the PortScanModule SHALL assign Risk_Level "High" to any port/service pair on the known high-risk list (FTP/21, Telnet/23, exposed DB ports) and Risk_Level "Low" to all other open ports.

**Validates: Requirements 7.3**

---

### Property 13: SQL injection time-based detection threshold

*For any* parameter where a time-based SQL injection payload causes a response delay of 5 seconds or more above the measured baseline, the SqlInjectionModule SHALL create a Vulnerability record with Risk_Level "Critical".

**Validates: Requirements 9.3**

---

### Property 14: Reflected XSS detection — payload round-trip

*For any* HTTP response body that contains an injected XSS payload in unencoded form, the XssModule SHALL create a Vulnerability record with Risk_Level "High" including the triggering payload.

**Validates: Requirements 10.1, 10.2**

---

### Property 15: Directory discovery risk classification

*For any* probe result where a sensitive file path (`.env`, `.git/config`, `*.sql`, `*.bak`, `*.old`) returns HTTP 200, the DirectoryDiscoveryModule SHALL assign Risk_Level "Critical"; for any other path returning HTTP 200 or 403, Risk_Level "Low".

**Validates: Requirements 11.2, 11.3**

---

### Property 16: Sensitive information exposure — no key values stored

*For any* response body containing an API key pattern match, the SensitiveInfoModule SHALL create a Vulnerability record that contains the pattern type identifier but SHALL NOT contain the matched key value.

**Validates: Requirements 12.2**

---

### Property 17: Cookie security — session cookie HttpOnly enforcement

*For any* cookie whose name matches the pattern `session|auth|token|sid` (case-insensitive) and which lacks the `HttpOnly` attribute, the CookieSecurityModule SHALL create exactly one Vulnerability record with Risk_Level "Medium".

**Validates: Requirements 13.2**

---

### Property 18: OWASP category completeness on scan completion

*For any* completed Scan, every associated Vulnerability record SHALL have a non-null `owasp_category` value (either a specific OWASP Top 10 2021 category or "Unclassified").

**Validates: Requirements 14.1, 14.3**

---

### Property 19: AI risk score bounds

*For any* Vulnerability record processed by the AI_Assistant, the assigned numeric risk score SHALL satisfy `0 ≤ score ≤ 10`.

**Validates: Requirements 15.2**

---

### Property 20: AI executive summary length constraint

*For any* completed Scan, the AI-generated executive summary SHALL contain no more than 500 words.

**Validates: Requirements 15.3**

---

### Property 21: AI prioritized list is sorted by risk score descending

*For any* Scan containing two or more Vulnerability records, the AI-prioritized list SHALL be ordered such that for every consecutive pair (i, i+1), `score[i] >= score[i+1]`.

**Validates: Requirements 15.4**

---

### Property 22: Vulnerability table filter correctness

*For any* vulnerability list and any applied Risk_Level filter, every record returned SHALL match the specified Risk_Level and no record with a different Risk_Level SHALL appear in the result.

**Validates: Requirements 23.3**

---

### Property 23: Vulnerability table sort correctness

*For any* vulnerability list sorted by risk score descending, every consecutive pair (i, i+1) in the result SHALL satisfy `score[i] >= score[i+1]`.

**Validates: Requirements 23.4**

---

### Property 24: Rate limiter — unauthenticated request cap

*For any* IP address, the Rate_Limiter SHALL allow at most 20 requests per minute; the 21st request within a 60-second window SHALL receive HTTP 429 with a `Retry-After` header.

**Validates: Requirements 21.2, 21.4**

---

### Property 25: Activity log completeness

*For any* significant system event (registration, login, logout, scan creation, scan start, scan stop, scan completion, report generation, role change, account deactivation), exactly one Activity_Log record SHALL be created containing: event type, actor user ID, target resource ID (if applicable), timestamp, and a human-readable description.

**Validates: Requirements 20.1, 20.2**

---

## Error Handling

### Error Response Schema

All error responses follow a consistent envelope:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "field": "email"       // optional, for field-level errors
  }
}
```

### HTTP Status Code Matrix

| Scenario | Status |
|---|---|
| Successful creation | 201 |
| Successful update / operation | 200 |
| No content | 204 |
| Validation error (client input) | 422 |
| Duplicate resource | 409 |
| Authentication failure | 401 |
| Authorization failure (wrong role) | 403 |
| Resource not found | 404 |
| Rate limit exceeded | 429 |
| Scan status conflict (wrong state) | 409 |
| Report generation timeout | 504 |
| Internal error | 500 |

### Scan Module Error Isolation

Each scan module is executed inside a `try/catch` with a per-module timeout via `Promise.race`. On error or timeout:
1. The module's `status` is set to `"failed"` or `"timed_out"` in `scan_modules`.
2. The error message is persisted to `scan_modules.error_message`.
3. An Activity_Log entry is written.
4. Execution continues with the next module.
5. If ALL modules fail → scan status becomes `"failed"`.

### AI Failure Graceful Degradation

If the AI provider API returns a non-2xx response or throws a network error:
1. The vulnerability record is returned with null `ai_score`, `ai_description`, `ai_remediation`.
2. The failure is written to `activity_logs` with event type `"ai_service_failure"`.
3. The frontend renders raw vulnerability data with a "AI explanation unavailable" notice.

### Database Connection Failures

Knex.js connection pool is configured with retry logic (3 retries, 500ms delay). If the pool is exhausted, Express returns HTTP 503 with a `Retry-After: 30` header.

---

## Testing Strategy

### Dual Testing Approach

WebShield uses a layered testing strategy combining unit tests, property-based tests, integration tests, and smoke tests.

**Unit Tests (Jest + Supertest):**
- Specific examples and edge cases for all service functions
- Auth flows (register, login, logout, password reset)
- Scan lifecycle state machine transitions
- Individual scan module classification logic (pure functions)
- AI score bounds and summary truncation
- Rate limiter middleware behavior

**Property-Based Tests (fast-check for Node.js / Jest):**
- Selected property tests run with a **minimum of 100 iterations** each
- Each test is tagged with a comment referencing the design property:
  ```javascript
  // Feature: webshield, Property 1: Password hash strength
  ```
- See the Correctness Properties section for the full list of properties to implement

**Integration Tests (Jest + test PostgreSQL instance):**
- Full API endpoint testing with a real database
- Scan lifecycle end-to-end (mock Nmap/ZAP/Puppeteer)
- Report generation (mock AI provider)
- Email notification dispatch (mock SMTP)
- Activity log persistence for all event types

**Smoke Tests:**
- Docker container starts successfully and migrations run
- Helmet.js headers present on all responses
- Environment variable validation at startup

### Property-Based Test Configuration

```javascript
// jest.config.js
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,  // allow for 100+ iterations
};

// Example property test structure
import * as fc from 'fast-check';

test('Property 2: duplicate email rejection', async () => {
  // Feature: webshield, Property 2: Registration uniqueness
  await fc.assert(
    fc.asyncProperty(
      fc.record({
        email: fc.emailAddress(),
        password: validPasswordArbitrary(),
        display_name: fc.string({ minLength: 2, maxLength: 100 }),
      }),
      async (input) => {
        await registerUser(input);
        const response = await registerUser(input);
        expect(response.status).toBe(409);
      }
    ),
    { numRuns: 100 }
  );
});
```

### Testing Scope per Module

| Module | Unit | Property | Integration |
|---|---|---|---|
| Auth_Service | ✓ | ✓ (Props 1–5) | ✓ |
| Role middleware | ✓ | ✓ (Props 4–5) | ✓ |
| Profile management | ✓ | ✓ (Prop 6) | ✓ |
| Scanner_Engine | ✓ | ✓ (Props 7–9) | ✓ |
| HttpHeaderModule | ✓ | ✓ (Prop 10) | — |
| SslTlsModule | ✓ | ✓ (Prop 11) | — |
| PortScanModule | ✓ | ✓ (Prop 12) | ✓ (Nmap mock) |
| CrawlerModule | ✓ | — | ✓ (Puppeteer mock) |
| SqlInjectionModule | ✓ | ✓ (Prop 13) | ✓ (ZAP mock) |
| XssModule | ✓ | ✓ (Prop 14) | ✓ (Puppeteer mock) |
| DirectoryDiscovery | ✓ | ✓ (Prop 15) | — |
| SensitiveInfoModule | ✓ | ✓ (Prop 16) | — |
| CookieSecurityModule | ✓ | ✓ (Prop 17) | — |
| AI_Assistant | ✓ | ✓ (Props 19–21) | ✓ (AI mock) |
| Report_Generator | ✓ | ✓ (content props) | ✓ |
| Rate_Limiter | ✓ | ✓ (Prop 24) | ✓ |
| Activity_Log | ✓ | ✓ (Prop 25) | ✓ |

---

## Deployment and Docker Architecture

### Docker Compose Services

```yaml
# docker-compose.yml
version: '3.9'
services:

  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB:       webshield
      POSTGRES_USER:     ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER}"]
      interval: 5s
      retries: 5

  zap:
    image: ghcr.io/zaproxy/zaproxy:stable
    command: zap-webswing.sh
    environment:
      ZAP_PORT: "8080"
    ports:
      - "8080:8080"

  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    depends_on:
      postgres:
        condition: service_healthy
      zap:
        condition: service_started
    environment:
      NODE_ENV:          production
      DATABASE_URL:      postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/webshield
      JWT_SECRET:        ${JWT_SECRET}
      ZAP_API_URL:       http://zap:8080
      ZAP_API_KEY:       ${ZAP_API_KEY}
      OPENAI_API_KEY:    ${OPENAI_API_KEY}
      SMTP_HOST:         ${SMTP_HOST}
      SMTP_PORT:         ${SMTP_PORT}
      SMTP_USER:         ${SMTP_USER}
      SMTP_PASS:         ${SMTP_PASS}
      FRONTEND_URL:      ${FRONTEND_URL}
    ports:
      - "3001:3001"
    command: ["node", "dist/index.js"]

volumes:
  pgdata:
```

### Backend Dockerfile

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
# Install Nmap
RUN apk add --no-cache nmap nmap-scripts chromium
WORKDIR /app
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

### Database Migration on Startup

```typescript
// src/index.ts
import knex from './db';

async function main() {
  await knex.migrate.latest();   // runs all pending migrations
  console.log('Migrations complete');
  app.listen(process.env.PORT || 3001);
}
main().catch(console.error);
```

### Frontend Deployment (Vercel)

The React/Vite frontend is deployed as a static site to Vercel. No custom build configuration is required — Vite outputs to `dist/` which Vercel picks up automatically.

```
# vercel.json (optional — for SPA client-side routing)
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

Environment variable for frontend:
```
VITE_API_BASE_URL=https://api.your-railway-app.up.railway.app/api/v1
```

### Environment Variables

| Variable | Service | Description |
|---|---|---|
| `DATABASE_URL` | API | PostgreSQL connection string |
| `JWT_SECRET` | API | Secret for HS256 JWT signing (≥ 32 chars) |
| `JWT_EXPIRY` | API | Token lifetime (default: `24h`) |
| `ZAP_API_URL` | API | OWASP ZAP REST API base URL |
| `ZAP_API_KEY` | API | ZAP API authentication key |
| `OPENAI_API_KEY` | API | OpenAI API key (or `GEMINI_API_KEY`) |
| `SMTP_HOST` | API | SMTP server hostname |
| `SMTP_PORT` | API | SMTP server port |
| `SMTP_USER` | API | SMTP username |
| `SMTP_PASS` | API | SMTP password |
| `SMTP_FROM` | API | From address for outgoing emails |
| `FRONTEND_URL` | API | CORS allow-list origin |
| `NODE_ENV` | API | `development` / `production` |
| `VITE_API_BASE_URL` | Frontend | Backend API base URL |

---

## Sequence Diagrams

### Scan Lifecycle (Key Flow)

```
User          Frontend         API            Scanner_Engine    Modules
 │                │             │                   │              │
 │─── POST /scans ────────────►│                   │              │
 │                │             │─── createScan() ─►│              │
 │                │             │                   │──INSERT scan─►DB
 │                │             │◄── { scan_id } ───│              │
 │◄── 201 ────────────────────►│                   │              │
 │                │             │                   │              │
 │─── POST /scans/:id/start ──►│                   │              │
 │                │             │─── startScan() ──►│              │
 │                │             │                   │──status=running
 │                │             │                   │──for each module:
 │                │             │                   │──────────────►execute()
 │                │             │                   │◄─────────────findings
 │                │             │                   │──INSERT vulns►DB
 │                │             │                   │──progress update (10s)
 │                │             │                   │              │
 │                │             │                   │──status=completed
 │                │             │                   │──emit scan.completed event
 │                │             │                   │──────────────►Notification_Service
 │◄── SSE progress events ─────│◄─── progress ─────│              │
```

### Authentication Flow

```
Visitor       Frontend         Auth_Service        DB
  │               │                │               │
  │─ POST /register ─────────────►│               │
  │               │                │─ validate ───►│
  │               │                │─ bcrypt hash  │
  │               │                │─ INSERT user ►│
  │               │                │─ log event ──►│
  │◄── 201 ────────────────────────│               │
  │               │                │               │
  │─ POST /login ────────────────►│               │
  │               │                │─ SELECT user ►│
  │               │                │◄─ user record ─│
  │               │                │─ bcrypt.compare│
  │               │                │─ sign JWT     │
  │◄── { token } ─────────────────│               │
```
