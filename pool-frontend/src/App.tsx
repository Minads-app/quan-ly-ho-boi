import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './contexts/AuthContext';

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
import './index.css';

function AppRoutes() {
  const { user, profile, loading, signOut } = useAuth();
  const [bizName, setBizName] = useState('Vé Bơi');
  const [bizLogo, setBizLogo] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  // Change password state
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) return alert('Mật khẩu phải từ 6 ký tự trở lên');
    setIsChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsChangingPassword(false);
    if (error) {
      alert('Lỗi đổi mật khẩu: ' + error.message);
    } else {
      alert('Đổi mật khẩu thành công!');
      setShowPasswordModal(false);
      setNewPassword('');
    }
  }

  useEffect(() => {
    async function loadBiz() {
      const { data } = await supabase.from('system_settings').select('key, value').in('key', ['business_name', 'business_logo']);
      if (data) {
        data.forEach(r => {
          let val = '';
          try {
            val = typeof r.value === 'string' ? r.value.replace(/^"|"$/g, '') : JSON.parse(JSON.stringify(r.value)).replace(/^"|"$/g, '');
          } catch (e) {
            val = typeof r.value === 'string' ? r.value : String(r.value);
          }
          if (r.key === 'business_name' && val) setBizName(val);
          if (r.key === 'business_logo' && val) setBizLogo(val);
        });
      }
    }
    loadBiz();
  }, []);

  if (loading) {
    return (
      <div className="app-loading">
        <div className="spinner"></div>
        <p>Đang tải...</p>
      </div>
    );
  }

  if (!user || !profile) {
    return <LoginPage />;
  }

  // Helper check for admin bypass or specific module view access
  const canView = (module: string) => {
    try {
      if (profile.role === 'ADMIN') return true;
      const perms = profile.permissions as any;
      // Nếu chưa có permissions trong DB → cho xem POS mặc định
      if (!perms || typeof perms !== 'object') {
        return module === 'pos'; // Mặc định: chỉ cho xem POS
      }
      if (!perms[module] || typeof perms[module] !== 'object') {
        return module === 'pos'; // Module chưa thiết lập → POS mặc định true
      }
      return !!perms[module].view;
    } catch {
      return module === 'pos';
    }
  };

  return (
    <div className="app-layout">
      {/* Mobile Header */}
      <div className="mobile-header">
        <button className="menu-btn" onClick={() => setIsSidebarOpen(true)}>
          <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <span className="mobile-brand">{bizName}</span>
      </div>

      {/* Sidebar Overlay for Mobile */}
      {isSidebarOpen && (
        <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)}></div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
        <div className="sidebar-brand" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '16px 0' }}>
          {bizLogo ? (
            <img src={bizLogo} alt="Logo" style={{ height: '64px', width: 'auto', maxWidth: '80%', objectFit: 'contain', borderRadius: '4px' }} />
          ) : (
            <span className="brand-icon" style={{ fontSize: '32px' }}>🏊</span>
          )}
          <span className="brand-text" style={{ fontSize: bizName.length > 15 ? '14px' : '16px', textAlign: 'center', lineHeight: 1.3 }}>{bizName}</span>
        </div>

        <nav className="sidebar-nav">
          {/* Bán Vé */}
          {canView('pos') && (
            <NavLink to="/pos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">🎫</span>
              <span>Bán Vé</span>
            </NavLink>
          )}

          {/* Soát Vé */}
          {canView('gate') && (
            <NavLink to="/gate" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">🔍</span>
              <span>Soát Vé</span>
            </NavLink>
          )}

          {canView('customers') && (
            <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">👥</span>
              <span>Khách Hàng</span>
            </NavLink>
          )}

          {canView('reports') && (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">📊</span>
                <span>Báo Cáo</span>
              </NavLink>
              <NavLink to="/analytics" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">📈</span>
                <span>Biểu Đồ</span>
              </NavLink>
            </>
          )}

          {/* New Retail & Cash Modules */}
          {(profile.can_manage_inventory || profile.role === 'ADMIN') && (
            <NavLink to="/inventory" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">📦</span>
              <span>Quản lý Kho</span>
            </NavLink>
          )}

          {(profile.can_create_expense || profile.role === 'ADMIN') && (
            <NavLink to="/cash" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">💵</span>
              <span>Quỹ & Phiếu Chi</span>
            </NavLink>
          )}

          {/* Management Menu */}
          {canView('staff') && (
            <NavLink to="/staff" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">👥</span>
              <span>Nhân Sự</span>
            </NavLink>
          )}

          {canView('settings') && (
            <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">⚙️</span>
              <span>Cài Đặt</span>
            </NavLink>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-name">{profile.full_name}</div>
            <div className="user-role">{profile.role}</div>
            <button
              className="btn btn-ghost"
              style={{ marginTop: '8px', padding: '4px 8px', fontSize: '11px', width: '100%' }}
              onClick={() => setShowPasswordModal(true)}
            >
              🔑 Đổi mật khẩu
            </button>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={signOut}>
            Đăng xuất
          </button>

          {/* Copyright Info */}
          <div className="copyright-info" style={{
            marginTop: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            textAlign: 'center',
            borderTop: '1px dotted #2a2e3b',
            paddingTop: '12px'
          }}>
            &copy; {new Date().getFullYear()} <strong>Minads Soft</strong><br />
            All rights reserved.
          </div>
        </div>
      </aside>

      {/* Main content */}
      <main className="main-content">
        <Routes>
          {/* Default POS Route for anyone logged in (Gate keepers get redirected internally or UI is restricted) */}
          <Route path="/pos" element={
            canView('pos') ? <POSPage /> : <Navigate to="/gate" />
          } />

          <Route path="/customers" element={
            canView('customers') ? <CustomerPage /> : <Navigate to="/pos" />
          } />

          {/* Gate Scan */}
          <Route path="/gate" element={
            canView('gate') ? <GateCheckPage /> : <Navigate to="/pos" />
          } />

          {/* Reports & Analytics */}
          <Route path="/dashboard" element={
            canView('reports') ? <DashboardPage /> : <Navigate to="/pos" />
          } />
          <Route path="/analytics" element={
            canView('reports') ? <AnalyticsPage /> : <Navigate to="/pos" />
          } />

          {/* Staff & Settings */}
          <Route path="/staff" element={
            canView('staff') ? <StaffPage /> : <Navigate to="/pos" />
          } />
          <Route path="/settings" element={
            canView('settings') ? <SettingsPage /> : <Navigate to="/pos" />
          } />

          {/* Inventory & Cash */}
          <Route path="/inventory" element={
            profile.can_manage_inventory || profile.role === 'ADMIN' ? <InventoryPage /> : <Navigate to="/pos" />
          } />
          <Route path="/cash" element={
            profile.can_create_expense || profile.role === 'ADMIN' ? <CashPage /> : <Navigate to="/pos" />
          } />

          {/* Mặc định Redirect */}
          <Route path="*" element={
            <Navigate to={
              canView('reports') ? "/dashboard" :
                canView('gate') ? "/gate" :
                  canView('pos') ? "/pos" : "/pos"
            } />
          } />
        </Routes>
      </main>

      {/* Change Password Modal */}
      {showPasswordModal && (
        <div className="modal-overlay">
          <div className="modal-card" style={{ maxWidth: '400px' }}>
            <h2>Đổi mật khẩu</h2>
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
                />
              </div>
              <div className="modal-actions" style={{ marginTop: '24px' }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ flex: 1 }}
                  onClick={() => setShowPasswordModal(false)}
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
    <BrowserRouter>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}
