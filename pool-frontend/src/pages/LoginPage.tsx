import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { ThemeToggleButton } from '../components/ui';
import { EyeIcon, EyeOffIcon } from '../components/ui/Icons';

export default function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Business info
  const [bizName, setBizName] = useState('Hồ bơi HBA Minh Khai');
  const [bizLogo, setBizLogo] = useState('');

  useEffect(() => {
    async function fetchBizInfo() {
      const { data } = await supabase
        .from('system_settings')
        .select('key, value')
        .in('key', ['business_name', 'business_logo']);
      if (data) {
        data.forEach(r => {
          let val = '';
          try {
            val = typeof r.value === 'string'
              ? r.value.replace(/^"|"$/g, '')
              : JSON.parse(JSON.stringify(r.value)).replace(/^"|"$/g, '');
          } catch {
            val = typeof r.value === 'string' ? r.value : String(r.value);
          }
          if (r.key === 'business_name' && val) setBizName(val);
          if (r.key === 'business_logo' && val) setBizLogo(val);
        });
      }
    }
    fetchBizInfo();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const err = await signIn(email, password);
    if (err) setError(err);
    setLoading(false);
  }

  return (
    <div className="login-container">
      <div className="login-theme-corner">
        <ThemeToggleButton />
      </div>

      <div className="login-split-card">
        <div className="login-showcase">
          <div className="login-showcase-badge">Pool Ticket &amp; Gate OS</div>

          <div>
            {bizLogo ? (
              <img src={bizLogo} alt="Logo" className="login-showcase-logo" />
            ) : (
              <div className="login-showcase-icon">🏊</div>
            )}
            <h1>{bizName}</h1>
            <p>
              Hệ thống quản lý bán vé, kiểm soát cổng QR, thẻ hội viên và doanh thu quầy theo thời gian thực.
            </p>
          </div>

          <div className="login-showcase-footer">
            &copy; {new Date().getFullYear()} Minads Soft · Phiên bản quầy &amp; cổng
          </div>
        </div>

        <div className="login-card">
          <div className="login-header">
            <h2>Đăng nhập hệ thống</h2>
            <p>Nhập tài khoản nhân sự để bắt đầu ca làm việc</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form">
            {error && <div className="alert alert-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="staff@example.com"
                required
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="password">Mật khẩu</label>
              <div className="password-input-wrap">
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  className="password-eye-btn"
                  onClick={() => setShowPassword(prev => !prev)}
                  aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                >
                  {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="btn btn-primary btn-full" style={{ marginTop: '6px', padding: '11px 16px' }} disabled={loading}>
              {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
