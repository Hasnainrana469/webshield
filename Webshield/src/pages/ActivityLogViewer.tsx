import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader from '../components/ui/SkeletonLoader';

interface ActivityLog {
  id: string;
  event_type: string;
  actor_user_id: string | null;
  target_resource_id: string | null;
  target_resource_type: string | null;
  description: string;
  created_at: string;
  actor?: {
    display_name: string;
    email: string;
  };
}

interface LogsResponse {
  data: ActivityLog[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

const eventTypeColors: Record<string, string> = {
  user_registration: 'text-green-400 bg-green-500/10 border-green-500/20',
  user_login: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  user_logout: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  scan_created: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  scan_started: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  scan_stopped: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
  scan_completed: 'text-teal-400 bg-teal-500/10 border-teal-500/20',
  scan_failed: 'text-red-400 bg-red-500/10 border-red-500/20',
  report_generated: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  admin_role_change: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
  admin_account_deactivated: 'text-red-400 bg-red-500/10 border-red-500/20',
  ai_failure: 'text-pink-400 bg-pink-500/10 border-pink-500/20',
};

function eventLabel(type: string): string {
  return type
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function EventChip({ type }: { type: string }) {
  const style = eventTypeColors[type] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border whitespace-nowrap ${style}`}>
      {eventLabel(type)}
    </span>
  );
}

export default function ActivityLogViewer() {
  const [page, setPage] = useState(1);

  const { data, isLoading, error } = useQuery<LogsResponse>({
    queryKey: ['activity-logs', page],
    queryFn: () => api.get<LogsResponse>(`/admin/activity-logs?page=${page}&per_page=50`),
  });

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Activity Logs</h1>
        <p className="text-gray-400 text-sm mt-1">
          {data ? `${data.total.toLocaleString()} events recorded` : 'System audit trail'}
        </p>
      </div>

      <GlassCard padding={false}>
        {isLoading ? (
          <div className="p-6"><SkeletonLoader lines={10} height="h-10" /></div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load activity logs.</div>
        ) : data?.data?.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-4">📋</div>
            <p className="text-gray-400 text-sm">No activity logs yet.</p>
          </div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Event</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actor</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Description</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data?.data?.map((log) => (
                    <tr key={log.id} className="hover:bg-white/2 transition-colors">
                      <td className="px-6 py-3">
                        <EventChip type={log.event_type} />
                      </td>
                      <td className="px-6 py-3">
                        {log.actor ? (
                          <div>
                            <p className="text-white text-xs font-medium">{log.actor.display_name}</p>
                            <p className="text-gray-500 text-xs">{log.actor.email}</p>
                          </div>
                        ) : (
                          <span className="text-gray-500 text-xs">System</span>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <p className="text-gray-300 text-xs">{log.description}</p>
                        {log.target_resource_id && (
                          <p className="text-gray-500 text-xs mt-0.5 font-mono">
                            {log.target_resource_type}: {log.target_resource_id.slice(0, 8)}...
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-3">
                        <span className="text-gray-400 text-xs whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <div className="md:hidden divide-y divide-white/5">
              {data?.data?.map((log) => (
                <div key={log.id} className="p-4 hover:bg-white/2 transition-colors">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <EventChip type={log.event_type} />
                    <span className="text-gray-500 text-xs whitespace-nowrap">
                      {new Date(log.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="text-gray-300 text-xs mb-1">{log.description}</p>
                  {log.actor && (
                    <p className="text-gray-500 text-xs">{log.actor.display_name} · {log.actor.email}</p>
                  )}
                </div>
              ))}
            </div>

            {data && data.total_pages > 1 && (
              <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
                <span className="text-gray-400 text-sm">Page {data.page} of {data.total_pages}</span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">← Prev</button>
                  <button type="button" onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))} disabled={page === data.total_pages} className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors">Next →</button>
                </div>
              </div>
            )}
          </>
        )}
      </GlassCard>
    </div>
  );
}
