import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import api from '../lib/api';

interface TopNavBarProps {
  onMenuToggle?: () => void;
}

export default function TopNavBar({ onMenuToggle }: TopNavBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore errors — we log out locally regardless
    }
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <header className="h-16 flex-shrink-0 flex items-center justify-between px-4 md:px-6 border-b border-white/10 bg-[#111827]/80 backdrop-blur-sm">
      {/* Mobile hamburger */}
      <button
        type="button"
        onClick={onMenuToggle}
        className="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
        aria-label="Toggle sidebar"
      >
        <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Title slot — empty on desktop, shown on mobile */}
      <div className="md:hidden font-semibold text-white">WebShield</div>

      {/* Right side */}
      <div className="flex items-center gap-3 ml-auto">
        {/* New scan button */}
        <Link
          to="/scans/new"
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 hover:bg-cyan-500/20 transition-colors text-sm font-medium"
        >
          + New Scan
        </Link>

        {/* User menu */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            aria-label="User menu"
            aria-expanded={menuOpen}
          >
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center text-white text-sm font-semibold">
              {user?.display_name?.[0]?.toUpperCase() ?? '?'}
            </div>
            <svg
              className={`w-4 h-4 text-gray-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} aria-hidden="true" />
              <div className="absolute right-0 top-full mt-2 w-56 z-20 bg-gray-900 border border-white/10 rounded-xl shadow-xl py-1">
                <div className="px-4 py-3 border-b border-white/10">
                  <p className="text-sm font-medium text-white">{user?.display_name}</p>
                  <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                </div>
                <Link
                  to="/settings"
                  onClick={() => setMenuOpen(false)}
                  className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
                >
                  ⚙ Settings
                </Link>
                <button
                  type="button"
                  onClick={handleLogout}
                  disabled={loggingOut}
                  className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors disabled:opacity-50"
                >
                  ↪ {loggingOut ? 'Logging out...' : 'Log out'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
