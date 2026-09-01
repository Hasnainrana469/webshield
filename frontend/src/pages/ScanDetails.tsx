import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { ApiError } from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import ScanStatusChip from '../components/ui/ScanStatusChip';
import RiskBadge from '../components/ui/RiskBadge';
import ProgressRing from '../components/ui/ProgressRing';

interface ScanModule {
  id: string;
  module_name: string;
  status: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

interface Scan {
  id: string;
  target_url: string;
  status: string;
  progress_pct: number;
  selected_modules: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  modules?: ScanModule[];
}

interface Vulnerability {
  id: string;
  name: string;
  risk_level: string;
  owasp_category: string;
  affected_url: string;
  affected_param: string;
  discovered_at: string;
}

interface VulnsResponse {
  data: Vulnerability[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

interface AiSummary {
  summary: string;
}

interface ReportResponse {
  report_id: string;
  pdf_url: string;
  html_url: string;
}

const RISK_LEVELS = ['critical', 'high', 'medium', 'low', 'informational'];

export default function ScanDetails() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const [vulnPage, setVulnPage] = useState(1);
  const [riskFilter, setRiskFilter] = useState('');
  const [owaspFilter] = useState('');
  const [sortBy, setSortBy] = useState('discovered_at');
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');

  const startMutation = useMutation({
    mutationFn: () => api.post(`/scans/${id}/start`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scan', id] });
      queryClient.invalidateQueries({ queryKey: ['scans'] });
    },
  });

  const { data: scan, isLoading: scanLoading } = useQuery<Scan>({
    queryKey: ['scan', id],
    queryFn: () => api.get<Scan>(`/scans/${id}`),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'running' ? 5000 : false;
    },
  });

  const vulnsQuery = `?page=${vulnPage}&per_page=20${riskFilter ? `&risk_level=${riskFilter}` : ''}${owaspFilter ? `&owasp=${encodeURIComponent(owaspFilter)}` : ''}&sort_by=${sortBy}&order=desc`;

  const { data: vulnsData, isLoading: vulnsLoading } = useQuery<VulnsResponse>({
    queryKey: ['vulns', id, vulnPage, riskFilter, owaspFilter, sortBy],
    queryFn: () => api.get<VulnsResponse>(`/scans/${id}/vulnerabilities${vulnsQuery}`),
    enabled: !!id,
  });

  const handleGetSummary = async () => {
    setAiLoading(true);
    setAiError('');
    try {
      const data = await api.get<AiSummary>(`/scans/${id}/summary`);
      setAiSummary(data.summary);
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : 'AI summary unavailable');
    } finally {
      setAiLoading(false);
    }
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setReportError('');
    try {
      await api.post<ReportResponse>(`/scans/${id}/reports`);
      queryClient.invalidateQueries({ queryKey: ['reports'] });
    } catch (err) {
      setReportError(err instanceof ApiError ? err.message : 'Failed to generate report');
    } finally {
      setReportLoading(false);
    }
  };

