import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, NavLink } from 'react-router-dom';
import { supabase } from './lib/supabase';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import LoginPage from './pages/LoginPage';
import POSPage from './pages/POSPage';
import GateCheckPage from './pages/GateCheckPage';
import SettingsPage from './pages/SettingsPage';
import DashboardPage from './pages/DashboardPage';
import StaffPage from './pages/StaffPage';
import CustomerPage from './pages/CustomerPage';
import './index.css';

function AppRoutes() {
  const { user, profile, loading, signOut } = useAuth();
  const [bizName, setBizName] = useState('Vé Bơi');
  const [bizLogo, setBizLogo] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

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
          {/* Menu Bán Vé: Dành cho Admin và Cashier (và Staff mới) */}
          {['ADMIN', 'CASHIER', 'STAFF'].includes(profile.role) && (
            <>
              <NavLink to="/pos" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">🎫</span>
                <span>Bán Vé</span>
              </NavLink>
              <NavLink to="/customers" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">👥</span>
                <span>Khách Hàng</span>
              </NavLink>
              <NavLink to="/dashboard" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">📈</span>
                <span>Báo Cáo</span>
              </NavLink>
            </>
          )}

          {/* Menu Soát Vé: Dành cho Admin và Gate Keeper */}
          {['ADMIN', 'GATE_KEEPER'].includes(profile.role) && (
            <NavLink to="/gate" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
              <span className="nav-icon">🔍</span>
              <span>Soát Vé</span>
            </NavLink>
          )}

          {/* Menu Quản lý: Chỉ dành cho Admin */}
          {profile.role === 'ADMIN' && (
            <>
              <NavLink to="/staff" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">👥</span>
                <span>Tài Khoản</span>
              </NavLink>
              <NavLink to="/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`} onClick={() => setIsSidebarOpen(false)}>
                <span className="nav-icon">⚙️</span>
                <span>Cài Đặt</span>
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-name">{profile.full_name}</div>
            <div className="user-role">{profile.role}</div>
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
          {/* Route Bán Vé */}
          <Route path="/pos" element={
            ['ADMIN', 'CASHIER', 'STAFF'].includes(profile.role) ? <POSPage /> : <Navigate to="/gate" />
          } />
          <Route path="/customers" element={
            ['ADMIN', 'CASHIER', 'STAFF'].includes(profile.role) ? <CustomerPage /> : <Navigate to="/gate" />
          } />

          {/* Route Soát Vé */}
          <Route path="/gate" element={
            ['ADMIN', 'GATE_KEEPER'].includes(profile.role) ? <GateCheckPage /> : <Navigate to="/pos" />
          } />

          {/* Routes dành riêng cho Admin */}
          <Route path="/dashboard" element={
            ['ADMIN', 'CASHIER', 'STAFF'].includes(profile.role) ? <DashboardPage /> : <Navigate to="/pos" />
          } />
          <Route path="/staff" element={
            profile.role === 'ADMIN' ? <StaffPage /> : <Navigate to="/pos" />
          } />
          <Route path="/settings" element={
            profile.role === 'ADMIN' ? <SettingsPage /> : <Navigate to="/pos" />
          } />

          {/* Mặc định Redirect */}
          <Route path="*" element={
            <Navigate to={
              profile.role === 'ADMIN' ? "/dashboard" :
                profile.role === 'GATE_KEEPER' ? "/gate" : "/pos"
            } />
          } />
        </Routes>
      </main>
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
