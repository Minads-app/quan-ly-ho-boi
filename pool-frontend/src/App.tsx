import { useEffect, useState, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink, useLocation, Link } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ThemeToggleButton } from './components/ui';
import { fetchBusinessSettings, hasPermission } from './utils/helpers';
import type { PermissionsMatrix } from './types';
import {
  AwardIcon,
  BanknoteIcon,
  BoxIcon,
  ChartBarIcon,
  GraduationCapIcon,
  KeyIcon,
  LogOutIcon,
  MenuIcon,
  PanelLeftIcon,
  QrScanIcon,
  ReceiptIcon,
  SettingsIcon,
  ShieldUserIcon,
  TicketIcon,
  TrendingUpIcon,
  UsersIcon,
  WalletIcon,
} from './components/ui/Icons';

import LoginPage from './pages/LoginPage';
import POSPage from './pages/POSPage';
import GateCheckPage from './pages/GateCheckPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import AnalyticsPage from './pages/AnalyticsPage';
import StaffPage from './pages/StaffPage';
import CustomerPage from './pages/CustomerPage';
import InventoryPage from './pages/InventoryPage';
import CashPage from './pages/CashPage';
import OrdersPage from './pages/OrdersPage';
import CoachManagementPage from './pages/CoachManagementPage';
import CoachDashboardPage from './pages/CoachDashboardPage';
import CoachPayrollPage from './pages/CoachPayrollPage';
import './index.css';

interface NavItemConfig {
  to: string;
  label: string;
  icon: ReactNode;
  kbd?: string;
  visible: boolean;
}

interface NavGroupConfig {
  title: string;
  items: NavItemConfig[];
}

const ROUTE_TITLES: Record<string, string> = {
  '/pos': 'Bán Vé & Bán Hàng (POS)',
  '/gate': 'Soát Vé Cổng Kiểm Soát',
  '/customers': 'Khách Hàng & Gói Thẻ',
  '/dashboard': 'Báo Cáo Hoạt Động',
  '/analytics': 'Biểu Đồ Phân Tích',
  '/inventory': 'Quản Lý Kho Hàng',
  '/orders': 'Danh Sách Hóa Đơn',
  '/cash': 'Quỹ & Phiếu Chi',
  '/staff': 'Tài Khoản Nhân Sự',
  '/settings': 'Cài Đặt Hệ Thống',
  '/coaches': 'Quản Lý Huấn Luyện Viên',
  '/coach-payroll': 'Bảng Lương HLV',
  '/my-students': 'Học Viên Của Tôi',
};

function getInitialCollapsed(): boolean {
  try {
    return localStorage.getItem('pool_sidebar_collapsed') === 'true';
  } catch {
    return false;
  }
}

