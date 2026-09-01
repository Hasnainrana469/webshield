import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader, { SkeletonCard } from '../components/ui/SkeletonLoader';
import RiskBadge from '../components/ui/RiskBadge';

interface AdminStats {
  total_users: number;
  total_scans: number;
  total_vulnerabilities: number;
  vulnerability_breakdown: { risk_level: string; count: number }[];
  active_scans: number;
  recent_registrations: number;
}

export default function AdminPanel() {
  const { data: stats, isLoading } = useQuery<AdminStats>({
    queryKey: ['admin-stats'],
    queryFn: () => api.get<AdminStats>('/admin/stats'),
  });

  const statCards = [
    { label: 'Total Users', value: stats?.total_users ?? 0, icon: '👥', color: 'text-cyan-400', to: '/admin/users' },
    { label: 'Total Scans', value: stats?.total_scans ?? 0, icon: '⬢', color: 'text-blue-400', to: null },
    { label: 'Active Scans', value: stats?.active_scans ?? 0, icon: '⚡', color: 'text-green-400', to: null },
    { label: 'Total Vulnerabilities', value: stats?.total_vulnerabilities ?? 0, icon: '🔍', color: 'text-yellow-400', to: null },
    { label: 'New Registrations (7d)', value: stats?.recent_registrations ?? 0, icon: '✨', color: 'text-purple-400', to: null },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-purple-300/80 text-xs font-semibold uppercase tracking-[0.18em]">Control center</p>
          <h1 className="text-3xl font-bold text-white mt-2">Admin overview</h1>
          <p className="text-gray-400 text-sm mt-1">System health, account activity, and security workload.</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-300">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" /> Platform operational
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1.35fr_0.65fr] gap-4">
        <GlassCard className="relative overflow-hidden border-purple-400/15 bg-gradient-to-br from-purple-400/[0.09] via-white/[0.03] to-transparent">
          <div className="absolute right-0 top-0 h-full w-56 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.2),transparent_68%)] pointer-events-none" />
          <div className="relative"><p className="text-gray-400 text-xs uppercase tracking-wider">Operations snapshot</p><p className="text-white text-xl font-semibold mt-2">Security activity is being monitored</p><p className="text-gray-400 text-sm mt-2 max-w-xl">Review active scans, account growth, and the highest-risk findings from one place.</p></div>
        </GlassCard>
        <GlassCard>
          <p className="text-gray-400 text-xs uppercase tracking-wider">Weekly intake</p>
          <p className="text-3xl font-bold text-purple-300 mt-2">{stats?.recent_registrations ?? 0}</p>
          <p className="text-gray-500 text-xs mt-2">new accounts in the last 7 days</p>
        </GlassCard>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((card) => {
              const content = (
                <GlassCard className={card.to ? 'hover:border-white/20 transition-colors cursor-pointer' : ''}>
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-gray-400 text-xs uppercase tracking-wider">{card.label}</p>
                      <p className={`text-3xl font-bold mt-2 ${card.color}`}>{card.value.toLocaleString()}</p>
                    </div>
                    <span className="text-2xl opacity-80">{card.icon}</span>
                  </div>
                </GlassCard>
              );
              return card.to ? <Link key={card.label} to={card.to}>{content}</Link> : <div key={card.label}>{content}</div>;
            })}
      </div>

      {/* Vulnerability breakdown */}
      <GlassCard>
        <div className="flex items-start justify-between mb-5"><div><h2 className="text-white font-semibold">Vulnerability breakdown</h2><p className="text-gray-500 text-xs mt-1">Severity distribution across the platform</p></div><span className="text-gray-400 text-xs">{stats?.total_vulnerabilities?.toLocaleString() ?? 0} findings</span></div>
        {isLoading ? (
          <SkeletonLoader lines={5} height="h-8" />
        ) : stats?.vulnerability_breakdown?.length ? (
          <div className="space-y-3">
            {stats.vulnerability_breakdown.map((item) => {
              const maxCount = Math.max(...stats.vulnerability_breakdown.map((b) => b.count), 1);
              const pct = Math.round((item.count / maxCount) * 100);
              return (
                <div key={item.risk_level} className="flex items-center gap-4">
                  <RiskBadge level={item.risk_level} className="w-28 justify-center flex-shrink-0" />
                  <div className="flex-1 bg-white/5 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-2 rounded-full transition-all duration-700"
                      style={{
                        width: `${pct}%`,
                        background: item.risk_level === 'critical' ? '#ff4757' :
                          item.risk_level === 'high' ? '#ff6348' :
                          item.risk_level === 'medium' ? '#ffa502' :
                          item.risk_level === 'low' ? '#2ed573' : '#6b7280',
                      }}
                    />
                  </div>
                  <span className="text-white text-sm font-medium w-12 text-right flex-shrink-0">{item.count.toLocaleString()}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-400 text-sm">No vulnerability data yet.</p>
        )}
      </GlassCard>

      {/* Quick links */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { to: '/admin/users', icon: '👥', label: 'Manage Users', desc: 'View, promote, and deactivate users' },
          { to: '/admin/logs', icon: '📋', label: 'Activity Logs', desc: 'Audit trail of all system events' },
          { to: '/scans', icon: '⬢', label: 'Scan Monitor', desc: 'View all user scans' },
        ].map((link) => (
          <Link
            key={link.to}
            to={link.to}
            className="backdrop-blur-md bg-white/5 border border-white/10 rounded-xl p-5 hover:border-white/20 hover:bg-white/8 transition-colors"
          >
            <div className="text-2xl mb-2">{link.icon}</div>
            <p className="text-white font-medium text-sm">{link.label}</p>
            <p className="text-gray-400 text-xs mt-1">{link.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
