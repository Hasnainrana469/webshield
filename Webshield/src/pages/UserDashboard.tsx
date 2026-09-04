import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line,
} from 'recharts';
import api from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader, { SkeletonCard } from '../components/ui/SkeletonLoader';
import ScanStatusChip from '../components/ui/ScanStatusChip';

interface Scan {
  scan_id: string;
  target_url: string;
  status: string;
  created_at: string;
  progress_pct: number;
}

interface ScansResponse {
  data: Scan[];
  total: number;
}

interface DashboardStats {
  total_scans: number;
  total_vulnerabilities: number;
  critical_vulnerabilities: number;
  risk_distribution: { risk_level: string; count: number }[];
  scan_status: { status: string; count: number }[];
  scan_activity: { date: string; count: number }[];
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const riskColors: Record<string, string> = {
  critical: '#ff4757',
  high: '#ff6348',
  medium: '#ffa502',
  low: '#2ed573',
  informational: '#6b7280',
};

function ScanActivityTimeline({ data }: { data: { date: string; count: number }[] }) {
  const chartData = data.map((d) => ({
    date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    scans: d.count,
  }));

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
        <XAxis dataKey="date" tick={{ fill: '#9ca3af', fontSize: 10 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: '#9ca3af', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: '#111827', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#e2e8f0' }}
          cursor={{ stroke: 'rgba(255,255,255,0.1)' }}
        />
        <Line type="monotone" dataKey="scans" stroke="#00d4ff" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: '#00d4ff' }} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function RiskBreakdown({ data }: { data: { risk_level: string; count: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const levels = ['critical', 'high', 'medium', 'low', 'informational'];

  return (
    <div className="space-y-3">
      {levels.map((level) => {
        const count = data.find((item) => item.risk_level === level)?.count ?? 0;
        const width = total ? Math.max((count / total) * 100, count ? 4 : 0) : 0;
        return (
          <div key={level}>
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="text-gray-400 capitalize">{level}</span>
              <span className="text-gray-200 font-medium">{count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full transition-all" style={{ width: `${width}%`, backgroundColor: riskColors[level] }} />
            </div>
          </div>
        );
      })}
      {!total && <p className="text-gray-500 text-sm pt-2">Run a scan to build your risk profile.</p>}
    </div>
  );
}

function StatusBreakdown({ data }: { data: { status: string; count: number }[] }) {
  const total = data.reduce((sum, item) => sum + item.count, 0);
  const statuses = [
    { name: 'completed', label: 'Completed', color: '#34d399' },
    { name: 'running', label: 'Running', color: '#22d3ee' },
    { name: 'pending', label: 'Pending', color: '#fbbf24' },
    { name: 'failed', label: 'Failed', color: '#fb7185' },
  ];

  return (
    <div className="space-y-3">
      {statuses.map((status) => {
        const count = data.find((item) => item.status === status.name)?.count ?? 0;
        return (
          <div key={status.name} className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="text-xs text-gray-400 flex-1">{status.label}</span>
            <div className="w-24 sm:w-32 h-1.5 rounded-full bg-white/8 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${total ? (count / total) * 100 : 0}%`, backgroundColor: status.color }} />
            </div>
            <span className="w-5 text-right text-xs text-gray-200 font-medium">{count}</span>
          </div>
        );
      })}
      {!total && <p className="text-gray-500 text-sm pt-2">No scan lifecycle data yet.</p>}
    </div>
  );
}

export default function UserDashboard() {
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: 'assistant', content: 'Ask me about a finding, OWASP risk, or remediation plan.' },
  ]);
  const [chatLoading, setChatLoading] = useState(false);
  const { data: scansData, isLoading: scansLoading } = useQuery<ScansResponse>({
    queryKey: ['scans', 'recent'],
    queryFn: () => api.get<ScansResponse>('/scans?per_page=5&sort_by=created_at&order=desc'),
  });

  const { data: stats, isLoading: statsLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard-stats'],
    queryFn: () => api.get<DashboardStats>('/scans/stats'),
  });

  const statCards = [
    { label: 'Total scans', value: stats?.total_scans ?? 0, note: 'All time', icon: '⬢', color: 'text-cyan-400', bg: 'bg-cyan-400/10' },
    { label: 'Findings', value: stats?.total_vulnerabilities ?? 0, note: 'Across completed scans', icon: '⌁', color: 'text-blue-400', bg: 'bg-blue-400/10' },
    { label: 'Critical risk', value: stats?.critical_vulnerabilities ?? 0, note: stats?.critical_vulnerabilities ? 'Needs attention' : 'No critical findings', icon: '!', color: 'text-red-400', bg: 'bg-red-400/10' },
  ];

  const runningScans = stats?.scan_status?.find((item) => item.status === 'running')?.count ?? 0;
  const completedScans = stats?.scan_status?.find((item) => item.status === 'completed')?.count ?? 0;
  const postureLabel = statsLoading ? 'Calculating posture' : stats?.critical_vulnerabilities ? 'Attention needed' : 'Monitoring is clear';
  const postureTone = stats?.critical_vulnerabilities ? 'text-amber-300' : 'text-emerald-300';
  const postureScore = stats?.total_vulnerabilities
    ? Math.max(0, Math.round(100 - ((stats.critical_vulnerabilities * 10 + (stats.risk_distribution.find((item) => item.risk_level === 'high')?.count ?? 0) * 4) / stats.total_vulnerabilities) * 10))
    : 100;

  const handleChatSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const content = chatInput.trim();
    if (!content || chatLoading) return;
    const nextMessages = [...chatMessages, { role: 'user' as const, content }];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);
    try {
      const response = await api.post<{ reply: string }>('/scans/ai/chat', { messages: nextMessages });
      setChatMessages((current) => [...current, { role: 'assistant', content: response.reply }]);
    } catch {
      setChatMessages((current) => [...current, { role: 'assistant', content: 'The assistant is temporarily unavailable. Review the scan findings or try again shortly.' }]);
    } finally {
      setChatLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-cyan-400/80 text-xs font-semibold uppercase tracking-[0.18em]">Security operations</p>
          <h1 className="text-3xl font-bold text-white mt-2">Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">A live view of your web security posture and scan activity.</p>
        </div>
        <Link to="/scans/new" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-cyan-400 text-slate-950 text-sm font-semibold hover:bg-cyan-300 transition-colors">
          <span className="text-base leading-none">+</span> New scan
        </Link>
      </div>

      <div className="relative overflow-hidden flex flex-wrap items-center justify-between gap-5 px-5 py-4 rounded-xl border border-cyan-400/15 bg-gradient-to-r from-cyan-400/10 via-white/[0.03] to-transparent">
        <div className="absolute right-0 top-0 h-full w-48 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.16),transparent_68%)] pointer-events-none" />
        <div className="flex items-center gap-3">
          <div className="relative flex h-11 w-11 items-center justify-center rounded-full border border-emerald-300/20 bg-emerald-400/10">
            <span className={`text-sm font-bold ${postureTone}`}>{statsLoading ? '...' : postureScore}</span>
          </div>
          <div>
            <p className="text-gray-400 text-xs uppercase tracking-wider">Current posture</p>
            <p className={`font-semibold ${postureTone}`}>{postureLabel}</p>
          </div>
        </div>
        <div className="relative flex items-center gap-5 text-xs text-gray-400">
          <span><strong className="text-white">{runningScans}</strong> running</span>
          <span><strong className="text-white">{completedScans}</strong> completed</span>
          <span className="hidden sm:inline border-l border-white/10 pl-5">Live telemetry</span>
        </div>
      </div>

      <GlassCard className="overflow-hidden border-cyan-400/15 bg-gradient-to-br from-cyan-400/[0.07] via-white/[0.03] to-transparent">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-400/15 text-cyan-300 text-lg">✦</div>
            <div><p className="text-cyan-300 text-[11px] font-semibold uppercase tracking-wider">AI guidance</p><h2 className="text-white font-semibold mt-1">WebShield Assistant</h2><p className="text-gray-500 text-xs mt-1">Ask about findings, OWASP risks, or remediation.</p></div>
          </div>
          <span className="text-[11px] text-emerald-300 bg-emerald-400/10 px-2 py-1 rounded-md">Ready</span>
        </div>
        <div className="h-32 overflow-y-auto space-y-3 pr-1 mb-4" aria-live="polite">
          {chatMessages.map((message, index) => (
            <div key={`${message.role}-${index}`} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-lg px-3 py-2 text-sm leading-relaxed ${message.role === 'user' ? 'bg-cyan-400 text-slate-950' : 'bg-white/7 text-gray-300 border border-white/8'}`}>
                {message.content}
              </div>
            </div>
          ))}
          {chatLoading && <div className="text-xs text-cyan-300 animate-pulse">Assistant is thinking...</div>}
        </div>
        <form onSubmit={handleChatSubmit} className="flex gap-2">
          <input value={chatInput} onChange={(event) => setChatInput(event.target.value)} placeholder="Ask about XSS, TLS, SQL injection..." className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white placeholder-gray-500 outline-none focus:border-cyan-400/50" maxLength={2000} />
          <button type="submit" disabled={chatLoading || !chatInput.trim()} className="rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-40">Send</button>
        </form>
      </GlassCard>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {statsLoading
          ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((card) => (
              <GlassCard key={card.label} className="relative overflow-hidden">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-gray-400 text-xs uppercase tracking-wider">{card.label}</p>
                    <p className={`text-3xl font-bold mt-2 ${card.color}`}>{card.value}</p>
                    <p className="text-gray-500 text-xs mt-2">{card.note}</p>
                  </div>
                  <span className={`flex h-10 w-10 items-center justify-center rounded-lg ${card.bg} ${card.color} text-xl font-bold`}>{card.icon}</span>
                </div>
                <div className={`absolute bottom-0 left-0 h-0.5 w-1/2 ${card.bg.replace('/10', '/60')}`} />
              </GlassCard>
            ))}
      </div>

      {/* Analytics row */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-6">
        <GlassCard>
          <div className="flex items-start justify-between mb-5">
            <div><h2 className="text-white font-semibold">Risk profile</h2><p className="text-gray-500 text-xs mt-1">Severity across all findings</p></div>
            <span className="text-gray-500 text-xs">{stats?.total_vulnerabilities ?? 0} total</span>
          </div>
          {statsLoading ? (
            <SkeletonLoader lines={5} height="h-8" />
          ) : stats?.risk_distribution?.length ? (
            <RiskBreakdown data={stats.risk_distribution} />
          ) : (
            <RiskBreakdown data={[]} />
          )}
        </GlassCard>

        <GlassCard>
          <div className="flex items-start justify-between mb-5">
            <div><h2 className="text-white font-semibold">Scan activity</h2><p className="text-gray-500 text-xs mt-1">Volume over the last 30 days</p></div>
            <Link to="/scans" className="text-cyan-400 hover:text-cyan-300 text-xs">View scans</Link>
          </div>
          {statsLoading ? (
            <SkeletonLoader lines={5} height="h-8" />
          ) : (
            <StatusBreakdown data={stats?.scan_status ?? []} />
          )}
        </GlassCard>
      </div>

      <GlassCard>
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div><h2 className="text-white font-semibold">Activity pulse</h2><p className="text-gray-500 text-xs mt-1">Daily scan volume across the last 30 days</p></div>
          <span className="px-2 py-1 rounded-md bg-cyan-400/10 text-cyan-300 text-[11px] font-medium">Last 30 days</span>
        </div>
        {statsLoading ? <SkeletonLoader lines={5} height="h-8" /> : stats?.scan_activity?.length ? <ScanActivityTimeline data={stats.scan_activity} /> : <div className="h-[200px] flex flex-col items-center justify-center text-center"><span className="text-2xl text-gray-600">⌁</span><p className="text-gray-500 text-sm mt-3">No scan activity yet</p><Link to="/scans/new" className="text-cyan-400 text-xs mt-2 hover:text-cyan-300">Start your first scan</Link></div>}
      </GlassCard>

      {/* Recent scans */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <div><h2 className="text-white font-semibold">Recent scans</h2><p className="text-gray-500 text-xs mt-1">Your latest security operations</p></div>
          <Link to="/scans" className="text-cyan-400 hover:text-cyan-300 text-sm transition-colors">
            View all →
          </Link>
        </div>

        {scansLoading ? (
          <SkeletonLoader lines={5} height="h-12" />
        ) : scansData?.data?.length ? (
          <div className="space-y-3">
            {scansData.data.map((scan) => (
              <Link
                key={scan.scan_id}
                to={`/scans/${scan.scan_id}`}
                className="flex items-center justify-between gap-4 p-3.5 rounded-lg bg-white/3 hover:bg-cyan-400/[0.06] border border-white/5 hover:border-cyan-400/20 transition-colors group"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-white text-sm font-medium truncate group-hover:text-cyan-400 transition-colors">
                    {scan.target_url}
                  </p>
                  <p className="text-gray-500 text-xs mt-1 flex items-center gap-2">
                    <span>{new Date(scan.created_at).toLocaleDateString()}</span><span className="text-gray-700">•</span><span>{scan.progress_pct}% analyzed</span>
                  </p>
                </div>
                <ScanStatusChip status={scan.status} className="ml-4 flex-shrink-0" />
              </Link>
            ))}
          </div>
        ) : (
          <div className="py-8 text-center">
            <p className="text-gray-400 text-sm mb-4">No scans yet. Start your first security scan.</p>
            <Link
              to="/scans/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-sm"
            >
              + Create scan
            </Link>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
