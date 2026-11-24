import { useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useMeta } from '../lib/meta';
import { initials } from '../lib/format';
import { Btn } from './ui';

const icons: Record<string, ReactNode> = {
  dashboard: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
  orders: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h16v14H4z" /><path d="M8 3v4M16 3v4M4 10h16" /></svg>
  ),
  production: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 20h18" /><path d="M6 20V10l5-3v13M11 20V7l7-3v16" /></svg>
  ),
  products: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3 3 8l9 5 9-5-9-5Z" /><path d="M3 8v9l9 5 9-5V8" /><path d="M12 13v9" /></svg>
  ),
  inventory: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="18" height="6" rx="1" /><path d="M5 10v10h14V10M9 14h6" /></svg>
  ),
  procurement: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6h15l-1.5 9h-12z" /><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M6 6 4 3H2" /></svg>
  ),
  suppliers: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 21V9l6-4v16M9 21V5l7 4v12M16 21v-8l5-3v11" /></svg>
  ),
  shipments: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7h11v10H3zM14 10h4l3 3v4h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
  ),
  customers: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" /><path d="M17 11a3 3 0 1 0 0-6M18 20c0-2.5-1-4.6-2.5-5.7" /></svg>
  ),
  locations: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.5" /></svg>
  ),
  reports: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 20V4M4 20h16" /><path d="M8 16v-5M12 16V7M16 16v-3M20 16V9" /></svg>
  ),
  settings: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg>
  ),
};

const nav: { to: string; label: string; icon: string }[] = [
  { to: '/', label: 'Dashboard', icon: 'dashboard' },
  { to: '/orders', label: 'Orders', icon: 'orders' },
  { to: '/production', label: 'Production', icon: 'production' },
  { to: '/products', label: 'Products', icon: 'products' },
  { to: '/inventory', label: 'Inventory', icon: 'inventory' },
  { to: '/procurement', label: 'Procurement', icon: 'procurement' },
  { to: '/suppliers', label: 'Suppliers', icon: 'suppliers' },
  { to: '/shipments', label: 'Shipments', icon: 'shipments' },
  { to: '/customers', label: 'Customers', icon: 'customers' },
  { to: '/locations', label: 'Cities & stores', icon: 'locations' },
  { to: '/reports', label: 'Reports', icon: 'reports' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { meta } = useMeta();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  const activeSection = nav.find((item) => (item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to)));

  return (
    <div className="app">
      <div className={`backdrop ${open ? 'open' : ''}`} onClick={() => setOpen(false)} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <Link to="/" className="brand-mark">Cold Post</Link>
          <div className="brand-sub">Campaign studio ops</div>
        </div>
        <nav className="nav">
          <div className="nav-label">Operations</div>
          {nav.slice(0, 3).map((item) => (
            <NavItem key={item.to} {...item} active={activeSection?.to === item.to} qcQueue={item.to === '/production' ? meta?.stats.qcQueue : undefined} />
          ))}
          <div className="nav-label">Supply & stock</div>
          {nav.slice(3, 7).map((item) => (
            <NavItem key={item.to} {...item} active={activeSection?.to === item.to} />
          ))}
          <div className="nav-label">Customers & places</div>
          {nav.slice(7, 10).map((item) => (
            <NavItem key={item.to} {...item} active={activeSection?.to === item.to} />
          ))}
          <div className="nav-label">Business</div>
          {nav.slice(10).map((item) => (
            <NavItem key={item.to} {...item} active={activeSection?.to === item.to} />
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className="mode-chip"><span className="dot" />{meta?.operatingMode === 'api' ? 'API mode' : 'Manual mode'}</span>
          <span>{meta?.stats.openOrders ?? 0} open campaigns</span>
          <span className="xsmall" style={{ color: '#6f6657' }}>Internal tool · v1.0</span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <Btn variant="ghost" size="sm" className="sidebar-toggle" onClick={() => setOpen((v) => !v)} aria-label="Menu">☰</Btn>
          <div className="crumb">
            Cold Post <span style={{ opacity: 0.5 }}>/</span> <strong>{activeSection?.label ?? 'Dashboard'}</strong>
          </div>
          <div className="topbar-actions">
            <Link to="/settings" className="badge badge-outline" title="Operating mode — change in Settings">
              <span className="dot" style={{ background: meta?.operatingMode === 'api' ? 'var(--info)' : 'var(--good)' }} />
              {meta?.operatingMode === 'api' ? 'API mode' : 'Manual mode'}
            </Link>
            {user ? (
              <div className="user-chip">
                <div className="avatar">{initials(user.name)}</div>
                <div style={{ lineHeight: 1.15 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{user.name}</div>
                  <div className="xsmall muted" style={{ textTransform: 'capitalize' }}>{user.role}</div>
                </div>
              </div>
            ) : null}
            <Btn
              variant="ghost"
              size="sm"
              title="Sign out"
              onClick={async () => {
                await logout();
                navigate('/');
              }}
            >
              Sign out
            </Btn>
          </div>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}

function NavItem({ to, label, icon, active, qcQueue }: { to: string; label: string; icon: string; active: boolean; qcQueue?: number }) {
  return (
    <Link to={to} className={`nav-item ${active ? 'active' : ''}`}>
      <span className="nav-icon">{icons[icon]}</span>
      {label}
      {qcQueue ? <span className="pill">{qcQueue}</span> : null}
    </Link>
  );
}
