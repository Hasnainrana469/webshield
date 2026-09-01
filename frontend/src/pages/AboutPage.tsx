import { Link } from 'react-router-dom';

const techStack = [
  { category: 'Frontend', items: ['React 19 + Vite', 'TypeScript', 'Tailwind CSS v4', 'TanStack Query v5', 'React Router v7', 'Recharts 3'] },
  { category: 'Backend', items: ['Node.js 20 LTS', 'Express 4', 'Knex.js', 'PostgreSQL 15', 'JWT + bcrypt'] },
  { category: 'Scan Tools', items: ['OWASP ZAP', 'Nmap', 'Puppeteer', 'Custom payloads'] },
  { category: 'Infrastructure', items: ['Docker + Docker Compose', 'Vercel (frontend)', 'Railway/Render (backend)'] },
];

export default function AboutPage() {
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

      <div className="max-w-4xl mx-auto px-4 py-16">
        {/* Hero */}
        <div className="text-center mb-16">
          <div className="inline-flex w-16 h-16 rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 items-center justify-center text-black font-bold text-2xl mb-6">
            W
          </div>
          <h1 className="text-4xl md:text-5xl font-bold text-white mb-4">About WebShield</h1>
          <p className="text-gray-400 text-lg max-w-2xl mx-auto">
            An AI-powered automated web security scanning platform built to BSIT/BSCS final-year project standards.
          </p>
        </div>

        {/* Mission */}
        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-8 mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Mission</h2>
          <p className="text-gray-400 leading-relaxed">
            WebShield exists to make professional-grade security testing accessible. By combining automated scanning modules, OWASP Top 10 classification, and AI-assisted remediation, it gives developers and security professionals actionable insights without requiring deep security expertise.
          </p>
        </div>

        {/* Features overview */}
        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-8 mb-8">
          <h2 className="text-xl font-semibold text-white mb-6">What WebShield Does</h2>
          <ul className="space-y-3">
            {[
              'Runs 9 specialized security scan modules against any HTTP/HTTPS target',
              'Maps all findings to OWASP Top 10 2021 categories',
              'Uses AI to explain vulnerabilities and provide step-by-step remediation',
              'Generates professional PDF and HTML security reports',
              'Provides role-based dashboards for users and administrators',
              'Sends email alerts for critical vulnerability discoveries',
              'Maintains a full audit log of all system events',
            ].map((item) => (
              <li key={item} className="flex items-start gap-3 text-gray-300 text-sm">
                <span className="text-cyan-400 mt-0.5 flex-shrink-0">✓</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* Tech stack */}
        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-8 mb-8">
          <h2 className="text-xl font-semibold text-white mb-6">Technology Stack</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {techStack.map((category) => (
              <div key={category.category}>
                <h3 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wider">{category.category}</h3>
                <ul className="space-y-1.5">
                  {category.items.map((item) => (
                    <li key={item} className="flex items-center gap-2 text-gray-300 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 flex-shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* CTA */}
        <div className="text-center backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-10">
          <h2 className="text-2xl font-bold text-white mb-3">Get started today</h2>
          <p className="text-gray-400 mb-6">Create a free account and run your first security scan in minutes.</p>
          <Link to="/register" className="inline-block px-8 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity">
            Create free account
          </Link>
        </div>
      </div>
    </div>
  );
}
