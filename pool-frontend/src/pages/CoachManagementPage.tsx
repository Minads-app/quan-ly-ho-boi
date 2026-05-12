/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Coach } from '../types';

export default function CoachManagementPage() {
    const { profile } = useAuth();
    const [coaches, setCoaches] = useState<Coach[]>([]);
    const [loading, setLoading] = useState(true);

    // Modal
    const [showModal, setShowModal] = useState(false);
    const [editingCoach, setEditingCoach] = useState<Coach | null>(null);
    const [formName, setFormName] = useState('');
    const [formPhone, setFormPhone] = useState('');
    const [formSpecialty, setFormSpecialty] = useState('');
    const [formNote, setFormNote] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => { fetchCoaches(); }, []);

    async function fetchCoaches() {
        setLoading(true);
        const { data, error } = await supabase.from('coaches').select('*').order('created_at', { ascending: false });
        if (error) console.error(error);
        setCoaches(data || []);
        setLoading(false);
    }

    function openCreate() {
        setEditingCoach(null);
        setFormName(''); setFormPhone(''); setFormSpecialty(''); setFormNote('');
        setShowModal(true);
    }

    function openEdit(c: Coach) {
        setEditingCoach(c);
        setFormName(c.full_name);
        setFormPhone(c.phone || '');
        setFormSpecialty(c.specialty || '');
        setFormNote(c.note || '');
        setShowModal(true);
    }

    async function handleSave(e: React.FormEvent) {
        e.preventDefault();
        if (!formName.trim()) return;
        setSaving(true);

        if (editingCoach) {
            const { error } = await supabase.from('coaches')
                .update({ full_name: formName.trim(), phone: formPhone.trim() || null, specialty: formSpecialty.trim() || null, note: formNote.trim() || null, updated_at: new Date().toISOString() })
                .eq('id', editingCoach.id);
            if (error) alert('Lỗi cập nhật: ' + error.message);
        } else {
            const { error } = await supabase.from('coaches')
                .insert({ full_name: formName.trim(), phone: formPhone.trim() || null, specialty: formSpecialty.trim() || null, note: formNote.trim() || null });
            if (error) alert('Lỗi tạo HLV: ' + error.message);
        }

        setSaving(false);
        setShowModal(false);
        fetchCoaches();
    }

    async function handleToggleActive(coach: Coach) {
        const newStatus = !coach.is_active;
        const action = newStatus ? 'kích hoạt lại' : 'vô hiệu hóa';
        if (!confirm(`Bạn có chắc muốn ${action} HLV "${coach.full_name}"?`)) return;

        const { error } = await supabase.from('coaches').update({ is_active: newStatus }).eq('id', coach.id);
        if (error) alert('Lỗi: ' + error.message);
        else fetchCoaches();
    }

    if (profile?.role !== 'ADMIN') {
        return <div className="page-container"><div className="alert alert-error">Chỉ ADMIN mới có quyền truy cập trang này.</div></div>;
    }

    return (
        <div className="page-container">
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>🏊 Quản lý Huấn Luyện Viên</h1>
                    <p>Danh sách HLV đang hoạt động</p>
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button className="btn btn-primary" onClick={openCreate}>➕ Thêm HLV</button>
                    <button className="btn btn-secondary" onClick={fetchCoaches}>🔄 Làm mới</button>
                </div>
            </div>

            <div className="dashboard-content-card" style={{ marginTop: '2rem' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Đang tải...</div>
                ) : coaches.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>
                        <div style={{ fontSize: '48px', marginBottom: '12px' }}>🏊</div>
                        <p>Chưa có HLV nào. Bấm "Thêm HLV" để bắt đầu.</p>
                    </div>
                ) : (
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>Họ tên</th>
                                    <th>SĐT</th>
                                    <th>Chuyên môn</th>
                                    <th>Ghi chú</th>
                                    <th>Tài khoản</th>
                                    <th>Trạng thái</th>
                                    <th>Thao tác</th>
                                </tr>
                            </thead>
                            <tbody>
                                {coaches.map(c => (
                                    <tr key={c.id} style={{ opacity: c.is_active ? 1 : 0.5 }}>
                                        <td><strong>{c.full_name}</strong></td>
                                        <td>{c.phone || '—'}</td>
                                        <td>{c.specialty || '—'}</td>
                                        <td style={{ fontSize: '13px', color: '#64748b', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                            {c.note || '—'}
                                        </td>
                                        <td>
                                            {c.profile_id ? (
                                                <span className="badge badge-success" style={{ fontSize: '11px' }}>✅ Có tài khoản</span>
                                            ) : (
                                                <span className="badge" style={{ fontSize: '11px', background: '#f1f5f9', color: '#94a3b8' }}>Không có TK</span>
                                            )}
                                        </td>
                                        <td>
                                            <span className={`badge ${c.is_active ? 'badge-success' : 'badge-error'}`}>
                                                {c.is_active ? 'Hoạt động' : 'Đã tắt'}
                                            </span>
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '12px' }}
                                                    onClick={() => openEdit(c)}>✏️ Sửa</button>
                                                <button className={`btn ${c.is_active ? 'btn-danger' : 'btn-primary'}`}
                                                    style={{ padding: '4px 8px', fontSize: '12px' }}
                                                    onClick={() => handleToggleActive(c)}>
                                                    {c.is_active ? 'Tắt' : 'Bật'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Modal thêm/sửa HLV */}
            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '450px' }}>
                        <h2>{editingCoach ? 'Sửa thông tin HLV' : 'Thêm HLV mới'}</h2>
                        <form onSubmit={handleSave}>
                            <div className="form-group">
                                <label>Họ và tên <span style={{ color: 'red' }}>*</span></label>
                                <input type="text" required value={formName} onChange={e => setFormName(e.target.value)} placeholder="Nguyễn Văn A" />
                            </div>
                            <div className="form-group">
                                <label>Số điện thoại <span style={{ color: 'red' }}>*</span></label>
                                <input type="tel" required value={formPhone} onChange={e => setFormPhone(e.target.value)} placeholder="0901234567" />
                            </div>
                            <div className="form-group">
                                <label>Chuyên môn</label>
                                <select value={formSpecialty} onChange={e => setFormSpecialty(e.target.value)}>
                                    <option value="">-- Chọn chuyên môn --</option>
                                    <option value="Bơi lội">Bơi lội</option>
                                    <option value="Bóng rổ">Bóng rổ</option>
                                    <option value="Cầu lông">Cầu lông</option>
                                    <option value="Tennis">Tennis</option>
                                    <option value="Võ thuật">Võ thuật</option>
                                    <option value="Gym/Fitness">Gym/Fitness</option>
                                    <option value="Khác">Khác</option>
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Ghi chú</label>
                                <input type="text" value={formNote} onChange={e => setFormNote(e.target.value)} placeholder="Chuyên môn, lịch dạy..." />
                            </div>
                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                                    {saving ? 'Đang lưu...' : editingCoach ? 'Cập nhật' : 'Tạo HLV'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
