# Requirements Document

## Introduction

WebShield is an AI-powered automated web security scanning platform targeting BSIT/BSCS final year project standards. The system allows authenticated users to scan websites and web applications for common security vulnerabilities, analyze security configurations, receive AI-assisted remediation guidance, and generate professional security reports. The platform supports two roles — standard users and administrators — each with distinct dashboards, capabilities, and access controls. The system exposes a RESTful API, integrates with third-party tools (OWASP ZAP, Nmap, Puppeteer), and produces both PDF and HTML reports.

---

## Glossary

- **WebShield**: The web security scanning platform described in this document.
- **Scanner_Engine**: The backend subsystem responsible for orchestrating and executing all security scan modules.
- **Auth_Service**: The backend subsystem responsible for user registration, login, JWT issuance, and password management.
- **User**: A registered individual with the "user" role who can create and view their own scans and reports.
- **Admin**: A registered individual with the "admin" role who can manage all users, scans, and view system-wide statistics.
- **Scan**: A single security assessment job initiated against a target URL.
- **Vulnerability**: A specific security weakness discovered during a Scan, mapped to an OWASP Top 10 category.
- **Report**: A generated PDF or HTML document summarizing the findings of a completed Scan.
- **AI_Assistant**: The AI subsystem that explains vulnerabilities, scores risk, prioritizes findings, and generates executive summaries.
- **Risk_Level**: A severity classification assigned to a Vulnerability; one of: Informational, Low, Medium, High, or Critical.
- **OWASP_Category**: A vulnerability classification from the OWASP Top 10 list mapped to each Vulnerability finding.
- **JWT**: JSON Web Token used for stateless authentication between client and server.
- **Rate_Limiter**: A middleware component that restricts the number of requests a client can make within a defined time window.
- **Notification_Service**: The subsystem responsible for sending email notifications to users.
- **Report_Generator**: The subsystem responsible for producing PDF and HTML reports from scan results.
- **Activity_Log**: A persistent record of significant system events, user actions, and scan lifecycle changes.

---

## Requirements

### Requirement 1: User Registration and Authentication

**User Story:** As a visitor, I want to register and log in to WebShield, so that I can securely access my security scan data.

#### Acceptance Criteria

1. WHEN a visitor submits a registration form with a unique email, a valid password (8–128 characters containing at least one uppercase letter, one lowercase letter, one digit, and one special character), and a display name, THE Auth_Service SHALL create a new User account with the "user" role and return an HTTP 201 success response.
2. IF a visitor submits a registration form with an email that already exists in the database, THEN THE Auth_Service SHALL return an error response with HTTP status 409 and a descriptive message.
3. WHEN a user submits valid login credentials (email and password), THE Auth_Service SHALL issue a signed JWT with an expiry of 24 hours and return it in the response body.
4. IF a user submits invalid login credentials, THEN THE Auth_Service SHALL return an error response with HTTP status 401 without revealing which field is incorrect.
5. THE Auth_Service SHALL hash all passwords using bcrypt with a minimum cost factor of 12 before persisting them to the database.
6. WHEN a user requests a password reset for a registered email address, THE Auth_Service SHALL send a time-limited reset token (valid for 1 hour) to that email address. IF the email address is not registered, THE Auth_Service SHALL return an HTTP 404 response.
7. WHEN a user submits a valid reset token and a new password that meets the validity rules in criterion 1, THE Auth_Service SHALL update the stored password hash and invalidate the used token.
8. IF a user submits an expired or already-used reset token, THEN THE Auth_Service SHALL return an error response with HTTP status 400.
9. WHEN a user logs out, THE Auth_Service SHALL invalidate the active session token so that subsequent requests with that token are rejected.
10. IF a request is made to a protected endpoint using a token that was invalidated by logout, THEN THE Auth_Service SHALL return an error response with HTTP status 401.

---

### Requirement 2: Role-Based Access Control

**User Story:** As a system administrator, I want role-based access control, so that users can only access resources and actions permitted for their role.

#### Acceptance Criteria

