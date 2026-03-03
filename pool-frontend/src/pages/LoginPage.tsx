import { useState, useEffect, type FormEvent } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

export default function LoginPage() {
    const { signIn } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Business info
    const [bizName, setBizName] = useState('Hồ bơi HBA Minh Khai');
    const [bizLogo, setBizLogo] = useState('');

    useEffect(() => {
        async function fetchBizInfo() {
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
            <div className="login-card">
                <div className="login-header">
                    {bizLogo ? (
                        <div style={{ marginBottom: '16px' }}>
                            <img src={bizLogo} alt="Logo" style={{ maxHeight: '80px', maxWidth: '100%', objectFit: 'contain' }} />
                        </div>
                    ) : (
                        <div className="login-icon">🏊</div>
                    )}
                    <h1>{bizName}</h1>
                    <p>Đăng nhập để tiếp tục</p>
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
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                        />
                    </div>

                    <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
                        {loading ? 'Đang đăng nhập...' : 'Đăng nhập'}
                    </button>
                </form>
            </div>
        </div>
    );
}
