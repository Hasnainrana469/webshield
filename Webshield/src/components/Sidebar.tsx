import { NavLink } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

interface NavItem {
  to: string;
  label: string;
  icon: string;
}

const userNavItems: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: '⬡' },
  { to: '/scans', label: 'Scans', icon: '⬢' },
  { to: '/reports', label: 'Reports', icon: '📄' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

const adminNavItems: NavItem[] = [
  { to: '/admin', label: 'Admin Overview', icon: '🛡' },
  { to: '/admin/users', label: 'Users', icon: '👥' },
  { to: '/admin/logs', label: 'Activity Logs', icon: '📋' },
];

interface SidebarProps {
  collapsed?: boolean;
  onClose?: () => void;
}

export default function Sidebar({ collapsed = false, onClose }: SidebarProps) {
  const { user } = useAuth();

  return (
    <nav
      className={`h-full flex flex-col bg-[#111827] border-r border-white/10 transition-all duration-300 ${collapsed ? 'w-0 overflow-hidden' : 'w-64'}`}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-white/10 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-400 to-blue-600 flex items-center justify-center font-bold text-black text-sm">
          W
        </div>
        <span className="font-semibold text-white tracking-tight">WebShield</span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto text-gray-400 hover:text-white md:hidden"
            aria-label="Close menu"
          >
            ✕
          </button>
        )}
      </div>

      {/* Nav items */}
      <div className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {/* User nav */}
        <div className="space-y-1">
          {userNavItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/scans'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`
              }
            >
              <span className="text-base w-5 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Admin nav (only for admins) */}
        {user?.role === 'admin' && (
          <div className="mt-6">
            <p className="px-3 py-1 text-xs font-medium text-gray-500 uppercase tracking-wider">
              Admin
            </p>
            <div className="mt-2 space-y-1">
              {adminNavItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                        : 'text-gray-400 hover:text-white hover:bg-white/5'
                    }`
                  }
                >
                  <span className="text-base w-5 text-center">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* User info at bottom */}
      <div className="flex-shrink-0 px-4 py-4 border-t border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-400 to-purple-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
            {user?.display_name?.[0]?.toUpperCase() ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-white truncate">{user?.display_name}</p>
            <p className="text-xs text-gray-400 truncate capitalize">{user?.role}</p>
          </div>
        </div>
      </div>
    </nav>
  );
}
