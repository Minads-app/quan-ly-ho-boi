/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

interface StudentTicket {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    price_paid: number;
    remaining_sessions: number | null;
    total_sessions: number | null;
    valid_from: string | null;
    valid_until: string | null;
    status: string;
    ticket_types: { name: string; lesson_class_type: string | null; student_count: number | null } | null;
}

export default function CoachDashboardPage() {
    const { profile } = useAuth();
    const [students, setStudents] = useState<StudentTicket[]>([]);
    const [loading, setLoading] = useState(true);
    const [coachId, setCoachId] = useState<string | null>(null);

    useEffect(() => {
        if (profile?.id) loadCoachData();
    }, [profile]);

    async function loadCoachData() {
        setLoading(true);

        // 1. Find coach record linked to this profile
        const { data: coachData } = await supabase
            .from('coaches')
            .select('id')
            .eq('profile_id', profile!.id)
            .single();

        if (!coachData) {
            setLoading(false);
            return;
        }

        setCoachId(coachData.id);

        // 2. Get all LESSON tickets assigned to this coach (private only - not GROUP)
        const { data: tickets, error } = await supabase
            .from('tickets')
            .select(`
                id, customer_name, customer_phone, price_paid,
                remaining_sessions, total_sessions, valid_from, valid_until, status,
                ticket_types!inner (name, lesson_class_type, student_count)
            `)
            .eq('coach_id', coachData.id)
            .neq('status', 'CANCELLED')
            .neq('ticket_types.lesson_class_type', 'GROUP')
            .order('sold_at', { ascending: false });

        if (error) console.error('Error loading students:', error);
        setStudents((tickets || []) as any);
        setLoading(false);
    }

    if (profile?.role !== 'COACH' && profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">Bạn không có quyền truy cập trang này.</div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <h1>🧑‍🏫 Danh sách Học viên của tôi</h1>
                <p>Các gói học kèm riêng (1 kèm 1, 1 kèm 2, ...) được gán cho bạn</p>
            </div>

            {loading ? (
                <div style={{ textAlign: 'center', padding: '60px', color: '#94a3b8' }}>
                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>⏳</div>
                    <p>Đang tải dữ liệu...</p>
                </div>
            ) : !coachId ? (
                <div className="dashboard-content-card" style={{ textAlign: 'center', padding: '60px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>❌</div>
                    <p style={{ color: '#94a3b8' }}>Tài khoản của bạn chưa được liên kết với hồ sơ HLV.<br/>Vui lòng liên hệ Admin.</p>
                </div>
            ) : students.length === 0 ? (
                <div className="dashboard-content-card" style={{ textAlign: 'center', padding: '60px' }}>
                    <div style={{ fontSize: '48px', marginBottom: '12px' }}>📭</div>
                    <p style={{ color: '#94a3b8' }}>Chưa có học viên nào được gán cho bạn.</p>
                </div>
            ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px', marginTop: '24px' }}>
                    {students.map(s => {
                        const isExpired = s.status === 'EXPIRED';
                        const sessionsLeft = s.remaining_sessions;
                        const isLow = sessionsLeft !== null && sessionsLeft <= 2;
                        const typeName = (s.ticket_types as any)?.name || 'N/A';
                        const classType = (s.ticket_types as any)?.lesson_class_type;
                        const studentCount = (s.ticket_types as any)?.student_count || 1;

                        return (
                            <div key={s.id} style={{
                                background: '#fff', borderRadius: '16px', padding: '20px',
                                boxShadow: '0 2px 12px rgba(0,0,0,0.06)', border: '1px solid #f1f5f9',
                                opacity: isExpired ? 0.5 : 1, position: 'relative',
                                borderLeft: `4px solid ${isExpired ? '#ef4444' : isLow ? '#f59e0b' : '#10b981'}`
                            }}>
                                {isExpired && (
                                    <span style={{ position: 'absolute', top: '12px', right: '12px', background: '#fee2e2', color: '#dc2626', fontSize: '10px', fontWeight: 700, padding: '3px 8px', borderRadius: '10px' }}>
                                        HẾT HẠN
                                    </span>
                                )}
                                <div style={{ fontSize: '16px', fontWeight: 700, marginBottom: '8px', color: '#1e293b' }}>
                                    👤 {s.customer_name || 'Chưa có tên'}
                                </div>
                                {s.customer_phone && (
                                    <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>
                                        📞 {s.customer_phone}
                                    </div>
                                )}
                                <div style={{ fontSize: '13px', color: '#475569', marginBottom: '12px' }}>
                                    📦 {typeName}
                                    <span style={{ marginLeft: '8px', background: '#dbeafe', color: '#1d4ed8', padding: '2px 8px', borderRadius: '8px', fontSize: '11px', fontWeight: 600 }}>
                                        {classType === 'ONE_ON_ONE' ? '1:1' : classType === 'ONE_ON_TWO' ? '1:2' : `1:${studentCount}`}
                                    </span>
                                </div>

                                <div style={{ display: 'flex', justifyContent: 'space-between', background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', fontSize: '13px' }}>
                                    <div>
                                        <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '2px' }}>Buổi còn lại</div>
                                        <div style={{ fontWeight: 700, fontSize: '18px', color: isLow ? '#f59e0b' : '#10b981' }}>
                                            {sessionsLeft !== null ? sessionsLeft : '∞'}
                                            <span style={{ fontSize: '12px', color: '#94a3b8', fontWeight: 400 }}> / {s.total_sessions || '∞'}</span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: '#94a3b8', fontSize: '11px', marginBottom: '2px' }}>Giá gói</div>
                                        <div style={{ fontWeight: 600, color: '#1e293b' }}>{s.price_paid.toLocaleString('vi-VN')}đ</div>
                                    </div>
                                </div>

                                {(s.valid_from || s.valid_until) && (
                                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                                        📅 {s.valid_from ? new Date(s.valid_from).toLocaleDateString('vi-VN') : '---'} → {s.valid_until ? new Date(s.valid_until).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
