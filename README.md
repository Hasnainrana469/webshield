# WebShield

WebShield is a full-stack web security scanning platform. It provides authenticated users with URL validation, modular security scans, vulnerability tracking, AI-assisted explanations and summaries, report generation, activity logging, and administrator tools.

Only scan systems that you own or are explicitly authorized to test. Scanning third-party systems without permission may be illegal or disruptive.

## Contents

- [Architecture](#architecture)
- [Features](#features)
- [Requirements](#requirements)
- [Local setup](#local-setup)
- [Running the project](#running-the-project)
- [Docker setup](#docker-setup)
- [Configuration](#configuration)
- [Scan lifecycle](#scan-lifecycle)
- [Scanner modules](#scanner-modules)
- [API](#api)
- [Database](#database)
- [Reports and AI](#reports-and-ai)
- [Testing and builds](#testing-and-builds)
- [Troubleshooting](#troubleshooting)
- [Project structure](#project-structure)

## Architecture

| Layer | Technology |
| --- | --- |
| Frontend | React 19, Vite 8, TypeScript, Tailwind CSS v4, TanStack Query v5, React Router v7, Recharts |
| Backend | Node.js 20+, Express 4, TypeScript, Knex.js |
| Database | PostgreSQL 15+ locally or in Docker |
| Authentication | JWT with HS256, bcrypt password hashing, token blocklist |
| Scanning | Node.js modules, OWASP ZAP, Nmap, Puppeteer/Chromium |
| AI | OpenAI or Google Gemini, with a local fallback summary |
| Email | Nodemailer over SMTP, optional |
| Reports | HTML and PDF files stored in the configured reports directory |
| Deployment | Docker Compose, backend Docker image, Vercel-compatible frontend |

The frontend calls `/api/v1` through `frontend/src/lib/api.ts`. In local development, Vite serves port `5173` and proxies API requests to port `3001`. The backend runs pending Knex migrations before listening.

## Features

### User features

- Register, log in, log out, and reset passwords.
- JWT-protected dashboard and scan management.
- Create scans against public HTTP or HTTPS targets.
- Select one or more scan modules.
- Start, stop, inspect, and delete scans.
- View module progress and vulnerability findings.
- Filter findings by risk and sort them by severity, score, or discovery time.
- Request AI vulnerability explanations and executive summaries.
- Generate and download HTML and PDF reports.
- Update profile, password, and notification settings.
- Review personal activity history where available.

### Administrator features

- View system statistics.
- Browse all scans and users.
- View user details and activity logs.
- Change roles and deactivate users.

### Security controls

- Helmet security headers.
- CORS restricted by `FRONTEND_URL`.
- Unauthenticated and authenticated rate limiters.
- JWT claim validation and token revocation checks.
- Role guards for user and administrator routes.
- Request-body sanitization.
- Parameterized Knex queries.
- Target URL validation that rejects unsupported schemes and private/loopback addresses.
- HTML escaping in generated reports.

## Requirements

Required for local development:

- Node.js 20 or later.
- npm.
- PostgreSQL 15 or later.
- A PostgreSQL database and user matching `DATABASE_URL`.

Recommended for complete scanner coverage:

- Nmap on `PATH` for the port scan module.
- Chromium available to Puppeteer for crawling, DOM XSS checks, and PDF reports.
- OWASP ZAP on port `8080` for active SQL injection/XSS support.

Optional:

- An OpenAI or Gemini API key for AI-enhanced output.
- SMTP credentials for email notifications.

The application continues where possible when optional integrations are unavailable. Nmap, ZAP, and Chromium-dependent modules record their failures without stopping the other modules.

## Local setup

### Install dependencies

From the repository root:

```powershell
npm install
```

The root package uses npm workspaces for `backend` and `frontend`. Separate installation is also supported:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

### Configure the backend

```powershell
Copy-Item backend\.env.example backend\.env
```

Set a real PostgreSQL password and a strong JWT secret. Example values:

```env
DATABASE_URL=postgresql://postgres:<password>@localhost:5432/webshield
JWT_SECRET=<long-random-secret>
PORT=3001
FRONTEND_URL=http://localhost:5173
API_BASE_URL=http://localhost:3001
REPORTS_DIR=./reports
```

Never commit `.env` files or API keys.

### Create the database

Create a database named `webshield` using pgAdmin or PostgreSQL `psql`:

```powershell
psql -h localhost -U postgres -d postgres -c "CREATE DATABASE webshield"
```

If the database already exists, continue to migrations.

### Configure the frontend

The frontend example file is `frontend/.env.example`:

```env
VITE_API_BASE_URL=http://localhost:3001
```

The API client accepts either an API host or a URL ending in `/api/v1`.

## Running the project

Start PostgreSQL first, then run the backend and frontend in separate terminals.

### Windows

Terminal 1:

```powershell
cd "d:\Sccaner Project\backend"
npm.cmd run dev
```

Terminal 2:

```powershell
cd "d:\Sccaner Project\frontend"
npm.cmd run dev
```

If npm is not on `PATH`, use the repository-bundled runtime:

```powershell
& ".tools\node-v20.19.4-win-x64\npm.cmd" --prefix ".\backend" run dev
& ".tools\node-v20.19.4-win-x64\npm.cmd" --prefix ".\frontend" run dev
```

Open:

- Frontend: http://localhost:5173/
- Backend health: http://localhost:3001/health

The backend is ready after it prints `Migrations complete` and `WebShield API listening on port 3001`.

### Root workspace commands

```powershell
npm.cmd run dev:backend
npm.cmd run dev:frontend
npm.cmd run build:backend
npm.cmd run build:frontend
npm.cmd run test:backend
npm.cmd run migrate:latest
npm.cmd run migrate:rollback
```

Use `npm.cmd` in Windows PowerShell if execution policy blocks `npm.ps1`.

## Docker setup

The primary Compose file starts PostgreSQL, OWASP ZAP, the API, and an Nginx-served frontend:

```bash
cp .env.example .env
docker compose -f compose.yaml up -d --build
```

PowerShell:

```powershell
Copy-Item .env.example .env
docker compose -f compose.yaml up -d --build
```

Container URLs:

- Frontend: http://localhost:5173/
- API: http://localhost:3001/
- PostgreSQL: `localhost:5432`
- ZAP: http://localhost:8080/

Useful commands:

```bash
docker compose -f compose.yaml ps
docker compose -f compose.yaml logs -f api
docker compose -f compose.yaml logs -f frontend
docker compose -f compose.yaml down
docker compose -f compose.yaml down -v
```

The final command deletes PostgreSQL and report volumes. Use it only when local data can be removed.

The backend image installs Nmap and Chromium. The frontend image builds the Vite application and serves it through Nginx. `compose.yaml` is the primary documented stack; `compose.debug.yaml`, `docker-compose.yml`, and the files under `docker/` are supporting variants.

## Configuration

The complete templates are [.env.example](.env.example) and [backend/.env.example](backend/.env.example).

| Variable | Purpose | Required |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Yes |
| `TEST_DATABASE_URL` | Optional test database value | No |
| `JWT_SECRET` | JWT signing secret | Yes |
| `JWT_EXPIRY` | JWT lifetime, for example `86400` or `24h` | No |
| `PORT` | Backend port, normally `3001` | No |
| `FRONTEND_URL` | Allowed frontend origin | No |
| `API_BASE_URL` | Base URL used in report links | No |
| `VITE_API_BASE_URL` | Frontend API host at build/dev time | Yes for non-default hosts |
| `ZAP_API_URL` | ZAP API URL | No |
| `ZAP_API_KEY` | ZAP API key | No |
| `OPENAI_API_KEY` | OpenAI key | No |
| `GEMINI_API_KEY` | Gemini key | No |
| `AI_PROVIDER` | Selected AI provider where supported | No |
| `SMTP_HOST` | SMTP server | No |
| `SMTP_PORT` | SMTP port | No |
| `SMTP_SECURE` | SMTP TLS setting | No |
| `SMTP_USER` / `SMTP_PASS` | SMTP credentials | No |
| `SMTP_FROM` | Sender address | No |
| `REPORTS_DIR` | HTML/PDF report directory | No |

Docker service URLs must use service names such as `postgres` and `zap`, not `localhost`, for container-to-container communication.

## Scan lifecycle

1. The user submits a target URL and selected modules.
2. The backend validates the URL and rejects unsupported schemes and private/loopback targets.
3. A scan record and pending `scan_modules` rows are created.
4. The user starts the pending scan from the scan list or details page.
5. The orchestrator runs selected modules sequentially.
6. Each module is recorded as `running`, `completed`, `failed`, or `timed_out`.
7. Progress is persisted and reaches 100 percent at completion.
8. A failed module does not prevent later modules from running.
9. Findings are stored in `vulnerabilities` and receive OWASP categories.

The maximum concurrent scan count is three running scans per user. Scan details poll every five seconds while a scan is running.

## Scanner modules

| Module name | Purpose | Main dependency |
| --- | --- | --- |
| `http_headers` | Checks security response headers and configurations | Node fetch |
| `ssl_tls` | Checks TLS reachability, certificate expiry, and weak protocols | Node `tls` |
| `port_scan` | Finds open ports and services | Nmap |
| `crawler` | Discovers internal URLs and forms, depth 5 and up to 500 URLs | Puppeteer/Chromium |
| `sql_injection` | Tests discovered parameters with active and custom probes | ZAP, Node fetch |
| `xss` | Tests reflected and DOM-oriented XSS vectors | Node fetch, Puppeteer |
| `directory_discovery` | Probes common sensitive paths and files | Node fetch |
| `sensitive_info` | Searches response bodies and headers for credential/PII patterns | Node fetch |
| `cookie_security` | Checks HttpOnly, Secure, and SameSite attributes | Node fetch |

Module names are persisted in `selected_modules` and must match the backend `VALID_MODULES` list.

## API

The API base path is `/api/v1`. Protected endpoints require:

```http
Authorization: Bearer <jwt>
```

### Authentication

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account |
| `POST` | `/auth/login` | Receive a JWT |
| `POST` | `/auth/logout` | Revoke the current JWT |
| `POST` | `/auth/forgot-password` | Request a reset token |
| `POST` | `/auth/reset-password` | Set a new password |

### Users

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/users/me` | Read current profile |
| `PUT` | `/users/me` | Update profile |
| `PUT` | `/users/me/password` | Change password |
| `PUT` | `/users/me/settings` | Update notification settings |

### Scans and findings

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/scans` | Create a pending scan with `{ target_url, modules }` |
| `GET` | `/scans` | List the current user's scans |
| `GET` | `/scans/stats` | Dashboard totals, risk distribution, and scan activity |
| `GET` | `/scans/:id` | Read scan and module status |
| `POST` | `/scans/:id/start` | Start a pending scan |
| `POST` | `/scans/:id/stop` | Stop a running scan |
| `DELETE` | `/scans/:id` | Delete a finished scan |
| `GET` | `/scans/:id/vulnerabilities` | List filtered/sorted findings |
| `GET` | `/scans/:id/vulnerabilities/:vid` | Read one finding |
| `GET` | `/scans/:id/vulnerabilities/:vid/explain` | Get AI/fallback explanation |
| `GET` | `/scans/:id/summary` | Get an executive summary |
| `GET` | `/scans/:id/prioritized` | Get AI-prioritized findings |

### Reports

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/scans/:id/reports` | Generate HTML and PDF reports |
| `GET` | `/reports` | List the user's reports |
| `GET` | `/reports/:id/download/pdf` | Download a PDF report |
| `GET` | `/reports/:id/download/html` | Download an HTML report |

### Administrator endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/admin/stats` | System-wide statistics |
| `GET` | `/admin/scans` | All scans, paginated |
| `GET` | `/admin/users` | Users, paginated |
| `GET` | `/admin/users/:id` | User details |
| `PUT` | `/admin/users/:id/role` | Change a user's role |
| `PUT` | `/admin/users/:id/deactivate` | Deactivate a user |
| `GET` | `/admin/activity-logs` | Paginated activity log |

## Database

The nine Knex migrations in [backend/src/db/migrations](backend/src/db/migrations) create:

1. `users`
2. `password_reset_tokens`
3. `token_blocklist`
4. `scans`
5. `scan_modules`
6. `vulnerabilities`
7. `scan_site_maps`
8. `reports`
9. `activity_logs`

Run migrations manually:

```powershell
npm.cmd run migrate:latest
npm.cmd run migrate:rollback
```

The backend also runs `migrate.latest()` automatically during startup.

## Reports and AI

AI is optional. Without a provider key, or when a provider request fails, WebShield produces fallback explanations and summaries from stored findings.

PDF generation requires Puppeteer Chrome locally:

```powershell
cd backend
npx puppeteer browsers install chrome
```

The `REPORTS_DIR` directory must be writable and persistent in production. Docker stores reports in the `reports` volume.

## Testing and builds

Backend:

```powershell
npm.cmd run build:backend
npm.cmd run test:backend -- --runInBand
```

Frontend:

```powershell
npm.cmd run build:frontend
npm.cmd run lint --workspace=frontend
```

Basic smoke checks:

```powershell
curl.exe http://localhost:3001/health
curl.exe http://localhost:5173/
```

Expected results are HTTP `200` from both services. A complete smoke test should register or log in, create a scan, start it, poll `/scans/:id`, and confirm a terminal status.

## Troubleshooting

### Frontend shows HTTP 502

The API is unavailable. Check `curl.exe http://localhost:3001/health`, PostgreSQL status, `DATABASE_URL`, and port `3001`.

### PostgreSQL authentication fails

The credentials in `backend/.env` do not match the PostgreSQL service. Update the local database URL and restart the backend. Never document the real password in this file.

### The `webshield` database does not exist

Create it with pgAdmin or `psql`, then run `npm.cmd run migrate:latest`.

### A scan remains pending

Pending scans must be started from the scan list or details page. If the browser URL contains `/scans/undefined`, refresh the frontend and confirm scan responses use `scan_id`.

### Nmap reports `spawn nmap ENOENT`

Install Nmap and add it to `PATH`, or use the Docker backend image.

### Puppeteer cannot find Chrome

Run `npx puppeteer browsers install chrome`, or use the Docker image with Chromium installed.

### ZAP returns connection errors or 404

Start OWASP ZAP in daemon/API mode and verify `ZAP_API_URL`. Non-ZAP checks continue where possible.

### Dashboard values are zero

Confirm the authenticated `/api/v1/scans/stats` request returns HTTP `200`. Log out and back in after a database reset if the JWT is stale.

## Project structure

```text
backend/
  src/
    db/                 Knex connection and migrations
    middleware/         Auth, roles, rate limits, sanitization
    modules/            Security scanner implementations
    routes/             Express API route groups
    services/           Auth, scans, reports, AI, notifications, users
    utils/              Activity logging and validation helpers
  Dockerfile
  knexfile.js
  package.json
frontend/
  src/
    components/         Shared layouts and UI components
    contexts/            Authentication context
    lib/                API client
    pages/               Public, user, scan, report, and admin views
  package.json
  vite.config.ts
docker/
  Dockerfile.backend
  Dockerfile.frontend
compose.yaml              Primary full-stack Compose configuration
compose.debug.yaml         Debug Compose variant
Dockerfile                 Root frontend image definition
scripts/                   Database and project helper scripts
.env.example               Root configuration template
package.json               Workspace scripts
```

## Deployment notes

- Build and run the backend with [backend/Dockerfile](backend/Dockerfile).
- Build the frontend with [docker/Dockerfile.frontend](docker/Dockerfile.frontend) or deploy it to Vercel using [frontend/vercel.json](frontend/vercel.json).
- Use strong, unique production secrets.
- Use a managed PostgreSQL database or persistent database volume.
- Persist `REPORTS_DIR` if reports must survive container replacement.
- Set `FRONTEND_URL`, `API_BASE_URL`, and `VITE_API_BASE_URL` to deployed origins.
- Configure Nmap, Chromium, ZAP, AI, and SMTP for the deployment environment.
