import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { ApiError } from '../lib/api';

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Password must contain at least one lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least one digit.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain at least one special character.';
  return null;
}

export default function RegisterPage() {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (displayName.trim().length < 2) errors.displayName = 'Display name must be at least 2 characters.';
    if (!email.includes('@')) errors.email = 'Enter a valid email address.';
    const pwErr = validatePassword(password);
    if (pwErr) errors.password = pwErr;
    if (password !== confirmPassword) errors.confirmPassword = 'Passwords do not match.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!validate()) return;

    setLoading(true);
    try {
      await api.post('/auth/register', { display_name: displayName, email, password }, { skipAuth: true });
      navigate('/login', { state: { registered: true } });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] flex flex-col items-center justify-center px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-white font-semibold text-xl hover:opacity-80 transition-opacity">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-black">
              W
            </div>
            WebShield
          </Link>
          <h1 className="mt-4 text-2xl font-semibold text-white">Create account</h1>
          <p className="mt-1 text-gray-400 text-sm">Start scanning for vulnerabilities today</p>
        </div>

        <div className="backdrop-blur-md bg-white/5 border border-white/10 rounded-2xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div className="px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm" role="alert">
                {error}
              </div>
            )}

            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-300 mb-1.5">
                Display name
              </label>
              <input
                id="displayName"
                type="text"
                autoComplete="name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-lg bg-white/5 border text-white placeholder-gray-500 focus:outline-none transition-colors text-sm ${fieldErrors.displayName ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500/50'}`}
                placeholder="Alice Smith"
              />
              {fieldErrors.displayName && <p className="mt-1 text-xs text-red-400">{fieldErrors.displayName}</p>}
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-1.5">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-lg bg-white/5 border text-white placeholder-gray-500 focus:outline-none transition-colors text-sm ${fieldErrors.email ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500/50'}`}
                placeholder="you@example.com"
              />
              {fieldErrors.email && <p className="mt-1 text-xs text-red-400">{fieldErrors.email}</p>}
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1.5">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-lg bg-white/5 border text-white placeholder-gray-500 focus:outline-none transition-colors text-sm ${fieldErrors.password ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500/50'}`}
                placeholder="Min 8 chars, upper, lower, digit, special"
              />
              {fieldErrors.password && <p className="mt-1 text-xs text-red-400">{fieldErrors.password}</p>}
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300 mb-1.5">
                Confirm password
              </label>
              <input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-2.5 rounded-lg bg-white/5 border text-white placeholder-gray-500 focus:outline-none transition-colors text-sm ${fieldErrors.confirmPassword ? 'border-red-500/50' : 'border-white/10 focus:border-cyan-500/50'}`}
                placeholder="••••••••"
              />
              {fieldErrors.confirmPassword && <p className="mt-1 text-xs text-red-400">{fieldErrors.confirmPassword}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-gray-400">
          Already have an account?{' '}
          <Link to="/login" className="text-cyan-400 hover:text-cyan-300 font-medium">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
