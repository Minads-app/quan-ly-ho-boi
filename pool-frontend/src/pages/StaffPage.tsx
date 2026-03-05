/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { createClient } from '@supabase/supabase-js';
import type { PermissionsMatrix } from '../types';

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
    can_use_camera?: boolean;
    can_create_expense?: boolean;
    can_manage_inventory?: boolean;
    permissions?: PermissionsMatrix;
}

const defaultPermissions: PermissionsMatrix = {
    pos: { view: true },
    gate: { view: false },
    customers: { view: false, create: false, edit: false, delete: false },
    packages: { view: false, create: false, edit: false, delete: false },
    reports: { view: false, export: false },
    staff: { view: false, create: false, edit: false, delete: false },
    settings: { view: false, edit: false }
};

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

    // Modal state for Admin Reset Password
    const [showResetModal, setShowResetModal] = useState(false);
    const [resetStaff, setResetStaff] = useState<Profile | null>(null);
    const [adminNewPassword, setAdminNewPassword] = useState('');
    const [isResetting, setIsResetting] = useState(false);

    // Modal state for Permissions Matrix
    const [showPermModal, setShowPermModal] = useState(false);
    const [selectedStaff, setSelectedStaff] = useState<Profile | null>(null);
    const [tempPermissions, setTempPermissions] = useState<PermissionsMatrix>(defaultPermissions);
    const [tempCreateExpense, setTempCreateExpense] = useState(false);
    const [tempManageInventory, setTempManageInventory] = useState(false);
    const [isSavingPerms, setIsSavingPerms] = useState(false);

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

    async function handleToggleCameraAuth(userId: string, currentStatus: boolean | undefined) {
        const newStatus = !currentStatus;
        if (!confirm(`Bạn có muốn ${newStatus ? 'CẤP' : 'HỦY'} quyền dùng Camera điện thoại quét vé của nhân viên này?`)) return;

        setUpdatingId(userId);
        const { error } = await supabase
            .from('profiles')
            .update({ can_use_camera: newStatus })
            .eq('id', userId);

        if (error) {
            alert(`Lỗi khi cập nhật quyền Camera: ` + error.message);
        } else {
            setStaffList(prev => prev.map(p => p.id === userId ? { ...p, can_use_camera: newStatus } : p));
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

    function openPermissionsModal(staff: Profile) {
        setSelectedStaff(staff);
        // Deep merge: đảm bảo mỗi module đều có đầy đủ key, kể cả khi DB lưu thiếu
        const saved = staff.permissions as any;
        const merged: PermissionsMatrix = JSON.parse(JSON.stringify(defaultPermissions));
        if (saved && typeof saved === 'object') {
            for (const mod of Object.keys(merged) as (keyof PermissionsMatrix)[]) {
                if (saved[mod] && typeof saved[mod] === 'object') {
                    merged[mod] = { ...merged[mod], ...saved[mod] };
                }
            }
        }
        setTempPermissions(merged);
        setTempCreateExpense(staff.can_create_expense || false);
        setTempManageInventory(staff.can_manage_inventory || false);
        setShowPermModal(true);
    }

    async function handleSavePermissions() {
        if (!selectedStaff) return;
        setIsSavingPerms(true);

        const { error } = await supabase
            .from('profiles')
            .update({
                permissions: tempPermissions,
                can_create_expense: tempCreateExpense,
                can_manage_inventory: tempManageInventory
            })
            .eq('id', selectedStaff.id);

        if (error) {
            alert('Lỗi lưu quyền: ' + error.message);
        } else {
            setStaffList(prev => prev.map(p => p.id === selectedStaff.id ? {
                ...p,
                permissions: tempPermissions,
                can_create_expense: tempCreateExpense,
                can_manage_inventory: tempManageInventory
            } : p));
            setShowPermModal(false);
            alert('Cập nhật phân quyền thành công!');
        }
        setShowPermModal(false);
        setIsSavingPerms(false);
    }

    async function handleAdminResetPassword(e: React.FormEvent) {
        e.preventDefault();
        if (!resetStaff) return;
        if (adminNewPassword.length < 6) return alert('Mật khẩu phải từ 6 ký tự trở lên');

        if (!confirm(`Xác nhận đổi mật khẩu cho nhân sự: ${resetStaff.full_name}?`)) return;

        setIsResetting(true);
        const { data, error } = await supabase.rpc('admin_reset_user_password', {
            p_user_id: resetStaff.id,
            p_new_password: adminNewPassword
        });

        setIsResetting(false);

        if (error) {
            alert('Lỗi khi đổi mật khẩu: ' + error.message);
        } else if (data && data.success === false) {
            alert('Lỗi: ' + data.error);
        } else {
            alert('Đổi mật khẩu thành công!');
            setShowResetModal(false);
            setAdminNewPassword('');
            setResetStaff(null);
        }
    }

    function handlePermChange(module: keyof PermissionsMatrix, action: string, value: boolean) {
        setTempPermissions(prev => ({
            ...prev,
            [module]: {
                ...prev[module],
                [action]: value
            }
        }));
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
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <button
                                                    className={`btn ${staff.is_active === false ? 'btn-primary' : 'btn-danger'}`}
                                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', margin: 0, width: '100px' }}
                                                    onClick={() => handleToggleActive(staff.id, staff.is_active)}
                                                    disabled={updatingId === staff.id || staff.id === profile.id}
                                                >
                                                    {staff.is_active === false ? 'Mở khóa' : 'Vô hiệu hóa'}
                                                </button>
                                                {staff.id === profile.id && <span className="text-sm text-slate-400">(Bạn)</span>}
                                            </div>
                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                <button
                                                    className={`btn ${staff.can_use_camera ? 'btn-danger' : 'btn-secondary'}`}
                                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', margin: 0, width: '100px' }}
                                                    onClick={() => handleToggleCameraAuth(staff.id, staff.can_use_camera)}
                                                    disabled={updatingId === staff.id}
                                                    title={staff.can_use_camera ? "Thu hồi quyền dùng Camera điện thoại để quét mã" : "Cấp quyền dùng Camera điện thoại quét mã"}
                                                >
                                                    {staff.can_use_camera ? 'Cấm Camera' : 'Cấp Camera'}
                                                </button>
                                                <button
                                                    className="btn btn-warning"
                                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', margin: 0 }}
                                                    onClick={() => openPermissionsModal(staff)}
                                                    disabled={staff.role === 'ADMIN'}
                                                    title={staff.role === 'ADMIN' ? "Quản trị viên luôn có toàn quyền" : "Phân quyền chi tiết (Xem, Thêm, Sửa, Xóa)"}
                                                >
                                                    ⚙️ Phân quyền
                                                </button>
                                                <button
                                                    className="btn btn-ghost"
                                                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', margin: 0, border: '1px solid #e2e8f0' }}
                                                    onClick={() => { setResetStaff(staff); setShowResetModal(true); setAdminNewPassword(''); }}
                                                    title="Trưởng quản lý đổi mật khẩu cho nhân sự này"
                                                >
                                                    🔑 Đổi MK
                                                </button>
                                            </div>
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

            {/* Reset Password Modal */}
            {showResetModal && resetStaff && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '400px' }}>
                        <h2>Đổi mật khẩu cho: {resetStaff.full_name}</h2>
                        <form onSubmit={handleAdminResetPassword}>
                            <div className="form-group">
                                <label>Mật khẩu mới (ít nhất 6 ký tự)</label>
                                <input
                                    type="password"
                                    required
                                    minLength={6}
                                    value={adminNewPassword}
                                    onChange={e => setAdminNewPassword(e.target.value)}
                                    placeholder="******"
                                />
                            </div>
                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button
                                    type="button"
                                    className="btn btn-ghost"
                                    style={{ flex: 1 }}
                                    onClick={() => { setShowResetModal(false); setResetStaff(null); }}
                                    disabled={isResetting}
                                >
                                    Hủy
                                </button>
                                <button
                                    type="submit"
                                    className="btn btn-primary"
                                    style={{ flex: 1 }}
                                    disabled={isResetting}
                                >
                                    {isResetting ? 'Đang đổi...' : 'Xác nhận Đổi MK'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Permission Matrix Modal */}
            {showPermModal && selectedStaff && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '600px' }}>
                        <h2>Phân quyền chi tiết</h2>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Tinh chỉnh quyền hạn cho nhân viên: <strong>{selectedStaff.full_name}</strong>
                        </p>

                        <div style={{ overflowX: 'auto', marginBottom: '20px' }}>
                            <table className="data-table" style={{ width: '100%', fontSize: '14px' }}>
                                <thead>
                                    <tr>
                                        <th style={{ textAlign: 'left' }}>Chức năng</th>
                                        <th style={{ textAlign: 'center' }}>Xem</th>
                                        <th style={{ textAlign: 'center' }}>Thêm</th>
                                        <th style={{ textAlign: 'center' }}>Sửa</th>
                                        <th style={{ textAlign: 'center' }}>Xóa / In</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* Bán Vé */}
                                    <tr style={{ background: 'rgba(59,130,246,0.05)' }}>
                                        <td><strong>🎫 Bán Vé (POS)</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.pos?.view ?? true} onChange={e => handlePermChange('pos', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                    </tr>
                                    {/* Soát Vé */}
                                    <tr style={{ background: 'rgba(16,185,129,0.05)' }}>
                                        <td><strong>🚪 Soát Vé (Cổng)</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.gate?.view ?? false} onChange={e => handlePermChange('gate', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                    </tr>
                                    {/* Khách hàng */}
                                    <tr>
                                        <td><strong>👥 Khách hàng</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.customers?.view ?? false} onChange={e => handlePermChange('customers', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.customers?.create ?? false} onChange={e => handlePermChange('customers', 'create', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.customers?.edit ?? false} onChange={e => handlePermChange('customers', 'edit', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.customers?.delete ?? false} onChange={e => handlePermChange('customers', 'delete', e.target.checked)} /></td>
                                    </tr>
                                    {/* Gói DV */}
                                    <tr>
                                        <td><strong>📦 Dịch vụ / Gói Bơi</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.packages?.view ?? false} onChange={e => handlePermChange('packages', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.packages?.create ?? false} onChange={e => handlePermChange('packages', 'create', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.packages?.edit ?? false} onChange={e => handlePermChange('packages', 'edit', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.packages?.delete ?? false} onChange={e => handlePermChange('packages', 'delete', e.target.checked)} /></td>
                                    </tr>
                                    {/* Báo cáo */}
                                    <tr>
                                        <td><strong>📊 Báo cáo & Biểu đồ</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.reports?.view ?? false} onChange={e => handlePermChange('reports', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center' }}><label><input type="checkbox" checked={tempPermissions.reports?.export ?? false} onChange={e => handlePermChange('reports', 'export', e.target.checked)} /> In</label></td>
                                    </tr>
                                    {/* Tài khoản */}
                                    <tr>
                                        <td><strong>🔑 Tài Khoản Nhân Sự</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.staff?.view ?? false} onChange={e => handlePermChange('staff', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.staff?.create ?? false} onChange={e => handlePermChange('staff', 'create', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.staff?.edit ?? false} onChange={e => handlePermChange('staff', 'edit', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.staff?.delete ?? false} onChange={e => handlePermChange('staff', 'delete', e.target.checked)} /></td>
                                    </tr>
                                    {/* Cài đặt */}
                                    <tr>
                                        <td><strong>⚙️ Cài đặt Hệ thống</strong></td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.settings?.view ?? false} onChange={e => handlePermChange('settings', 'view', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={tempPermissions.settings?.edit ?? false} onChange={e => handlePermChange('settings', 'edit', e.target.checked)} /></td>
                                        <td style={{ textAlign: 'center', color: '#94a3b8' }}>—</td>
                                    </tr>
                                    {/* Quản lý Kho */}
                                    <tr style={{ background: 'rgba(234,88,12,0.05)' }}>
                                        <td><strong>📦 Quản lý Kho (Sản phẩm)</strong></td>
                                        <td colSpan={4} style={{ textAlign: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={tempManageInventory} onChange={e => setTempManageInventory(e.target.checked)} />
                                                <span>Có quyền Quản lý kho (Nhập/Xuất/Tồn)</span>
                                            </label>
                                        </td>
                                    </tr>
                                    {/* Phiếu Chi */}
                                    <tr style={{ background: 'rgba(234,88,12,0.05)' }}>
                                        <td><strong>💵 Quản lý Quỹ (Phiếu chi)</strong></td>
                                        <td colSpan={4} style={{ textAlign: 'center' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', cursor: 'pointer' }}>
                                                <input type="checkbox" checked={tempCreateExpense} onChange={e => setTempCreateExpense(e.target.checked)} />
                                                <span>Có quyền Lập phiếu chi tiền mặt</span>
                                            </label>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="modal-actions" style={{ marginTop: '24px' }}>
                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowPermModal(false)} disabled={isSavingPerms}>
                                Hủy
                            </button>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSavePermissions} disabled={isSavingPerms}>
                                {isSavingPerms ? 'Đang lưu...' : 'Lưu Quyền'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
