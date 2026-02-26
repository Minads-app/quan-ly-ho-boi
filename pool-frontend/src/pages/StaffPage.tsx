import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createClient } from '@supabase/supabase-js';

// Create a separate Supabase client that doesn't persist the session.
// This allows the Admin to create new users without being logged out.
const tempSupabase = createClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
            storageKey: 'temp_auth_token'
        }
    }
);

interface Profile {
    id: string;
    full_name: string;
    role: 'ADMIN' | 'CASHIER' | 'GATE_KEEPER' | 'STAFF';
    created_at: string;
    is_active?: boolean;
}

export default function StaffPage() {
    const { profile } = useAuth();
    const [staffList, setStaffList] = useState<Profile[]>([]);
    const [loading, setLoading] = useState(true);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    // Modal state for creating new staff
    const [showModal, setShowModal] = useState(false);
    const [newEmail, setNewEmail] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [newFullName, setNewFullName] = useState('');
    const [newRole, setNewRole] = useState('STAFF');
    const [isCreating, setIsCreating] = useState(false);
    const [createError, setCreateError] = useState('');

    useEffect(() => {
        fetchStaff();
    }, []);

    async function fetchStaff() {
        setLoading(true);
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Error fetching staff:', error);
        } else {
            setStaffList(data || []);
        }
        setLoading(false);
    }

    async function handleRoleChange(userId: string, newRole: string) {
        if (!confirm('Bạn có chắc chắn muốn thay đổi chức vụ của nhân viên này?')) return;

        setUpdatingId(userId);
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole })
            .eq('id', userId);

        if (error) {
            alert('Lỗi khi cập nhật chức vụ: ' + error.message);
        } else {
            // Update local state
            setStaffList(prev => prev.map(p => p.id === userId ? { ...p, role: newRole as any } : p));
        }
        setUpdatingId(null);
    }

    async function handleChangeName(userId: string, currentName: string) {
        const newName = prompt('Nhập họ tên mới cho nhân sự này:', currentName);
        if (!newName || newName.trim() === '' || newName === currentName) return;

        setUpdatingId(userId);
        const { error } = await supabase
            .from('profiles')
            .update({ full_name: newName.trim() })
            .eq('id', userId);

        if (error) {
            alert('Lỗi cập nhật tên: ' + error.message);
        } else {
            setStaffList(prev => prev.map(p => p.id === userId ? { ...p, full_name: newName.trim() } : p));
        }
        setUpdatingId(null);
    }

    async function handleToggleActive(userId: string, currentStatus: boolean | undefined) {
        const newStatus = currentStatus === false ? true : false;
        const actionName = newStatus ? 'mở khóa' : 'vô hiệu hóa';
        if (!confirm(`Bạn có chắc chắn muốn ${actionName} tài khoản này?`)) return;

        setUpdatingId(userId);
        const { error } = await supabase
            .from('profiles')
            .update({ is_active: newStatus })
            .eq('id', userId);

        if (error) {
            alert(`Lỗi khi ${actionName}: ` + error.message);
        } else {
            setStaffList(prev => prev.map(p => p.id === userId ? { ...p, is_active: newStatus } : p));
        }
        setUpdatingId(null);
    }

    async function handleCreateStaff(e: React.FormEvent) {
        e.preventDefault();
        setCreateError('');
        setIsCreating(true);

        try {
            // 1. Create user in Supabase Auth using the temp client
            const cleanEmail = newEmail.trim();
            const { data: authData, error: authError } = await tempSupabase.auth.signUp({
                email: cleanEmail,
                password: newPassword,
                options: {
                    data: {
                        full_name: newFullName
                    }
                }
            });

            if (authError) throw new Error(authError.message);
            if (!authData.user) throw new Error('Không thể tạo tài khoản');

            // Wait a brief moment for the database trigger to insert the profile
            await new Promise(resolve => setTimeout(resolve, 800));

            // 2. The trigger created a 'STAFF' role profile. Now we update it to the selected role using the main Admin client.
            const updatePayload: any = { full_name: newFullName };
            if (newRole !== 'STAFF') {
                updatePayload.role = newRole;
            }

            const { error: updateError } = await supabase
                .from('profiles')
                .update(updatePayload)
                .eq('id', authData.user.id);

            if (updateError) throw new Error('Cập nhật quyền thất bại: ' + updateError.message);

            alert('Tạo tài khoản thành công!');
            setShowModal(false);
            setNewEmail('');
            setNewPassword('');
            setNewFullName('');
            setNewRole('STAFF');
            fetchStaff();

        } catch (err: any) {
            setCreateError(err.message || 'Có lỗi xảy ra khi tạo tài khoản');
        } finally {
            setIsCreating(false);
        }
    }

    if (profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">
                    Chỉ ADMIN mới có quyền truy cập trang Quản lý nhân sự.
                </div>
            </div>
        );
    }

    if (loading) return <div className="page-loading">Đang tải danh sách nhân sự...</div>;

    return (
        <div className="page-container">
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>👥 Tài khoản Nhân sự</h1>
                    <p>Quản lý và phân quyền cho nhân viên bán vé, soát vé</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-primary" onClick={() => setShowModal(true)}>
                        ➕ Thêm nhân viên
                    </button>
                    <button className="btn btn-secondary" onClick={fetchStaff}>
                        🔄 Làm mới
                    </button>
                </div>
            </div>

            <div className="dashboard-content-card" style={{ marginTop: '2rem' }}>
                <div className="table-responsive">
                    <table className="data-table">
                        <thead>
                            <tr>
                                <th>Mã NV / Họ tên</th>
                                <th>Ngày đăng ký</th>
                                <th>Trạng thái</th>
                                <th>Vai trò (Phân quyền)</th>
                                <th>Thao tác</th>
                            </tr>
                        </thead>
                        <tbody>
                            {staffList.map(staff => (
                                <tr key={staff.id}>
                                    <td>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <strong>{staff.full_name || 'Chưa nhập tên'}</strong>
                                            <button
                                                className="btn btn-ghost"
                                                style={{ padding: '2px 6px', fontSize: '10px', minHeight: 0, height: 'auto' }}
                                                onClick={() => handleChangeName(staff.id, staff.full_name)}
                                                title="Sửa báo danh"
                                            >
                                                ✏️
                                            </button>
                                        </div>
                                        <div className="text-sm text-slate-400">ID: {staff.id.substring(0, 8)}</div>
                                    </td>
                                    <td>{new Date(staff.created_at).toLocaleDateString('vi-VN')}</td>
                                    <td>
                                        <span className={`badge ${staff.is_active === false ? 'badge-error' : 'badge-success'}`}>
                                            {staff.is_active === false ? 'Đã khóa' : 'Đang hoạt động'}
                                        </span>
                                    </td>
                                    <td>
                                        <span className={`badge ${staff.role === 'ADMIN' ? 'badge-error' : staff.role === 'CASHIER' ? 'badge-success' : staff.role === 'GATE_KEEPER' ? 'badge-warning' : ''}`} style={{ marginBottom: '4px', display: 'inline-block' }}>
                                            {staff.role === 'ADMIN' ? 'Quản trị viên' :
                                                staff.role === 'CASHIER' ? 'NV Bán vé' :
                                                    staff.role === 'GATE_KEEPER' ? 'NV Soát vé' : 'Nhân viên mới'}
                                        </span>
                                        <br />
                                        <select
                                            className="input"
                                            style={{ width: '150px', padding: '0.25rem 0.5rem', fontSize: '0.875rem' }}
                                            value={staff.role}
                                            onChange={(e) => handleRoleChange(staff.id, e.target.value)}
                                            disabled={updatingId === staff.id || staff.id === profile.id}
                                        >
                                            <option value="STAFF">Chưa phân quyền</option>
                                            <option value="CASHIER">NV Bán vé</option>
                                            <option value="GATE_KEEPER">NV Soát vé</option>
                                            <option value="ADMIN">Quản trị viên</option>
                                        </select>
                                    </td>
                                    <td>
                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                            <button
                                                className={`btn ${staff.is_active === false ? 'btn-primary' : 'btn-danger'}`}
                                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', margin: 0 }}
                                                onClick={() => handleToggleActive(staff.id, staff.is_active)}
                                                disabled={updatingId === staff.id || staff.id === profile.id}
                                            >
                                                {staff.is_active === false ? 'Mở khóa' : 'Vô hiệu hóa'}
                                            </button>
                                            {staff.id === profile.id && <span className="text-sm text-slate-400">(Bạn)</span>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Create Staff Modal */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-card">
                        <h2>Tạo tài khoản mới</h2>
                        {createError && <div className="alert alert-error">{createError}</div>}

                        <form onSubmit={handleCreateStaff}>
                            <div className="form-group">
                                <label>Email đăng nhập</label>
                                <input
                                    type="email"
                                    required
                                    value={newEmail}
                                    onChange={e => setNewEmail(e.target.value)}
                                    placeholder="nv.soatve@pool.com"
                                />
                            </div>

                            <div className="form-group">
                                <label>Mật khẩu (ít nhất 6 ký tự)</label>
                                <input
                                    type="password"
                                    required
                                    minLength={6}
                                    value={newPassword}
                                    onChange={e => setNewPassword(e.target.value)}
                                    placeholder="******"
                                />
                            </div>

                            <div className="form-group">
                                <label>Họ và tên</label>
                                <input
                                    type="text"
                                    required
                                    value={newFullName}
                                    onChange={e => setNewFullName(e.target.value)}
                                    placeholder="Nguyễn Văn A"
                                />
                            </div>

                            <div className="form-group">
                                <label>Chức vụ (Vai trò)</label>
                                <select
                                    value={newRole}
                                    onChange={e => setNewRole(e.target.value)}
                                >
                                    <option value="STAFF">Chưa phân quyền (STAFF)</option>
                                    <option value="CASHIER">Nhân viên Bán vé</option>
                                    <option value="GATE_KEEPER">Nhân viên Soát vé</option>
                                    <option value="ADMIN">Quản trị viên</option>
                                </select>
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    style={{ flex: 1 }}
                                    onClick={() => setShowModal(false)}
                                    disabled={isCreating}
                                >
                                    Hủy
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    style={{ flex: 1 }}
                                    disabled={isCreating}
                                >
                                    {isCreating ? 'Đang tạo...' : 'Tạo tài khoản'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
