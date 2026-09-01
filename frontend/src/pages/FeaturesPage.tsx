import { Link } from 'react-router-dom';

const modules = [
  {
    icon: '🔒',
    name: 'HTTP Security Header Analysis',
    category: 'A05:2021 – Security Misconfiguration',
    riskRange: 'Low – Medium',
    desc: 'Fetches target HTTP response headers and evaluates six critical security headers: Content-Security-Policy, X-Frame-Options, X-XSS-Protection, Strict-Transport-Security, Referrer-Policy, and Permissions-Policy. Both absent and misconfigured headers are flagged.',
    findings: ['Missing Content-Security-Policy', 'Absent HSTS header', 'Misconfigured X-Frame-Options'],
  },
  {
    icon: '🔐',
    name: 'SSL/TLS Security Analysis',
    category: 'A02:2021 – Cryptographic Failures',
    riskRange: 'Medium – High',
    desc: 'Connects to the target over HTTPS using Node.js built-in TLS module. Evaluates certificate validity, expiration date (warns within 30 days), and negotiated protocol version (TLS 1.0/1.1 flagged).',
    findings: ['Expired certificate', 'Expiring within 30 days', 'TLS 1.0/1.1 in use', 'No HTTPS redirect'],
  },
  {
    icon: '🌐',
    name: 'Port Scanning',
    category: 'A05:2021 – Security Misconfiguration',
    riskRange: 'Low – High',
    desc: 'Invokes Nmap with service version detection against the target host. Parses XML output to identify open ports and services. High-risk services (FTP, Telnet, exposed databases) are flagged as High severity.',
    findings: ['Open Telnet port 23', 'Exposed MySQL on 3306', 'Open FTP port 21'],
  },
  {
    icon: '🕷️',
    name: 'Website Crawling',
    category: 'Information Gathering',
    riskRange: 'N/A (Discovery)',
    desc: 'Uses Puppeteer in headless mode to crawl the target up to depth 5, capped at 500 URLs. Discovers all reachable URLs, web forms (action, method, fields), and provides the site map to downstream modules.',
    findings: ['Discovered URLs', 'Form parameters', 'Input fields for injection testing'],
  },
  {
    icon: '💉',
    name: 'SQL Injection Detection',
    category: 'A03:2021 – Injection',
    riskRange: 'Critical',
    desc: 'Dual-strategy detection: OWASP ZAP active scan combined with custom payload testing. Error-based payloads detect database error messages in responses; time-based payloads detect response delays of 5+ seconds.',
    findings: ['Error-based SQL injection', 'Time-based blind injection', 'ZAP-detected injection points'],
  },
  {
    icon: '⚡',
    name: 'XSS Detection',
    category: 'A03:2021 – Injection',
    riskRange: 'High',
    desc: 'Tests all discovered parameters for Reflected XSS by injecting payloads and scanning response bodies for unencoded script tags. DOM XSS is detected using Puppeteer by monitoring window.alert() calls after injecting payloads into URL fragments.',
    findings: ['Reflected XSS in query parameter', 'DOM-based XSS in fragment', 'Script injection in form field'],
  },
  {
    icon: '📁',
    name: 'Directory & File Discovery',
    category: 'A05:2021 – Security Misconfiguration',
    riskRange: 'Low – Critical',
    desc: 'Probes a predefined wordlist including /admin, /wp-admin, /.env, /.git/config, /backup, and common backup file extensions. Sensitive files returning HTTP 200 are rated Critical; all other accessible paths are rated Low.',
    findings: ['Exposed .env file', 'Accessible /.git/config', 'Open /admin panel'],
  },
  {
    icon: '🔍',
    name: 'Sensitive Information Exposure',
    category: 'A02:2021 / A05:2021',
    riskRange: 'Low – Critical',
    desc: 'Iterates all crawled URLs and applies regex patterns against response bodies and headers to detect: API keys/credentials (Critical), stack traces and debug info (Medium), and internal IP addresses or email addresses (Low).',
    findings: ['API key in response body', 'Internal IP address exposed', 'Stack trace in error page'],
  },
  {
    icon: '🍪',
    name: 'Cookie Security Analysis',
    category: 'A07:2021 – Identification and Authentication Failures',
    riskRange: 'Low – Medium',
    desc: 'Fetches the target and parses Set-Cookie headers. Evaluates each cookie for HttpOnly, Secure, and SameSite attributes. Session-related cookies missing HttpOnly are rated Medium; missing Secure or SameSite attributes are rated Low.',
    findings: ['Session cookie missing HttpOnly', 'Cookie lacking SameSite attribute', 'Insecure cookie over HTTPS'],
  },
];

export default function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-200">
      {/* Nav */}
      <nav className="sticky top-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0a0f1e]/80 backdrop-blur-md border-b border-white/5">
        <Link to="/" className="flex items-center gap-2 font-semibold text-white">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-black text-sm">W</div>
          WebShield
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-gray-300 hover:text-white transition-colors">Sign in</Link>
          <Link to="/register" className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity">Get started</Link>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-16">
        <div className="text-center mb-14">
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">Scan Modules</h1>
          <p className="text-gray-400 max-w-2xl mx-auto text-lg">
            WebShield runs 9 specialized security modules, each targeting a distinct vulnerability class mapped to the OWASP Top 10 2021.
          </p>
        </div>

        <div className="space-y-6">
          {modules.map((mod, i) => (
            <div key={mod.name} className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-6 hover:border-white/20 transition-colors">
              <div className="flex items-start gap-4">
                <div className="text-3xl flex-shrink-0">{mod.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3 mb-2">
                    <span className="text-xs text-gray-500 font-mono">{String(i + 1).padStart(2, '0')}</span>
                    <h2 className="text-white font-semibold text-lg">{mod.name}</h2>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs">{mod.category}</span>
                    <span className="px-2 py-0.5 rounded-full bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 text-xs">Risk: {mod.riskRange}</span>
                  </div>
                  <p className="text-gray-400 text-sm leading-relaxed mb-4">{mod.desc}</p>
                  <div className="flex flex-wrap gap-2">
                    {mod.findings.map((f) => (
                      <span key={f} className="px-2.5 py-1 rounded-lg bg-white/5 text-gray-400 text-xs border border-white/5">
                        {f}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-14 text-center backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-10">
          <h2 className="text-2xl font-bold text-white mb-3">Try all 9 modules</h2>
          <p className="text-gray-400 mb-6">Create a free account and run your first scan today.</p>
          <Link to="/register" className="inline-block px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity">
            Get started free
          </Link>
        </div>
      </div>
    </div>
  );
}
