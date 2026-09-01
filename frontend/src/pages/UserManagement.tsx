import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { ApiError } from '../lib/api';
import GlassCard from '../components/ui/GlassCard';
import SkeletonLoader from '../components/ui/SkeletonLoader';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import { useAuth } from '../contexts/AuthContext';

interface User {
  id: string;
  display_name: string;
  email: string;
  role: 'user' | 'admin';
  is_active: boolean;
  created_at: string;
  scan_count?: number;
}

interface UsersResponse {
  data: User[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

export default function UserManagement() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();
  const [page, setPage] = useState(1);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'promote' | 'demote' | 'deactivate';
    userId: string;
    userName: string;
    currentRole?: 'user' | 'admin';
  } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery<UsersResponse>({
    queryKey: ['admin-users', page],
    queryFn: () => api.get<UsersResponse>(`/admin/users?page=${page}&per_page=20`),
  });

  const roleMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.put(`/admin/users/${userId}/role`, { role }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmAction(null);
      setActionError(null);
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Failed to update role');
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => api.put(`/admin/users/${userId}/deactivate`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      setConfirmAction(null);
      setActionError(null);
    },
    onError: (err) => {
      setActionError(err instanceof ApiError ? err.message : 'Failed to deactivate user');
    },
  });

  const handleConfirm = () => {
    if (!confirmAction) return;
    setActionError(null);

    if (confirmAction.type === 'deactivate') {
      deactivateMutation.mutate(confirmAction.userId);
    } else {
      const newRole = confirmAction.type === 'promote' ? 'admin' : 'user';
      roleMutation.mutate({ userId: confirmAction.userId, role: newRole });
    }
  };

  const isActionLoading = roleMutation.isPending || deactivateMutation.isPending;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">User Management</h1>
        <p className="text-gray-400 text-sm mt-1">
          {data ? `${data.total} registered user${data.total !== 1 ? 's' : ''}` : 'Manage user accounts and roles'}
        </p>
      </div>

      {actionError && (
        <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">
          {actionError}
          <button type="button" onClick={() => setActionError(null)} className="ml-2 hover:text-red-300">✕</button>
        </div>
      )}

      <GlassCard padding={false}>
        {isLoading ? (
          <div className="p-6"><SkeletonLoader lines={8} height="h-12" /></div>
        ) : error ? (
          <div className="p-8 text-center text-red-400 text-sm">Failed to load users.</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">User</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Role</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden md:table-cell">Status</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Joined</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider hidden lg:table-cell">Scans</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data?.data?.map((user) => {
                    const isSelf = user.id === currentUser?.user_id;
                    return (
                      <tr key={user.id} className="hover:bg-white/2 transition-colors">
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                              {user.display_name[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-white text-sm font-medium">{user.display_name} {isSelf && <span className="text-xs text-gray-400">(you)</span>}</p>
                              <p className="text-gray-400 text-xs truncate">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.role === 'admin'
                              ? 'bg-purple-500/20 text-purple-400 border border-purple-500/30'
                              : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                          }`}>
                            {user.role}
                          </span>
                        </td>
                        <td className="px-6 py-4 hidden md:table-cell">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                            user.is_active
                              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
                              : 'bg-red-500/20 text-red-400 border border-red-500/30'
                          }`}>
                            {user.is_active ? 'Active' : 'Inactive'}
                          </span>
                        </td>
                        <td className="px-6 py-4 hidden lg:table-cell">
                          <span className="text-gray-400 text-xs">{new Date(user.created_at).toLocaleDateString()}</span>
                        </td>
                        <td className="px-6 py-4 hidden lg:table-cell">
                          <span className="text-gray-400 text-xs">{user.scan_count ?? 0}</span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center justify-end gap-2">
                            {!isSelf && user.is_active && (
                              <>
                                {user.role === 'user' ? (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmAction({ type: 'promote', userId: user.id, userName: user.display_name, currentRole: user.role })}
                                    className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-purple-400 hover:bg-purple-500/20 transition-colors text-xs font-medium"
                                  >
                                    Promote
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => setConfirmAction({ type: 'demote', userId: user.id, userName: user.display_name, currentRole: user.role })}
                                    className="px-3 py-1.5 rounded-lg bg-gray-500/10 border border-gray-500/20 text-gray-400 hover:bg-gray-500/20 transition-colors text-xs font-medium"
                                  >
                                    Demote
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => setConfirmAction({ type: 'deactivate', userId: user.id, userName: user.display_name })}
                                  className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors text-xs font-medium"
                                >
                                  Deactivate
                                </button>
                              </>
                            )}
                            {!user.is_active && (
                              <span className="text-gray-500 text-xs">Inactive</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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

      <ConfirmDialog
        isOpen={!!confirmAction}
        onClose={() => { setConfirmAction(null); setActionError(null); }}
        onConfirm={handleConfirm}
        loading={isActionLoading}
        title={
          confirmAction?.type === 'promote' ? 'Promote to admin?' :
          confirmAction?.type === 'demote' ? 'Demote to user?' : 'Deactivate account?'
        }
        message={
          confirmAction?.type === 'deactivate'
            ? `This will deactivate "${confirmAction?.userName}"'s account. They will no longer be able to log in.`
            : confirmAction?.type === 'promote'
            ? `Grant admin privileges to "${confirmAction?.userName}"? They will have full access to all admin features.`
            : `Remove admin privileges from "${confirmAction?.userName}"? They will be downgraded to a standard user.`
        }
        confirmLabel={
          confirmAction?.type === 'promote' ? 'Promote' :
          confirmAction?.type === 'demote' ? 'Demote' : 'Deactivate'
        }
        variant={confirmAction?.type === 'deactivate' ? 'danger' : 'warning'}
      />
    </div>
  );
}
