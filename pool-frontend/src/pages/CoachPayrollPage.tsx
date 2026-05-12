/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { Coach, CoachAttendance } from '../types';
import { ToastProvider, toast } from '../components/Toast';

interface CheckinRecord {
    checkin_log_id: string;
    checked_in_at: string;
    customer_name: string;
    ticket_type_name: string;
    per_session_amount: number;
}

interface PayrollSummary {
    coach_id: string;
    coach_name: string;
    private_total: number;
    private_sessions: number;
    group_total: number;
    group_sessions: number;
    grand_total: number;
}

export default function CoachPayrollPage() {
    const { profile } = useAuth();
    const [coaches, setCoaches] = useState<Coach[]>([]);
    const [loading, setLoading] = useState(true);
    const [month, setMonth] = useState(() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    // Group attendance (manual entry)
    const [showGroupModal, setShowGroupModal] = useState(false);
    const [groupCoachId, setGroupCoachId] = useState('');
    const [groupClassName, setGroupClassName] = useState('Lớp nhóm');
    const [groupDate, setGroupDate] = useState(new Date().toISOString().split('T')[0]);
    const [groupAmount, setGroupAmount] = useState<number | ''>('');
    const [groupNote, setGroupNote] = useState('');
    const [groupSaving, setGroupSaving] = useState(false);

    // Payroll data
    const [groupAttendances, setGroupAttendances] = useState<CoachAttendance[]>([]);
    const [checkinRecords, setCheckinRecords] = useState<CheckinRecord[]>([]);
    const [payrollSummaries, setPayrollSummaries] = useState<PayrollSummary[]>([]);

    // Detail view
    const [selectedCoachDetail, setSelectedCoachDetail] = useState<string | null>(null);

    useEffect(() => { fetchCoaches(); }, []);
    useEffect(() => { if (coaches.length > 0) fetchPayrollData(); }, [month, coaches]);

    async function fetchCoaches() {
        const { data } = await supabase.from('coaches').select('*').order('full_name');
        setCoaches(data || []);
        setLoading(false);
    }

    async function fetchPayrollData() {
        const [y, m] = month.split('-').map(Number);
        const startDate = `${y}-${String(m).padStart(2, '0')}-01`;
        const endDate = new Date(y, m, 0).toISOString().split('T')[0]; // last day

        // 1. GROUP attendance (from coach_attendances)
        const { data: gData } = await supabase
            .from('coach_attendances')
            .select('*, coaches(full_name), profiles:created_by(full_name)')
            .gte('teaching_date', startDate)
            .lte('teaching_date', endDate)
            .order('teaching_date', { ascending: false });
        setGroupAttendances((gData || []) as any);

        // 2. PRIVATE lesson check-ins (from view)
        const { data: ciData } = await supabase
            .from('coach_checkin_summary')
            .select('*')
            .gte('checked_in_at', startDate + 'T00:00:00')
            .lte('checked_in_at', endDate + 'T23:59:59');
        setCheckinRecords((ciData || []) as any);

        // Build summaries
        const summaryMap: Record<string, PayrollSummary> = {};
        for (const c of coaches) {
            summaryMap[c.id] = {
                coach_id: c.id,
                coach_name: c.full_name,
                private_total: 0,
                private_sessions: 0,
                group_total: 0,
                group_sessions: 0,
                grand_total: 0,
            };
        }

        // Private lessons
        for (const rec of (ciData || []) as any[]) {
            if (summaryMap[rec.coach_id]) {
                summaryMap[rec.coach_id].private_total += Number(rec.per_session_amount) || 0;
                summaryMap[rec.coach_id].private_sessions += 1;
            }
        }

        // Group lessons
        for (const att of (gData || []) as any[]) {
            if (summaryMap[att.coach_id]) {
                summaryMap[att.coach_id].group_total += Number(att.amount) || 0;
                summaryMap[att.coach_id].group_sessions += 1;
            }
        }

        for (const s of Object.values(summaryMap)) {
            s.grand_total = s.private_total + s.group_total;
        }

        setPayrollSummaries(Object.values(summaryMap).filter(s => s.grand_total > 0 || coaches.find(c => c.id === s.coach_id)?.is_active));
    }

    async function handleAddGroupAttendance(e: React.FormEvent) {
        e.preventDefault();
        if (!groupCoachId || !groupAmount) return;
        setGroupSaving(true);

        const { error } = await supabase.from('coach_attendances').insert({
            coach_id: groupCoachId,
            class_name: groupClassName || 'Lớp nhóm',
            teaching_date: groupDate,
            amount: Number(groupAmount),
            note: groupNote.trim() || null,
            created_by: profile?.id
        });

        if (error) {
            toast.error('Lỗi', error.message);
        } else {
            toast.success('Thành công', 'Đã thêm chấm công lớp nhóm');
            setShowGroupModal(false);
            setGroupCoachId(''); setGroupAmount(''); setGroupNote('');
            fetchPayrollData();
        }
        setGroupSaving(false);
    }

    async function handleDeleteGroupAttendance(attId: string) {
        if (!confirm('Xóa bản ghi chấm công này?')) return;
        const { error } = await supabase.from('coach_attendances').delete().eq('id', attId);
        if (error) toast.error('Lỗi', error.message);
        else fetchPayrollData();
    }

    function formatVND(n: number) {
        return n.toLocaleString('vi-VN') + 'đ';
    }

    if (profile?.role !== 'ADMIN') {
        return <div className="page-container"><div className="alert alert-error">Chỉ ADMIN mới có quyền truy cập.</div></div>;
    }

    const grandTotal = payrollSummaries.reduce((s, p) => s + p.grand_total, 0);

    // Detail records for selected coach
    const detailPrivate = checkinRecords.filter((r: any) => r.coach_id === selectedCoachDetail);
    const detailGroup = groupAttendances.filter((r: any) => r.coach_id === selectedCoachDetail);

    return (
        <div className="page-container">
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1>💰 Bảng Lương HLV</h1>
                    <p>Tổng hợp chấm công & thù lao Huấn Luyện Viên</p>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <input type="month" value={month} onChange={e => setMonth(e.target.value)}
                        style={{ padding: '8px 14px', borderRadius: '8px', border: '1px solid #e2e8f0', fontSize: '14px' }} />
                    <button className="btn btn-primary" onClick={() => { setShowGroupModal(true); setGroupDate(new Date().toISOString().split('T')[0]); }}>
                        ➕ Chấm công Lớp nhóm
                    </button>
                </div>
            </div>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '16px', marginTop: '24px' }}>
                <div style={{ background: 'linear-gradient(135deg, #dbeafe, #eff6ff)', padding: '20px', borderRadius: '16px', border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: '12px', color: '#3b82f6', fontWeight: 600, marginBottom: '4px' }}>Tổng thù lao tháng</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#1e40af' }}>{formatVND(grandTotal)}</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #dcfce7, #f0fdf4)', padding: '20px', borderRadius: '16px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600, marginBottom: '4px' }}>Lớp kèm (từ check-in)</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#15803d' }}>{formatVND(payrollSummaries.reduce((s, p) => s + p.private_total, 0))}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{payrollSummaries.reduce((s, p) => s + p.private_sessions, 0)} buổi</div>
                </div>
                <div style={{ background: 'linear-gradient(135deg, #fef3c7, #fffbeb)', padding: '20px', borderRadius: '16px', border: '1px solid #fcd34d' }}>
                    <div style={{ fontSize: '12px', color: '#d97706', fontWeight: 600, marginBottom: '4px' }}>Lớp nhóm (chấm công)</div>
                    <div style={{ fontSize: '24px', fontWeight: 800, color: '#b45309' }}>{formatVND(payrollSummaries.reduce((s, p) => s + p.group_total, 0))}</div>
                    <div style={{ fontSize: '11px', color: '#64748b' }}>{payrollSummaries.reduce((s, p) => s + p.group_sessions, 0)} buổi</div>
                </div>
            </div>

            {/* Payroll Table */}
            <div className="dashboard-content-card" style={{ marginTop: '24px' }}>
                <h3 style={{ marginBottom: '16px' }}>📊 Chi tiết theo HLV</h3>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Đang tải...</div>
                ) : (
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th>HLV</th>
                                    <th style={{ textAlign: 'right' }}>Kèm riêng</th>
                                    <th style={{ textAlign: 'right' }}>Lớp nhóm</th>
                                    <th style={{ textAlign: 'right' }}>Tổng cộng</th>
                                    <th></th>
                                </tr>
                            </thead>
                            <tbody>
                                {payrollSummaries.map(p => (
                                    <tr key={p.coach_id}
                                        style={{ cursor: 'pointer', background: selectedCoachDetail === p.coach_id ? '#eff6ff' : '' }}
                                        onClick={() => setSelectedCoachDetail(selectedCoachDetail === p.coach_id ? null : p.coach_id)}>
                                        <td>
                                            <strong>{p.coach_name}</strong>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span style={{ color: '#16a34a', fontWeight: 600 }}>{formatVND(p.private_total)}</span>
                                            <br /><span style={{ fontSize: '11px', color: '#94a3b8' }}>{p.private_sessions} buổi</span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <span style={{ color: '#d97706', fontWeight: 600 }}>{formatVND(p.group_total)}</span>
                                            <br /><span style={{ fontSize: '11px', color: '#94a3b8' }}>{p.group_sessions} buổi</span>
                                        </td>
                                        <td style={{ textAlign: 'right' }}>
                                            <strong style={{ fontSize: '16px', color: '#1e40af' }}>{formatVND(p.grand_total)}</strong>
                                        </td>
                                        <td>
                                            <span style={{ fontSize: '14px' }}>{selectedCoachDetail === p.coach_id ? '▲' : '▼'}</span>
                                        </td>
                                    </tr>
                                ))}
                                {payrollSummaries.length === 0 && (
                                    <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: '#94a3b8' }}>Chưa có dữ liệu chấm công trong tháng này</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            {/* Detail Panel */}
            {selectedCoachDetail && (
                <div className="dashboard-content-card" style={{ marginTop: '16px', animation: 'fadeIn 0.3s ease' }}>
                    <h3 style={{ marginBottom: '16px' }}>
                        📋 Chi tiết: {payrollSummaries.find(p => p.coach_id === selectedCoachDetail)?.coach_name}
                    </h3>

                    {/* Private lesson check-ins */}
                    {detailPrivate.length > 0 && (
                        <>
                            <h4 style={{ color: '#16a34a', marginBottom: '8px' }}>🧑‍🏫 Lớp kèm riêng ({detailPrivate.length} buổi)</h4>
                            <div className="table-responsive" style={{ marginBottom: '20px' }}>
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Ngày</th>
                                            <th>Học viên</th>
                                            <th>Loại gói</th>
                                            <th style={{ textAlign: 'right' }}>Thù lao/buổi</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailPrivate.map((r: any, i: number) => (
                                            <tr key={i}>
                                                <td>{new Date(r.checked_in_at).toLocaleDateString('vi-VN')}</td>
                                                <td>{r.customer_name || '—'}</td>
                                                <td>{r.ticket_type_name || '—'}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#16a34a' }}>{formatVND(r.per_session_amount)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* Group lesson attendances */}
                    {detailGroup.length > 0 && (
                        <>
                            <h4 style={{ color: '#d97706', marginBottom: '8px' }}>👥 Lớp nhóm ({detailGroup.length} buổi)</h4>
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Ngày</th>
                                            <th>Tên lớp</th>
                                            <th>Ghi chú</th>
                                            <th>Người chấm</th>
                                            <th style={{ textAlign: 'right' }}>Thù lao</th>
                                            <th></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {detailGroup.map((r: any) => (
                                            <tr key={r.id}>
                                                <td>{new Date(r.teaching_date).toLocaleDateString('vi-VN')}</td>
                                                <td>{r.class_name}</td>
                                                <td style={{ fontSize: '12px', color: '#64748b' }}>{r.note || '—'}</td>
                                                <td style={{ fontSize: '12px' }}>{r.profiles?.full_name || '—'}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 600, color: '#d97706' }}>{formatVND(r.amount)}</td>
                                                <td>
                                                    <button className="btn btn-ghost" style={{ fontSize: '11px', padding: '2px 6px', color: '#ef4444' }}
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteGroupAttendance(r.id); }}>🗑</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {detailPrivate.length === 0 && detailGroup.length === 0 && (
                        <p style={{ color: '#94a3b8', textAlign: 'center', padding: '20px' }}>Không có dữ liệu chi tiết.</p>
                    )}
                </div>
            )}

            {/* Modal chấm công Lớp nhóm */}
            {showGroupModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '450px' }}>
                        <h2>➕ Chấm công Lớp nhóm</h2>
                        <p style={{ color: '#64748b', fontSize: '13px', marginBottom: '16px' }}>
                            Ghi nhận 1 buổi dạy lớp nhóm cho HLV với mức thù lao cố định.
                        </p>
                        <form onSubmit={handleAddGroupAttendance}>
                            <div className="form-group">
                                <label>Chọn HLV <span style={{ color: 'red' }}>*</span></label>
                                <select required value={groupCoachId} onChange={e => setGroupCoachId(e.target.value)}>
                                    <option value="">-- Chọn HLV --</option>
                                    {coaches.filter(c => c.is_active).map(c => (
                                        <option key={c.id} value={c.id}>{c.full_name}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="form-group">
                                <label>Ngày dạy <span style={{ color: 'red' }}>*</span></label>
                                <input type="date" required value={groupDate} onChange={e => setGroupDate(e.target.value)} />
                            </div>
                            <div className="form-group">
                                <label>Tên lớp</label>
                                <input type="text" value={groupClassName} onChange={e => setGroupClassName(e.target.value)} placeholder="Lớp nhóm sáng" />
                            </div>
                            <div className="form-group">
                                <label>Thù lao (VNĐ) <span style={{ color: 'red' }}>*</span></label>
                                <input type="number" required min="0" value={groupAmount} onChange={e => setGroupAmount(e.target.value ? Number(e.target.value) : '')} placeholder="VD: 200000" style={{ fontSize: '16px', fontWeight: 'bold' }} />
                            </div>
                            <div className="form-group">
                                <label>Ghi chú</label>
                                <input type="text" value={groupNote} onChange={e => setGroupNote(e.target.value)} placeholder="Ghi chú (tùy chọn)" />
                            </div>
                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowGroupModal(false)} disabled={groupSaving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={groupSaving}>
                                    {groupSaving ? 'Đang lưu...' : 'Xác nhận'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ToastProvider />
        </div>
    );
}
