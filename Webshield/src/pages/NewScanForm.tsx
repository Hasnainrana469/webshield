import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import api, { ApiError } from '../lib/api';
import GlassCard from '../components/ui/GlassCard';

const SCAN_MODULES = [
  { id: 'http_headers', label: 'HTTP Security Headers', desc: 'CSP, HSTS, X-Frame-Options, etc.' },
  { id: 'ssl_tls', label: 'SSL/TLS Analysis', desc: 'Certificate validity and protocol version' },
  { id: 'port_scan', label: 'Port Scanning', desc: 'Open ports and exposed services via Nmap' },
  { id: 'crawler', label: 'Website Crawling', desc: 'Discover all URLs, forms, and parameters' },
  { id: 'sql_injection', label: 'SQL Injection', desc: 'Error-based and time-based payload testing' },
  { id: 'xss', label: 'XSS Detection', desc: 'Reflected and DOM-based cross-site scripting' },
  { id: 'directory_discovery', label: 'Directory Discovery', desc: 'Admin panels, .env, backups, config files' },
  { id: 'sensitive_info', label: 'Sensitive Info Exposure', desc: 'API keys, IPs, stack traces in responses' },
  { id: 'cookie_security', label: 'Cookie Security', desc: 'HttpOnly, Secure, SameSite attributes' },
];

interface ScanCreateResponse {
  scan_id: string;
  status: string;
  target_url: string;
  created_at: string;
}

export default function NewScanForm() {
  const navigate = useNavigate();
  const [targetUrl, setTargetUrl] = useState('');
  const [selectedModules, setSelectedModules] = useState<Set<string>>(
    new Set(SCAN_MODULES.map((m) => m.id))
  );
  const [error, setError] = useState('');

  const createMutation = useMutation({
    mutationFn: (payload: { target_url: string; modules: string[] }) =>
      api.post<ScanCreateResponse>('/scans', payload),
    onSuccess: (data) => {
      navigate(`/scans/${data.scan_id}`);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Failed to create scan. Please try again.');
    },
  });

  const toggleModule = (moduleId: string) => {
    setSelectedModules((prev) => {
      const next = new Set(prev);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedModules.size === SCAN_MODULES.length) {
      setSelectedModules(new Set());
    } else {
      setSelectedModules(new Set(SCAN_MODULES.map((m) => m.id)));
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (!targetUrl.trim()) {
      setError('Please enter a target URL.');
      return;
    }
    if (selectedModules.size === 0) {
      setError('Please select at least one scan module.');
      return;
    }

    createMutation.mutate({
      target_url: targetUrl.trim(),
      modules: Array.from(selectedModules),
    });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">New Scan</h1>
        <p className="text-gray-400 text-sm mt-1">Configure and launch a security scan against a target URL</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {error && (
          <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">
            {error}
          </div>
        )}

        {/* Target URL */}
        <GlassCard>
          <label htmlFor="targetUrl" className="block text-sm font-medium text-gray-300 mb-2">
            Target URL <span className="text-red-400">*</span>
          </label>
          <input
            id="targetUrl"
            type="url"
            required
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://example.com"
            className="w-full px-4 py-3 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
          />
          <p className="mt-2 text-xs text-gray-500">Must be a reachable HTTP/HTTPS URL with a public hostname.</p>
        </GlassCard>

        {/* Modules */}
        <GlassCard>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-medium">Scan Modules</h2>
              <p className="text-gray-400 text-xs mt-0.5">{selectedModules.size} of {SCAN_MODULES.length} selected</p>
            </div>
            <button
              type="button"
              onClick={toggleAll}
              className="text-cyan-400 hover:text-cyan-300 text-xs font-medium transition-colors"
            >
              {selectedModules.size === SCAN_MODULES.length ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          <div className="space-y-2">
            {SCAN_MODULES.map((mod) => {
              const checked = selectedModules.has(mod.id);
              return (
                <label
                  key={mod.id}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer transition-colors ${checked ? 'bg-cyan-500/5 border border-cyan-500/20' : 'bg-white/3 border border-white/5 hover:bg-white/5'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleModule(mod.id)}
                    className="mt-0.5 w-4 h-4 rounded accent-cyan-500 flex-shrink-0"
                  />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${checked ? 'text-white' : 'text-gray-300'}`}>{mod.label}</p>
                    <p className="text-gray-500 text-xs mt-0.5">{mod.desc}</p>
                  </div>
                </label>
              );
            })}
          </div>
        </GlassCard>

        {/* Submit */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => navigate('/scans')}
            className="flex-1 py-3 rounded-xl border border-white/10 text-gray-300 hover:bg-white/5 transition-colors font-medium"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={createMutation.isPending}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {createMutation.isPending ? 'Creating...' : 'Create Scan'}
          </button>
        </div>
      </form>
    </div>
  );
}