function getInitials(name?: string | null): string {
  if (!name) return 'NV';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function AppRoutes() {
  const { user, profile, loading, signOut } = useAuth();
  const location = useLocation();
  const [bizName, setBizName] = useState('Vé Bơi');
  const [bizLogo, setBizLogo] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(getInitialCollapsed);

  // Change password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function toggleSidebarCollapse() {
    setIsSidebarCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('pool_sidebar_collapsed', String(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword.length < 6) {
      setPasswordFeedback({ type: 'error', text: 'Mật khẩu phải từ 6 ký tự trở lên.' });
      return;
    }
    setIsChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsChangingPassword(false);
    if (error) {
      setPasswordFeedback({ type: 'error', text: 'Lỗi đổi mật khẩu: ' + error.message });
    } else {
      setPasswordFeedback({ type: 'success', text: 'Đổi mật khẩu thành công!' });
      setNewPassword('');
      setTimeout(() => {
        setShowPasswordModal(false);
        setPasswordFeedback(null);
      }, 900);
    }
  }

  useEffect(() => {
    async function loadBiz() {
      const info = await fetchBusinessSettings();
      if (info.business_name) setBizName(info.business_name);
      if (info.business_logo) setBizLogo(info.business_logo);
    }
    loadBiz();
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Đang tải hệ thống...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage />;
  }

  const canView = (module: keyof PermissionsMatrix) => hasPermission(profile, module, 'view');

  const navGroups: NavGroupConfig[] = [
    {
      title: 'Quầy & Cổng',
      items: [
        { to: '/pos', label: 'Bán Vé & POS', icon: <TicketIcon size={18} />, kbd: 'F4', visible: canView('pos') },
        { to: '/gate', label: 'Soát Vé Cổng', icon: <QrScanIcon size={18} />, visible: canView('gate') },
      ],
    },
    {
      title: 'Khách & Đào tạo',
      items: [
        { to: '/customers', label: 'Khách Hàng', icon: <UsersIcon size={18} />, visible: canView('customers') },
        { to: '/coaches', label: 'Quản lý HLV', icon: <AwardIcon size={18} />, visible: profile.role === 'ADMIN' },
        { to: '/coach-payroll', label: 'Lương HLV', icon: <BanknoteIcon size={18} />, visible: profile.role === 'ADMIN' },
        { to: '/my-students', label: 'Học viên của tôi', icon: <GraduationCapIcon size={18} />, visible: profile.role === 'COACH' },
      ],
    },
    {
      title: 'Tài chính & Kho',
      items: [
        { to: '/dashboard', label: 'Báo Cáo', icon: <ChartBarIcon size={18} />, visible: canView('reports') },
        { to: '/analytics', label: 'Biểu Đồ', icon: <TrendingUpIcon size={18} />, visible: canView('reports') },
        { to: '/orders', label: 'Hóa Đơn', icon: <ReceiptIcon size={18} />, visible: profile.role === 'ADMIN' },
        { to: '/cash', label: 'Quỹ & Phiếu Chi', icon: <WalletIcon size={18} />, visible: Boolean(profile.can_create_expense || profile.role === 'ADMIN') },
        { to: '/inventory', label: 'Quản lý Kho', icon: <BoxIcon size={18} />, visible: Boolean(profile.can_manage_inventory || profile.role === 'ADMIN') },
      ],
    },
    {
      title: 'Hệ thống',
      items: [
        { to: '/staff', label: 'Nhân Sự', icon: <ShieldUserIcon size={18} />, visible: canView('staff') },
        { to: '/settings', label: 'Cài Đặt', icon: <SettingsIcon size={18} />, visible: canView('settings') },
      ],
    },
  ];

  const currentPageTitle = ROUTE_TITLES[location.pathname] || bizName;

  return (
    <div className="app-layout">
      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''} ${isSidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand" title={bizName}>
          <div className="brand-logo-wrap">
            {bizLogo ? (
              <img src={bizLogo} alt="Logo" className="brand-logo-img" />
            ) : (
              <span className="brand-icon">🏊</span>
            )}
          </div>
          {!isSidebarCollapsed && (
            <div className="brand-meta">
              <span className="brand-text">{bizName}</span>
              <span className="brand-subtext">Minads Pool OS</span>
            </div>
          )}
        </div>

        <nav className="sidebar-nav">
          {navGroups.map(group => {
            const visibleItems = group.items.filter(item => item.visible);
            if (visibleItems.length === 0) return null;
            return (
              <div key={group.title} className="nav-group">
                <div className="nav-group-label">{group.title}</div>
                {visibleItems.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    title={isSidebarCollapsed ? item.label : undefined}
                    className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                    onClick={() => setIsSidebarOpen(false)}
                  >
                    <span className="nav-icon">{item.icon}</span>
                    <span className="nav-label">{item.label}</span>
                    {item.kbd && <span className="nav-kbd">{item.kbd}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user-card">
            <div className="user-avatar">{getInitials(profile.full_name)}</div>
            <div className="user-info">
              <div className="user-name">{profile.full_name}</div>
              <div className="user-role">{profile.role}</div>
            </div>
          </div>

          <div className="sidebar-footer-actions">
            <button
              type="button"
              className="sidebar-action-btn"
              title="Đổi mật khẩu cá nhân"
              onClick={() => {
                setNewPassword('');
                setPasswordFeedback(null);
                setShowPasswordModal(true);
              }}
            >
              <KeyIcon size={14} />
              <span>Mật khẩu</span>
            </button>
            <button
              type="button"
              className="sidebar-action-btn"
              title="Đăng xuất"
              onClick={signOut}
            >
              <LogOutIcon size={14} />
              <span>Đăng xuất</span>
            </button>
          </div>

          <div className="copyright-info">
            &copy; {new Date().getFullYear()} <strong>Minads Soft</strong>
          </div>
        </div>
      </aside>

      {/* Main Column: Top Bar + Route Content */}
      <div className="app-main-wrap">
        <header className="app-topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="topbar-icon-btn mobile-menu-btn"
              onClick={() => setIsSidebarOpen(true)}
              aria-label="Mở menu"
            >
              <MenuIcon size={18} />
            </button>
            <button
              type="button"
              className="topbar-icon-btn desktop-collapse-btn"
              onClick={toggleSidebarCollapse}
              title={isSidebarCollapsed ? 'Mở rộng Sidebar' : 'Thu gọn Sidebar'}
              aria-label={isSidebarCollapsed ? 'Mở rộng Sidebar' : 'Thu gọn Sidebar'}
            >
              <PanelLeftIcon size={17} />
            </button>
            <span className="topbar-title">{currentPageTitle}</span>
          </div>

          <div className="topbar-right">
            {canView('pos') && location.pathname !== '/pos' && (
              <Link to="/pos" className="topbar-quick-link">
                <TicketIcon size={15} />
                <span>Bán Vé</span>
              </Link>
            )}
            {canView('gate') && location.pathname !== '/gate' && (
              <Link to="/gate" className="topbar-quick-link">
                <QrScanIcon size={15} />
                <span>Soát Vé</span>
              </Link>
            )}
            <ThemeToggleButton />
          </div>
        </header>

        <main className="main-content">
          <Routes>
            <Route path="/pos" element={canView('pos') ? <POSPage /> : <Navigate to="/gate" />} />
            <Route path="/customers" element={canView('customers') ? <CustomerPage /> : <Navigate to="/pos" />} />
            <Route path="/gate" element={canView('gate') ? <GateCheckPage /> : <Navigate to="/pos" />} />
            <Route path="/dashboard" element={canView('reports') ? <DashboardPage /> : <Navigate to="/pos" />} />
            <Route path="/analytics" element={canView('reports') ? <AnalyticsPage /> : <Navigate to="/pos" />} />
            <Route path="/staff" element={canView('staff') ? <StaffPage /> : <Navigate to="/pos" />} />
            <Route path="/settings" element={canView('settings') ? <SettingsPage /> : <Navigate to="/pos" />} />
            <Route
              path="/inventory"
              element={profile.can_manage_inventory || profile.role === 'ADMIN' ? <InventoryPage /> : <Navigate to="/pos" />}
            />
            <Route
              path="/cash"
              element={profile.can_create_expense || profile.role === 'ADMIN' ? <CashPage /> : <Navigate to="/pos" />}
            />
            <Route path="/orders" element={profile.role === 'ADMIN' ? <OrdersPage /> : <Navigate to="/pos" />} />
            <Route path="/coaches" element={profile.role === 'ADMIN' ? <CoachManagementPage /> : <Navigate to="/pos" />} />
            <Route path="/coach-payroll" element={profile.role === 'ADMIN' ? <CoachPayrollPage /> : <Navigate to="/pos" />} />
            <Route
              path="/my-students"
              element={profile.role === 'COACH' || profile.role === 'ADMIN' ? <CoachDashboardPage /> : <Navigate to="/pos" />}
            />

            <Route
              path="*"
              element={
                <Navigate
                  to={
                    profile.role === 'COACH'
                      ? '/my-students'
                      : canView('reports')
                        ? '/dashboard'
                        : canView('gate')
                          ? '/gate'
                          : '/pos'
                  }
                />
              }
            />
          </Routes>
        </main>
      </div>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!isChangingPassword) {
              setNewPassword('');
              setPasswordFeedback(null);
              setShowPasswordModal(false);
            }
          }}
        >
          <div className="modal-card" style={{ maxWidth: '400px' }} onClick={e => e.stopPropagation()}>
            <h2>Đổi mật khẩu</h2>
            {passwordFeedback && (
              <div className={`alert ${passwordFeedback.type === 'error' ? 'alert-error' : 'alert-success'}`}>
                {passwordFeedback.text}
              </div>
            )}
            <form onSubmit={handleChangePassword}>
              <div className="form-group">
                <label>Mật khẩu mới</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  placeholder="Nhập ít nhất 6 ký tự"
                  autoFocus
                />
              </div>
              <div className="modal-actions" style={{ marginTop: '20px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => {
                    setNewPassword('');
                    setPasswordFeedback(null);
                    setShowPasswordModal(false);
                  }}
                  disabled={isChangingPassword}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={isChangingPassword}
                >
                  {isChangingPassword ? 'Đang đổi...' : 'Đổi mật khẩu'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