  const moduleLabel = (name: string) => name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  if (scanLoading) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <SkeletonLoader lines={3} height="h-8" />
        <SkeletonLoader lines={6} height="h-12" />
      </div>
    );
  }

  if (!scan) {
    return (
      <div className="max-w-5xl mx-auto">
        <GlassCard>
          <p className="text-red-400 text-center">Scan not found.</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link to="/scans" className="text-gray-400 hover:text-white text-sm transition-colors">← Scans</Link>
          </div>
          <h1 className="text-2xl font-bold text-white break-all">{scan.target_url}</h1>
          <p className="text-gray-400 text-sm mt-1">Started {scan.created_at ? new Date(scan.created_at).toLocaleString() : '—'}</p>
        </div>
        <div className="flex items-center gap-3">
          <ScanStatusChip status={scan.status} />
          {scan.status === 'running' && (
            <ProgressRing percentage={scan.progress_pct} size={60} strokeWidth={5} />
          )}
        </div>
      </div>

      {/* Actions */}
      {scan.status === 'pending' && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending}
            className="px-4 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {startMutation.isPending ? 'Starting...' : 'Start Scan'}
          </button>
          {startMutation.error instanceof ApiError && (
            <p className="self-center text-red-400 text-sm">{startMutation.error.message}</p>
          )}
        </div>
      )}
      {scan.status === 'completed' && (
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleGenerateReport}
            disabled={reportLoading}
            className="px-4 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 hover:bg-blue-500/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {reportLoading ? 'Generating...' : '📄 Generate Report'}
          </button>
          <button
            type="button"
            onClick={handleGetSummary}
            disabled={aiLoading}
            className="px-4 py-2 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors text-sm font-medium disabled:opacity-50"
          >
            {aiLoading ? 'Loading...' : '🤖 AI Summary'}
          </button>
        </div>
      )}

      {reportError && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{reportError}</div>
      )}

      {/* AI Summary */}
      {aiSummary && (
        <GlassCard>
          <h2 className="text-white font-semibold mb-3">🤖 AI Executive Summary</h2>
          <p className="text-gray-300 text-sm leading-relaxed whitespace-pre-wrap">{aiSummary}</p>
        </GlassCard>
      )}
      {aiError && (
        <GlassCard>
          <p className="text-gray-400 text-sm">AI summary unavailable: {aiError}</p>
        </GlassCard>
      )}

      {/* Module status */}
      {scan.modules && scan.modules.length > 0 && (
        <GlassCard>
          <h2 className="text-white font-semibold mb-4">Module Status</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {scan.modules.map((mod) => (
              <div key={mod.id} className="flex items-center justify-between p-3 rounded-lg bg-white/3 border border-white/5">
                <span className="text-gray-300 text-sm">{moduleLabel(mod.module_name)}</span>
                <ScanStatusChip status={mod.status} />
              </div>
            ))}
          </div>
        </GlassCard>
      )}

      {/* Vulnerabilities */}
      <GlassCard padding={false}>
        <div className="p-6 border-b border-white/10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-white font-semibold">
              Vulnerabilities {vulnsData ? `(${vulnsData.total})` : ''}
            </h2>
            <div className="flex flex-wrap gap-2">
              <select
                value={riskFilter}
                onChange={(e) => { setRiskFilter(e.target.value); setVulnPage(1); }}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm focus:outline-none focus:border-cyan-500/50"
              >
                <option value="">All risks</option>
                {RISK_LEVELS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
              </select>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 text-sm focus:outline-none focus:border-cyan-500/50"
              >
                <option value="discovered_at">Newest first</option>
                <option value="risk_level">Risk level</option>
                <option value="risk_score">AI risk score</option>
              </select>
            </div>
          </div>
        </div>

        {vulnsLoading ? (
          <div className="p-6"><SkeletonLoader lines={6} height="h-12" /></div>
        ) : vulnsData?.data?.length === 0 ? (
          <div className="p-10 text-center text-gray-400 text-sm">
            {scan.status === 'running' ? 'Scan in progress — vulnerabilities will appear here.' : 'No vulnerabilities found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Vulnerability</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Risk</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">OWASP</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">URL</th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {vulnsData?.data?.map((vuln) => (
                  <tr key={vuln.id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-3">
                      <Link to={`/scans/${id}/vulnerabilities/${vuln.id}`} className="text-white hover:text-cyan-400 transition-colors text-sm font-medium">
                        {vuln.name}
                      </Link>
                    </td>
                    <td className="px-6 py-3">
                      <RiskBadge level={vuln.risk_level} />
                    </td>
                    <td className="px-6 py-3 hidden md:table-cell">
                      <span className="text-gray-400 text-xs">{vuln.owasp_category}</span>
                    </td>
                    <td className="px-6 py-3 hidden lg:table-cell">
                      <span className="text-gray-400 text-xs truncate max-w-[180px] block">{vuln.affected_url || '—'}</span>
                    </td>
                    <td className="px-6 py-3">
                      <Link to={`/scans/${id}/vulnerabilities/${vuln.id}`} className="text-cyan-400 hover:text-cyan-300 text-xs transition-colors">
                        Details →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {vulnsData && vulnsData.total_pages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
            <span className="text-gray-400 text-sm">Page {vulnsData.page} of {vulnsData.total_pages}</span>
            <div className="flex gap-2">
              <button type="button" onClick={() => setVulnPage((p) => Math.max(1, p - 1))} disabled={vulnPage === 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Prev</button>
              <button type="button" onClick={() => setVulnPage((p) => Math.min(vulnsData.total_pages, p + 1))} disabled={vulnPage === vulnsData.total_pages} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next →</button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
