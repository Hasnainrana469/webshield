import { Link } from 'react-router-dom';

const scanModules = [
  {
    icon: '🔒',
    name: 'HTTP Header Analysis',
    desc: 'Detects missing or misconfigured security headers like CSP, HSTS, and X-Frame-Options.',
    color: 'from-cyan-500/20 to-cyan-500/5',
    border: 'border-cyan-500/20',
  },
  {
    icon: '🔐',
    name: 'SSL/TLS Analysis',
    desc: 'Evaluates certificate validity, expiration, and negotiated protocol versions.',
    color: 'from-blue-500/20 to-blue-500/5',
    border: 'border-blue-500/20',
  },
  {
    icon: '🌐',
    name: 'Port Scanning',
    desc: 'Uses Nmap to discover open ports, exposed services, and version information.',
    color: 'from-purple-500/20 to-purple-500/5',
    border: 'border-purple-500/20',
  },
  {
    icon: '🕷️',
    name: 'Website Crawling',
    desc: 'Crawls up to 500 URLs using Puppeteer, mapping forms, parameters, and resources.',
    color: 'from-emerald-500/20 to-emerald-500/5',
    border: 'border-emerald-500/20',
  },
  {
    icon: '💉',
    name: 'SQL Injection Detection',
    desc: 'Tests all discovered parameters with OWASP ZAP and custom error/time-based payloads.',
    color: 'from-red-500/20 to-red-500/5',
    border: 'border-red-500/20',
  },
  {
    icon: '⚡',
    name: 'XSS Detection',
    desc: 'Probes for Reflected and DOM-based Cross-Site Scripting using Puppeteer and ZAP.',
    color: 'from-orange-500/20 to-orange-500/5',
    border: 'border-orange-500/20',
  },
  {
    icon: '📁',
    name: 'Directory Discovery',
    desc: 'Probes for exposed admin panels, .env files, backups, and sensitive directories.',
    color: 'from-yellow-500/20 to-yellow-500/5',
    border: 'border-yellow-500/20',
  },
  {
    icon: '🔍',
    name: 'Sensitive Info Exposure',
    desc: 'Scans response bodies for API keys, internal IPs, stack traces, and debug data.',
    color: 'from-pink-500/20 to-pink-500/5',
    border: 'border-pink-500/20',
  },
  {
    icon: '🍪',
    name: 'Cookie Security',
    desc: 'Analyzes cookie attributes: HttpOnly, Secure, and SameSite across all cookies.',
    color: 'from-teal-500/20 to-teal-500/5',
    border: 'border-teal-500/20',
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-[#0a0f1e] text-gray-200">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 py-4 bg-[#0a0f1e]/80 backdrop-blur-md border-b border-white/5">
        <div className="flex items-center gap-2 font-semibold text-white text-lg">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-black text-sm">
            W
          </div>
          WebShield
        </div>
        <div className="hidden md:flex items-center gap-6 text-sm text-gray-400">
          <Link to="/features" className="hover:text-white transition-colors">Features</Link>
          <Link to="/about" className="hover:text-white transition-colors">About</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/login" className="text-sm text-gray-300 hover:text-white transition-colors hidden sm:block">
            Sign in
          </Link>
          <Link
            to="/register"
            className="text-sm px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative flex flex-col items-center justify-center text-center pt-40 pb-24 px-4 overflow-hidden">
        {/* Glows */}
        <div className="absolute top-20 left-1/2 -translate-x-1/2 w-[600px] h-[600px] bg-cyan-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute top-40 left-1/4 w-64 h-64 bg-purple-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 max-w-4xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            AI-Powered Web Security Scanner
          </div>

          <h1 className="text-5xl md:text-7xl font-bold text-white leading-tight mb-6">
            Scan. Detect.{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
              Protect.
            </span>
          </h1>

          <p className="text-lg md:text-xl text-gray-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            WebShield automatically scans your web applications for vulnerabilities, maps findings to OWASP Top 10, and delivers AI-powered remediation guidance — in minutes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              to="/register"
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-base hover:opacity-90 transition-opacity shadow-lg shadow-cyan-500/25"
            >
              Start scanning free →
            </Link>
            <Link
              to="/features"
              className="px-8 py-3.5 rounded-xl backdrop-blur-md bg-white/5 border border-white/10 text-white font-semibold text-base hover:bg-white/10 transition-colors"
            >
              Explore features
            </Link>
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-white/5 bg-white/2 py-8">
        <div className="max-w-5xl mx-auto px-4 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          {[
            { value: '9', label: 'Scan Modules' },
            { value: 'OWASP', label: 'Top 10 Mapped' },
            { value: 'AI', label: 'Remediation' },
            { value: 'PDF/HTML', label: 'Reports' },
          ].map((stat) => (
            <div key={stat.label}>
              <div className="text-2xl font-bold text-white">{stat.value}</div>
              <div className="text-sm text-gray-400 mt-1">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Feature cards */}
      <section className="max-w-6xl mx-auto px-4 py-20">
        <div className="text-center mb-14">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            9 Powerful Scan Modules
          </h2>
          <p className="text-gray-400 max-w-xl mx-auto">
            Comprehensive vulnerability detection across every attack surface of your web application.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {scanModules.map((mod) => (
            <div
              key={mod.name}
              className={`relative backdrop-blur-md bg-gradient-to-br ${mod.color} border ${mod.border} rounded-xl p-6 hover:scale-[1.02] transition-transform duration-200`}
            >
              <div className="text-3xl mb-3">{mod.icon}</div>
              <h3 className="text-white font-semibold mb-2">{mod.name}</h3>
              <p className="text-gray-400 text-sm leading-relaxed">{mod.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-3xl mx-auto px-4 py-20 text-center">
        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-10">
          <h2 className="text-3xl font-bold text-white mb-4">
            Ready to secure your applications?
          </h2>
          <p className="text-gray-400 mb-8">
            Create a free account and run your first scan in under 5 minutes.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <Link
              to="/register"
              className="px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity"
            >
              Create free account
            </Link>
            <Link
              to="/login"
              className="px-8 py-3.5 rounded-xl backdrop-blur-md bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
            >
              Sign in
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 text-center text-sm text-gray-500">
        <p>© {new Date().getFullYear()} WebShield — AI-powered web security platform</p>
      </footer>
    </div>
  );
}