1. THE Auth_Service SHALL assign exactly one role — either "user" or "admin" — to each registered account.
2. WHEN a request is received with a JWT whose role claim is "user", THE WebShield SHALL permit access only to endpoints designated for the "user" role.
3. WHEN a request is received with a JWT whose role claim is "admin", THE WebShield SHALL permit access to all endpoints designated for both the "user" role and the "admin" role.
4. IF a request is received with a token that is absent, malformed, unparseable, expired, or carries an invalid signature, THEN THE WebShield SHALL return an error response with HTTP status 401.
5. IF a request is received with a structurally valid, non-expired JWT whose role claim ("user" or "admin") does not grant access to the requested endpoint, THEN THE WebShield SHALL return an error response with HTTP status 403.
6. IF a request is received with a structurally valid, non-expired JWT whose role claim is a value other than "user" or "admin", THEN THE WebShield SHALL return an error response with HTTP status 403.

---

### Requirement 3: User Profile Management

**User Story:** As a user, I want to manage my profile, so that I can keep my account information current.

#### Acceptance Criteria

1. WHEN an authenticated user submits updated profile fields (display name between 2–100 characters, or email in valid RFC 5322 format), THE Auth_Service SHALL validate the fields and persist the changes to the Users table and return HTTP 200.
2. IF an authenticated user submits a profile update with an email already assigned to another account, THEN THE Auth_Service SHALL return an error response with HTTP status 409.
3. IF an authenticated user submits a profile update with an invalid email format or a display name outside the 2–100 character range, THEN THE Auth_Service SHALL return an error response with HTTP status 422.
4. WHEN an authenticated user submits a current password and a new password that meets the validity rules from Requirement 1 criterion 1, THE Auth_Service SHALL verify the current password and update the stored hash if verification succeeds.
5. IF the current password submitted during a password change does not match the stored hash, THEN THE Auth_Service SHALL return an error response with HTTP status 400.
6. IF the new password submitted during a password change does not meet the validity rules from Requirement 1 criterion 1, THEN THE Auth_Service SHALL return an error response with HTTP status 422.

---

### Requirement 4: Scan Lifecycle Management

**User Story:** As a user, I want to create, start, monitor, and stop security scans, so that I can assess the security posture of target websites on demand.

#### Acceptance Criteria

1. WHEN an authenticated user submits a scan creation request with a valid HTTP/HTTPS target URL (reachable public host, no private/loopback addresses) and at least one selected scan module, THE Scanner_Engine SHALL create a Scan record with status "pending" and return the scan ID with HTTP 201.
2. IF an authenticated user submits a scan creation request with a malformed URL, a non-HTTP/HTTPS scheme, a private/loopback IP, or zero selected modules, THEN THE Scanner_Engine SHALL return an error response with HTTP status 422 and a message identifying the invalid field.
3. WHEN an authenticated user requests to start a Scan that is in "pending" status, THE Scanner_Engine SHALL transition the Scan status to "running" and begin executing the selected modules sequentially.
4. IF an authenticated user requests to start a Scan that is not in "pending" status, THEN THE Scanner_Engine SHALL return an error response with HTTP status 409 and a message indicating the current status.
5. WHEN all selected scan modules complete execution, THE Scanner_Engine SHALL transition the Scan status to "completed" and record the completion timestamp.
6. WHEN an authenticated user requests to stop a Scan that is in "running" status, THE Scanner_Engine SHALL terminate active module execution and transition the Scan status to "stopped".
7. IF an authenticated user requests to stop a Scan that is not in "running" status, THEN THE Scanner_Engine SHALL return an error response with HTTP status 409.
8. IF a scan module terminates before producing a result (unrecoverable error), THEN THE Scanner_Engine SHALL log the error to the Activity_Log, mark the module as "failed", and continue executing remaining modules.
9. WHILE a Scan is in "running" status, THE Scanner_Engine SHALL update the Scan's progress percentage in the database at least every 10 seconds.
10. THE Scanner_Engine SHALL enforce a maximum of 3 concurrent running Scans per User account.
11. IF an authenticated user requests to start a Scan while already having 3 running Scans, THEN THE Scanner_Engine SHALL return an error response with HTTP status 429 and a message indicating the concurrent scan limit.
12. IF all selected modules for a Scan are marked "failed", THEN THE Scanner_Engine SHALL transition the Scan status to "failed" instead of "completed".

