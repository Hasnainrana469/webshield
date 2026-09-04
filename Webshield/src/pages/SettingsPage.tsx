import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import api, { ApiError } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';
import GlassCard from '../components/ui/GlassCard';

interface UpdateProfilePayload {
  display_name?: string;
  email?: string;
}

interface UpdatePasswordPayload {
  current_password: string;
  new_password: string;
}

interface UpdateSettingsPayload {
  email_notif_enabled: boolean;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Must contain an uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Must contain a lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Must contain a digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Must contain a special character.';
  return null;
}

function StatusMessage({ type, message }: { type: 'success' | 'error'; message: string }) {
  return (
    <div
      role="alert"
      className={`px-4 py-3 rounded-lg text-sm ${type === 'success' ? 'bg-green-500/10 border border-green-500/20 text-green-400' : 'bg-red-500/10 border border-red-500/20 text-red-400'}`}
    >
      {message}
    </div>
  );
}

export default function SettingsPage() {
  const { user, login, token } = useAuth();

  // Profile
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileStatus, setProfileStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Password
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordStatus, setPasswordStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Notifications
  const [notifEnabled, setNotifEnabled] = useState(true);
  const [notifStatus, setNotifStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const profileMutation = useMutation({
    mutationFn: (payload: UpdateProfilePayload) => api.put<typeof user>('/users/me', payload),
    onSuccess: (updatedUser) => {
      if (updatedUser && token) {
        login(token, updatedUser as NonNullable<typeof user>);
      }
      setProfileStatus({ type: 'success', message: 'Profile updated successfully.' });
    },
    onError: (err) => {
      setProfileStatus({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to update profile.' });
    },
  });

  const passwordMutation = useMutation({
    mutationFn: (payload: UpdatePasswordPayload) => api.put('/users/me/password', payload),
    onSuccess: () => {
      setPasswordStatus({ type: 'success', message: 'Password changed successfully.' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (err) => {
      setPasswordStatus({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to change password.' });
    },
  });

  const settingsMutation = useMutation({
    mutationFn: (payload: UpdateSettingsPayload) => api.put('/users/me/settings', payload),
    onSuccess: () => {
      setNotifStatus({ type: 'success', message: 'Notification settings saved.' });
    },
    onError: (err) => {
      setNotifStatus({ type: 'error', message: err instanceof ApiError ? err.message : 'Failed to update settings.' });
    },
  });

  const handleProfileSubmit = (e: FormEvent) => {
    e.preventDefault();
    setProfileStatus(null);
    profileMutation.mutate({ display_name: displayName, email });
  };

  const handlePasswordSubmit = (e: FormEvent) => {
    e.preventDefault();
    setPasswordStatus(null);
    const err = validatePassword(newPassword);
    if (err) { setPasswordStatus({ type: 'error', message: err }); return; }
    if (newPassword !== confirmPassword) { setPasswordStatus({ type: 'error', message: 'Passwords do not match.' }); return; }
    passwordMutation.mutate({ current_password: currentPassword, new_password: newPassword });
  };

  const handleNotifToggle = () => {
    const next = !notifEnabled;
    setNotifEnabled(next);
    setNotifStatus(null);
    settingsMutation.mutate({ email_notif_enabled: next });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Settings</h1>
        <p className="text-gray-400 text-sm mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile section */}
      <GlassCard>
        <h2 className="text-white font-semibold mb-5">Profile</h2>
        <form onSubmit={handleProfileSubmit} className="space-y-4">
          {profileStatus && <StatusMessage {...profileStatus} />}

          <div>
            <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-1.5">
              Display name
            </label>
            <input
              id="displayName"
              type="text"
              required
              minLength={2}
              maxLength={100}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
            />
          </div>

          <div>
            <label htmlFor="settingsEmail" className="block text-sm font-medium text-gray-300 mb-1.5">
              Email address
            </label>
            <input
              id="settingsEmail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={profileMutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {profileMutation.isPending ? 'Saving...' : 'Save profile'}
          </button>
        </form>
      </GlassCard>

      {/* Password section */}
      <GlassCard>
        <h2 className="text-white font-semibold mb-5">Change Password</h2>
        <form onSubmit={handlePasswordSubmit} className="space-y-4">
          {passwordStatus && <StatusMessage {...passwordStatus} />}

          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-300 mb-1.5">
              Current password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
              placeholder="••••••••"
            />
          </div>

          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-300 mb-1.5">
              New password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
              placeholder="Min 8 chars, upper, lower, digit, special"
            />
          </div>

          <div>
            <label htmlFor="confirmNewPassword" className="block text-sm font-medium text-gray-300 mb-1.5">
              Confirm new password
            </label>
            <input
              id="confirmNewPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-white placeholder-gray-500 focus:outline-none focus:border-cyan-500/50 transition-colors text-sm"
              placeholder="••••••••"
            />
          </div>

          <button
            type="submit"
            disabled={passwordMutation.isPending}
            className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {passwordMutation.isPending ? 'Changing...' : 'Change password'}
          </button>
        </form>
      </GlassCard>

      {/* Notifications */}
      <GlassCard>
        <h2 className="text-white font-semibold mb-5">Notifications</h2>
        {notifStatus && <div className="mb-4"><StatusMessage {...notifStatus} /></div>}
        <div className="flex items-center justify-between p-4 rounded-lg bg-white/3 border border-white/5">
          <div>
            <p className="text-white text-sm font-medium">Email notifications</p>
            <p className="text-gray-400 text-xs mt-0.5">
              Receive emails when scans complete and critical vulnerabilities are found
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={notifEnabled}
            onClick={handleNotifToggle}
            disabled={settingsMutation.isPending}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${notifEnabled ? 'bg-cyan-500' : 'bg-gray-600'}`}
          >
            <span className="sr-only">Toggle email notifications</span>
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${notifEnabled ? 'translate-x-6' : 'translate-x-1'}`}
            />
          </button>
        </div>
      </GlassCard>
    </div>
  );
}
