import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { ApiError } from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import ScanStatusChip from '../components/ui/ScanStatusChip';
import ConfirmDialog from '../components/ui/ConfirmDialog';

interface Scan {
  scan_id: string;
  target_url: string;
  status: string;
  created_at: string;
  progress_pct: number;
  selected_modules: string[];
}

interface ScansResponse {
  data: Scan[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export default function ScanManagement() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [confirmAction, setConfirmAction] = useState<{ type: 'start' | 'stop' | 'delete'; scanId: string; target: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<ScansResponse>({
    queryKey: ['scans', page],
    queryFn: () => api.get<ScansResponse>(`/scans?page=${page}&per_page=15&sort_by=created_at&order=desc`),
  });

  const startMutation = useMutation({
    mutationFn: (scanId: string) => api.post(`/scans/${scanId}/start`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scans'] }); setConfirmAction(null); },
    onError: (err) => { setActionError(err instanceof ApiError ? err.message : 'Failed to start scan'); },
  });

  const stopMutation = useMutation({
    mutationFn: (scanId: string) => api.post(`/scans/${scanId}/stop`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scans'] }); setConfirmAction(null); },
    onError: (err) => { setActionError(err instanceof ApiError ? err.message : 'Failed to stop scan'); },
  });

  const deleteMutation = useMutation({
    mutationFn: (scanId: string) => api.delete(`/scans/${scanId}`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['scans'] }); setConfirmAction(null); },
    onError: (err) => { setActionError(err instanceof ApiError ? err.message : 'Failed to delete scan'); },
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    setActionError(null);
    if (confirmAction.type === 'start') startMutation.mutate(confirmAction.scanId);
    if (confirmAction.type === 'stop') stopMutation.mutate(confirmAction.scanId);
    if (confirmAction.type === 'delete') deleteMutation.mutate(confirmAction.scanId);
  };

  const isActionLoading = startMutation.isPending || stopMutation.isPending || deleteMutation.isPending;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Scans</h1>
          <p className="text-gray-400 text-sm mt-1">
            {data ? `${data.total} total scan${data.total !== 1 ? 's' : ''}` : 'Manage your security scans'}
          </p>
        </div>
        <Link
          to="/scans/new"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          + New Scan
        </Link>
      </div>

      {actionError && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">
          {actionError}
          <button type="button" onClick={() => setActionError(null)} className="ml-2 hover:text-red-300">✕</button>
        </div>
      )}

      <GlassCard padding={false}>
        {isLoading ? (
          <div className="p-6">
            <SkeletonLoader lines={8} height="h-12" />
          </div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">
            Failed to load scans. Please try again.
          </div>
        ) : data?.data?.length === 0 ? (
          <div className="p-10 text-center">
            <div className="text-4xl mb-4">🔍</div>
            <p className="text-gray-300 font-medium mb-2">No scans yet</p>
            <p className="text-gray-400 text-sm mb-6">Create your first scan to get started.</p>
            <Link to="/scans/new" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-sm">
              + Create scan
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Target</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Status</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden sm:table-cell">Modules</th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Created</th>
                  <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data?.data?.map((scan) => (
                  <tr key={scan.scan_id} className="hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4">
                      <Link to={`/scans/${scan.scan_id}`} className="text-white hover:text-cyan-400 transition-colors text-sm font-medium truncate max-w-[200px] block">
                        {scan.target_url}
                      </Link>
                    </td>
                    <td className="px-6 py-4">
                      <ScanStatusChip status={scan.status} />
                    </td>
                    <td className="px-6 py-4 hidden sm:table-cell">
                      <span className="text-gray-400 text-xs">{scan.selected_modules?.length ?? 0} modules</span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="text-gray-400 text-xs">{new Date(scan.created_at).toLocaleDateString()}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {scan.status === 'pending' && (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'start', scanId: scan.scan_id, target: scan.target_url })}
                            className="px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20 text-green-400 hover:bg-green-500/20 transition-colors text-xs font-medium"
                          >
                            Start
                          </button>
                        )}
                        {scan.status === 'running' && (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'stop', scanId: scan.scan_id, target: scan.target_url })}
                            className="px-3 py-1.5 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/20 transition-colors text-xs font-medium"
                          >
                            Stop
                          </button>
                        )}
                        {(scan.status === 'completed' || scan.status === 'stopped' || scan.status === 'failed') && (
                          <button
                            type="button"
                            onClick={() => setConfirmAction({ type: 'delete', scanId: scan.scan_id, target: scan.target_url })}
                            className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
                          >
                            Delete
                          </button>
                        )}
                        <Link
                          to={`/scans/${scan.scan_id}`}
                          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors text-xs"
                        >
                          View
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-white/10">
            <span className="text-gray-400 text-sm">
              Page {data.page} of {data.total_pages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                ← Prev
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(data.total_pages, p + 1))}
                disabled={page === data.total_pages}
                className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10 transition-colors text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next →
              </button>
            </div>
          </div>
        )}
      </GlassCard>

      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => { setConfirmAction(null); setActionError(null); }}
        onConfirm={handleConfirm}
        loading={isActionLoading}
        title={
          confirmAction?.type === 'start' ? 'Start scan?' :
          confirmAction?.type === 'stop' ? 'Stop scan?' : 'Delete scan?'
        }
        message={
          confirmAction?.type === 'delete'
            ? `This will permanently delete the scan for "${confirmAction?.target}" and all its vulnerability data. This cannot be undone.`
            : `Are you sure you want to ${confirmAction?.type} the scan for "${confirmAction?.target}"?`
        }
        confirmLabel={
          confirmAction?.type === 'start' ? 'Start' :
          confirmAction?.type === 'stop' ? 'Stop' : 'Delete'
        }
        variant={confirmAction?.type === 'delete' ? 'danger' : 'warning'}
      />
    </div>
  );
}