---

### Requirement 5: HTTP Security Header Analysis

**User Story:** As a user, I want to scan a website's HTTP security headers, so that I can identify missing or misconfigured headers that weaken the site's security posture.

#### Acceptance Criteria

1. WHEN the HTTP Security Header Analysis module is executed against a target URL, THE Scanner_Engine SHALL retrieve the HTTP response headers from the target URL and evaluate the presence and configuration of: Content-Security-Policy, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security, Referrer-Policy, and Permissions-Policy.
2. WHEN a required security header is absent from the target URL's response, THE Scanner_Engine SHALL create a Vulnerability record with the header name, a description of the risk, and an assigned Risk_Level.
3. WHEN a security header is present but its value does not meet the minimum recommended configuration, THE Scanner_Engine SHALL create a Vulnerability record describing the misconfiguration and the recommended value.
4. THE Scanner_Engine SHALL assign Risk_Level "Medium" to absent or misconfigured Content-Security-Policy headers and Risk_Level "Low" to absent or misconfigured Referrer-Policy headers.
5. WHEN the HTTP Security Header Analysis module completes, THE Scanner_Engine SHALL map each Vulnerability to the appropriate OWASP_Category.

---

### Requirement 6: SSL/TLS Security Analysis

**User Story:** As a user, I want to analyze a target's SSL/TLS configuration, so that I can identify certificate issues and weak protocol versions.

#### Acceptance Criteria

1. WHEN the SSL/TLS Analysis module is executed against a target URL, THE Scanner_Engine SHALL verify whether the target is accessible over HTTPS.
2. IF the target URL is accessible only over HTTP without a redirect to HTTPS, THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "High".
3. WHEN the SSL/TLS Analysis module connects to the target over HTTPS, THE Scanner_Engine SHALL retrieve the TLS certificate and evaluate: issuer validity, expiration date, and negotiated TLS protocol version.
4. IF the TLS certificate expiration date is within 30 days of the scan date, THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Medium" indicating imminent expiration.
5. IF the TLS certificate is already expired at the time of the scan, THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "High".
6. IF the negotiated TLS version is TLS 1.0 or TLS 1.1, THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Medium" recommending upgrade to TLS 1.2 or higher.
7. WHEN the SSL/TLS Analysis module completes, THE Scanner_Engine SHALL map each Vulnerability to the appropriate OWASP_Category.

---

### Requirement 7: Port Scanning

**User Story:** As a user, I want to scan open ports on a target host, so that I can identify unnecessary exposed services that increase the attack surface.

#### Acceptance Criteria

1. WHEN the Port Scanning module is executed against a target host, THE Scanner_Engine SHALL invoke Nmap to identify open ports, associated services, and service version information.
2. WHEN Nmap returns results, THE Scanner_Engine SHALL persist each discovered open port as a structured finding associated with the Scan record.
3. IF an open port is identified as running a service associated with a known high-risk exposure (e.g., Telnet on port 23, FTP on port 21), THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "High".
4. WHEN the Port Scanning module completes, THE Scanner_Engine SHALL map each Vulnerability to the appropriate OWASP_Category.
5. THE Scanner_Engine SHALL enforce a timeout of 300 seconds for the Nmap execution; IF the timeout is exceeded, THEN THE Scanner_Engine SHALL record the module as timed out and continue with remaining modules.

---

### Requirement 8: Website Crawling

**User Story:** As a user, I want the scanner to crawl a target website, so that all reachable URLs, forms, and parameters are discovered and available for deeper analysis.

#### Acceptance Criteria

1. WHEN the Website Crawling module is executed against a target URL, THE Scanner_Engine SHALL use Puppeteer to discover all reachable internal URLs within the same domain up to a crawl depth of 5.
2. WHEN the Website Crawling module discovers a web form, THE Scanner_Engine SHALL record the form action URL, method (GET/POST), and all input field names.
3. WHEN the Website Crawling module completes, THE Scanner_Engine SHALL persist the discovered site map (list of URLs, forms, and parameters) as structured data associated with the Scan record.
4. THE Scanner_Engine SHALL enforce a maximum of 500 URLs per crawl session to prevent unbounded execution time.
5. IF the Website Crawling module exceeds 500 discovered URLs, THE Scanner_Engine SHALL stop crawling, persist the discovered URLs so far, and record a warning in the Activity_Log.

---

### Requirement 9: SQL Injection Detection

**User Story:** As a user, I want the scanner to test for SQL injection vulnerabilities, so that I can identify input fields susceptible to database attacks.

#### Acceptance Criteria

1. WHEN the SQL Injection Detection module is executed, THE Scanner_Engine SHALL test each discovered form parameter and URL query parameter using both the OWASP ZAP API and a custom payload set including error-based and time-based payloads.
2. WHEN a SQL injection payload produces a database error message in the HTTP response, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Critical" and include the triggering parameter name and payload in the record.
3. WHEN a time-based SQL injection payload causes a response delay of 5 seconds or more beyond the baseline response time, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Critical".
4. WHEN the SQL Injection Detection module completes, THE Scanner_Engine SHALL map each Vulnerability to OWASP_Category "A03:2021 – Injection".

---

### Requirement 10: XSS Detection

**User Story:** As a user, I want the scanner to detect Cross-Site Scripting vulnerabilities, so that I can find parameters where attacker-controlled scripts could be executed in a victim's browser.

#### Acceptance Criteria

1. WHEN the XSS Detection module is executed, THE Scanner_Engine SHALL test each discovered parameter for Reflected XSS by injecting XSS payloads and inspecting the HTTP response body for the payload appearing unencoded.
2. WHEN the XSS Detection module detects a Reflected XSS vulnerability, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "High", including a Proof-of-Concept URL containing the triggering payload.
3. WHEN the XSS Detection module is executed, THE Scanner_Engine SHALL test URL fragment parameters and JavaScript-sink parameters for DOM-based XSS by injecting payloads and using Puppeteer to evaluate whether the payload executes in the browser context.
4. WHEN the XSS Detection module detects a DOM-based XSS vulnerability, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "High", including a Proof-of-Concept payload.
5. WHEN the XSS Detection module completes, THE Scanner_Engine SHALL map each Vulnerability to OWASP_Category "A03:2021 – Injection".

---

### Requirement 11: Directory and File Discovery

**User Story:** As a user, I want the scanner to discover exposed directories and sensitive files, so that I can identify unintentionally accessible resources on the target server.

#### Acceptance Criteria

1. WHEN the Directory and File Discovery module is executed, THE Scanner_Engine SHALL probe the target for a predefined list of paths including: /admin, /wp-admin, /.env, /.git/config, /backup, /config, /robots.txt, /sitemap.xml, and common backup file extensions (.bak, .old, .sql).
2. WHEN a probed path returns an HTTP status code of 200 or 403, THE Scanner_Engine SHALL create a Vulnerability record noting the discovered path and its HTTP status code with Risk_Level "Low".
3. IF a probed path from the sensitive file set (/.env, /.git/config, *.sql, *.bak, *.old) returns HTTP status 200, THEN THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Critical" instead of "Low".
4. WHEN the Directory and File Discovery module completes, THE Scanner_Engine SHALL map each Vulnerability to OWASP_Category "A05:2021 – Security Misconfiguration".

---

### Requirement 12: Sensitive Information Exposure Detection

**User Story:** As a user, I want the scanner to detect sensitive information in HTTP responses, so that I can find unintentionally exposed secrets or debug data.

#### Acceptance Criteria

1. WHEN the Sensitive Information Exposure module is executed, THE Scanner_Engine SHALL inspect HTTP response bodies and headers from crawled URLs using regex patterns to detect: API keys, email addresses, internal IP addresses (RFC 1918 ranges), stack traces, and debug information.
2. WHEN an API key pattern is matched in a response, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Critical", including the source URL and the matched pattern type (not the key value).
3. WHEN an internal IP address or email address is detected in a response, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Low" and include the source URL.
4. WHEN a stack trace or debug information is detected in a response, THE Scanner_Engine SHALL create a Vulnerability record with Risk_Level "Medium" and include the source URL.
5. WHEN the Sensitive Information Exposure module completes, THE Scanner_Engine SHALL map API key and credential findings to OWASP_Category "A02:2021 – Cryptographic Failures" and map stack trace and debug information findings to OWASP_Category "A05:2021 – Security Misconfiguration".

---

### Requirement 13: Cookie Security Analysis

**User Story:** As a user, I want the scanner to analyze cookie security attributes, so that I can identify cookies that are vulnerable to theft or cross-site misuse.

#### Acceptance Criteria

1. WHEN the Cookie Security Analysis module is executed, THE Scanner_Engine SHALL retrieve all cookies set by the target URL and evaluate each cookie for the presence of the HttpOnly, Secure, and SameSite attributes.
2. WHEN a cookie whose name matches (case-insensitive) any of the patterns "session", "auth", "token", or "sid" is missing the HttpOnly attribute, THE Scanner_Engine SHALL create one Vulnerability record per affected cookie with Risk_Level "Medium".
3. WHEN a cookie is missing the Secure attribute and the target supports HTTPS, THE Scanner_Engine SHALL create one Vulnerability record per affected cookie with Risk_Level "Low".
4. WHEN a cookie is missing the SameSite attribute, THE Scanner_Engine SHALL create one Vulnerability record per affected cookie with Risk_Level "Low".
5. WHEN the Cookie Security Analysis module completes, THE Scanner_Engine SHALL map each Vulnerability to OWASP_Category "A07:2021 – Identification and Authentication Failures".

---

### Requirement 14: OWASP Top 10 Mapping

**User Story:** As a user, I want all discovered vulnerabilities mapped to OWASP Top 10 categories, so that I can communicate findings using the industry-standard classification.

#### Acceptance Criteria

1. WHEN a Scan transitions to "completed" status, THE Scanner_Engine SHALL verify that every Vulnerability record associated with that Scan has an OWASP_Category value assigned.
2. THE Scanner_Engine SHALL support mapping to all ten categories from the OWASP Top 10 2021 list.
3. IF a Vulnerability record cannot be mapped to a specific OWASP_Category, THEN THE Scanner_Engine SHALL assign the value "Unclassified" to that record's OWASP_Category field.
4. WHEN a Scan is completed, THE WebShield SHALL produce an aggregated count of Vulnerability records grouped by OWASP_Category and persist it with the Scan record.

---

### Requirement 15: AI Security Assistant

**User Story:** As a user, I want an AI assistant to explain vulnerabilities and recommend remediations, so that I can understand findings and act on them without needing deep security expertise.

#### Acceptance Criteria

1. WHEN a user requests an explanation for a specific Vulnerability record, THE AI_Assistant SHALL return a plain-language description of the vulnerability, its potential impact, and step-by-step remediation recommendations.
2. THE AI_Assistant SHALL assign a numeric risk score between 0 and 10 to each Vulnerability record, where 0 represents no risk and 10 represents maximum risk, based on the vulnerability type, affected component, and contextual factors.
3. WHEN a Scan is completed, THE AI_Assistant SHALL generate an executive summary of no more than 500 words that describes the overall security posture, the most critical findings, and prioritized remediation actions.
4. WHEN a Scan contains more than one Vulnerability, THE AI_Assistant SHALL produce a prioritized list of Vulnerability records ordered by risk score descending.
5. IF the AI_Assistant cannot generate a response due to a downstream API failure, THEN THE WebShield SHALL display the raw vulnerability data without an AI summary and log the failure to the Activity_Log.

---

### Requirement 16: Report Generation

**User Story:** As a user, I want to generate and download professional security reports, so that I can share scan findings with stakeholders in a polished, readable format.

#### Acceptance Criteria

1. WHEN an authenticated user requests a report for a completed Scan, THE Report_Generator SHALL produce a report in both PDF and HTML formats containing: scan metadata, target URL, scan date and duration, list of all Vulnerabilities with severity ratings, remediation recommendations, risk summary, and the AI executive summary.
2. WHEN the Report_Generator produces a PDF report, THE Report_Generator SHALL embed screenshots captured by Puppeteer during the scan for any Vulnerability that has an associated screenshot.
3. WHEN an authenticated user requests to download a report, THE Report_Generator SHALL return the file as a binary download with the appropriate Content-Type header (application/pdf or text/html).
4. THE Report_Generator SHALL complete report generation within 60 seconds for a Scan containing up to 100 Vulnerability records.
5. IF the Report_Generator fails to produce a report within 60 seconds, THEN THE WebShield SHALL return an error response with HTTP status 504 and log the failure to the Activity_Log.
6. WHEN a report is successfully generated, THE WebShield SHALL persist a Report record containing the scan ID, format, file path, and generation timestamp.

---

### Requirement 17: User Dashboard

**User Story:** As a user, I want a personalized dashboard, so that I can monitor my scan activity and vulnerability trends at a glance.

#### Acceptance Criteria

1. WHEN an authenticated user with the "user" role loads the dashboard, THE WebShield SHALL display: total scan count, total vulnerability count, critical vulnerability count, and a list of the 5 most recent Scans.
2. THE WebShield SHALL render a Risk Distribution Chart showing the count of Vulnerabilities grouped by Risk_Level for the authenticated user's scans.
3. THE WebShield SHALL render a Scan Activity Timeline chart showing the number of Scans initiated per day over the most recent 30-day period.
4. WHILE dashboard data is loading from the API, THE WebShield SHALL display loading skeleton components in place of each data panel.

---

### Requirement 18: Admin Dashboard and User Management

**User Story:** As an administrator, I want a system-wide dashboard and user management tools, so that I can monitor platform usage and manage user accounts.

#### Acceptance Criteria

1. WHEN an authenticated user with the "admin" role loads the admin dashboard, THE WebShield SHALL display: total registered user count, total scan count across all users, vulnerability statistics aggregated across all scans, and a paginated Activity_Log viewer.
2. WHEN an admin requests the user list, THE WebShield SHALL return a paginated list of all Users including display name, email, role, account creation date, and total scan count.
3. WHEN an admin submits a role change for a User, THE Auth_Service SHALL update the user's role and record the change in the Activity_Log.
4. WHEN an admin submits a request to deactivate a User account, THE Auth_Service SHALL prevent the deactivated user from authenticating and record the action in the Activity_Log.
5. IF an admin attempts to deactivate their own account, THEN THE Auth_Service SHALL return an error response with HTTP status 400.

---

### Requirement 19: Email Notifications

**User Story:** As a user, I want to receive email notifications for scan events, so that I can stay informed without having to actively monitor the platform.

#### Acceptance Criteria

1. WHEN a Scan transitions to "completed" status, THE Notification_Service SHALL send an email to the scan owner containing the scan target URL, completion time, total vulnerability count, and critical vulnerability count.
2. WHEN a Scan produces a Vulnerability with Risk_Level "Critical", THE Notification_Service SHALL send an immediate email alert to the scan owner describing the critical finding and the affected URL.
3. IF the Notification_Service fails to deliver an email after 3 retry attempts, THEN THE Notification_Service SHALL log the failure to the Activity_Log and cease retrying.
4. WHERE a user has disabled email notifications in their profile settings, THE Notification_Service SHALL not send any emails to that user.

---

### Requirement 20: Activity Logging

**User Story:** As an administrator, I want all significant system actions recorded in an activity log, so that I can audit user behavior and diagnose system issues.

#### Acceptance Criteria

1. THE WebShield SHALL create an Activity_Log record for each of the following events: user registration, user login, user logout, scan creation, scan start, scan stop, scan completion, report generation, admin role change, and admin account deactivation.
2. EACH Activity_Log record SHALL contain: event type, actor user ID, target resource ID (if applicable), timestamp, and a human-readable description.
3. WHEN an admin queries the Activity_Log, THE WebShield SHALL return results paginated at 50 records per page, ordered by timestamp descending.

---

### Requirement 21: API Security and Rate Limiting

**User Story:** As a system operator, I want the API secured against abuse and common attacks, so that the platform remains available and trustworthy.

#### Acceptance Criteria

1. THE WebShield SHALL apply Helmet.js middleware to all API responses to set secure HTTP response headers.
2. THE Rate_Limiter SHALL restrict unauthenticated requests to a maximum of 20 requests per minute per IP address.
3. THE Rate_Limiter SHALL restrict authenticated requests to a maximum of 100 requests per minute per user account.
4. IF a client exceeds the applicable rate limit, THEN THE Rate_Limiter SHALL return an error response with HTTP status 429 and a Retry-After header indicating the number of seconds until the limit resets.
5. THE WebShield SHALL sanitize all user-supplied string inputs using a server-side input sanitization library before persisting them or using them in database queries.
6. THE WebShield SHALL use parameterized queries for all database interactions to prevent SQL injection in the application layer itself.
7. THE WebShield SHALL set the Secure, HttpOnly, and SameSite=Strict attributes on all authentication cookies.

---

### Requirement 22: Frontend UI and Navigation

**User Story:** As a user, I want a modern, responsive interface with intuitive navigation, so that I can use the platform efficiently on any device.

#### Acceptance Criteria

1. THE WebShield SHALL implement the following pages accessible via client-side routing: Landing, Features, About, Login, Register, User Dashboard, Scan Management, Scan Details, Vulnerability Details, Reports, Settings, and Admin Panel.
2. WHILE a user is authenticated, THE WebShield SHALL render a sidebar navigation and a top navigation bar providing access to all role-appropriate pages.
3. THE WebShield SHALL implement a dark theme using a Navy/Black/Neon Blue/Cyber Green color palette with Glassmorphism card styling.
4. THE WebShield SHALL display loading animations (skeleton loaders or spinners) for all data-fetching operations that take longer than 200 milliseconds.
5. WHEN the viewport width is below 768 pixels, THE WebShield SHALL collapse the sidebar into a hamburger menu and adapt all layouts to a single-column mobile-friendly format.

---

### Requirement 23: Scan Results and Vulnerability Details

**User Story:** As a user, I want to view detailed scan results and individual vulnerability information, so that I can understand each finding and plan remediation steps.

#### Acceptance Criteria

1. WHEN a user navigates to a Scan Details page, THE WebShield SHALL display: scan status, target URL, start and end timestamps, scan duration, progress percentage (if running), list of executed modules with their individual status, and a sortable/filterable table of all associated Vulnerability records.
2. WHEN a user selects a Vulnerability record from the table, THE WebShield SHALL navigate to the Vulnerability Details page displaying: vulnerability name, OWASP_Category, Risk_Level, affected URL or parameter, AI-generated description and remediation steps, risk score, and any associated Proof-of-Concept or screenshot.
3. THE WebShield SHALL allow the user to filter the Vulnerability table by Risk_Level and OWASP_Category.
4. THE WebShield SHALL allow the user to sort the Vulnerability table by risk score, Risk_Level, and discovery timestamp.

---

### Requirement 24: Deployment and Docker Support

**User Story:** As a developer, I want the application to be deployable via Docker and compatible with Vercel and Railway/Render, so that the platform can be set up consistently across environments.

#### Acceptance Criteria

1. THE WebShield SHALL include a Dockerfile for the backend service that produces a runnable container image.
2. THE WebShield SHALL include a docker-compose.yml file that defines services for: the backend API, the PostgreSQL database, and any required auxiliary services.
3. WHEN the backend container starts, THE WebShield SHALL run all pending database migrations automatically before accepting API requests.
4. THE WebShield frontend SHALL be deployable to Vercel using standard Vite build output without custom build configuration modifications.
5. THE WebShield SHALL read all environment-specific configuration values (database credentials, JWT secret, API keys, SMTP settings) from environment variables and SHALL NOT hard-code any credentials in source files.

---

### Requirement 25: Documentation

**User Story:** As an academic evaluator, I want comprehensive project documentation, so that I can assess the design quality, completeness, and professional standard of the project.

#### Acceptance Criteria

1. THE WebShield project SHALL include a Software Requirements Specification (SRS) document.
2. THE WebShield project SHALL include a Software Design Document (SDD) containing an Architecture Diagram, ER Diagram, Use Case Diagram, and Sequence Diagrams for key flows.
3. THE WebShield project SHALL include API documentation listing all endpoints, HTTP methods, request/response schemas, and authentication requirements.
4. THE WebShield project SHALL include a User Manual describing how to register, configure, and use the scanning features.
5. THE WebShield project SHALL include an Installation Guide covering local setup, Docker setup, and deployment to Vercel and Railway/Render.
