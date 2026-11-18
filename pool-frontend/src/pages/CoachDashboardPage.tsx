/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { Badge, EmptyState, PageHeader } from '../components/ui';

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
            <PageHeader
                title="Danh sách Học viên của tôi"
                subtitle="Các gói học kèm riêng (1 kèm 1, 1 kèm 2, ...) được gán cho bạn"
            />

            {loading ? (
                <div className="page-loading">⏳ Đang tải dữ liệu...</div>
            ) : !coachId ? (
                <div className="ui-card">
                    <EmptyState icon="❌" title="Chưa liên kết hồ sơ HLV" description="Tài khoản của bạn chưa được liên kết với hồ sơ HLV. Vui lòng liên hệ Admin." />
                </div>
            ) : students.length === 0 ? (
                <div className="ui-card">
                    <EmptyState icon="📭" title="Chưa có học viên" description="Chưa có học viên nào được gán cho bạn." />
                </div>
            ) : (
                <div className="coach-student-grid">
                    {students.map(s => {
                        const isExpired = s.status === 'EXPIRED';
                        const sessionsLeft = s.remaining_sessions;
                        const isLow = sessionsLeft !== null && sessionsLeft <= 2;
                        const typeName = (s.ticket_types as any)?.name || 'N/A';
                        const classType = (s.ticket_types as any)?.lesson_class_type;
                        const studentCount = (s.ticket_types as any)?.student_count || 1;

                        return (
                            <div key={s.id} className="coach-student-card" style={{
                                opacity: isExpired ? 0.55 : 1,
                                borderLeft: `4px solid ${isExpired ? 'var(--accent-red)' : isLow ? 'var(--accent-orange)' : 'var(--accent-green)'}`
                            }}>
                                {isExpired && (
                                    <div style={{ position: 'absolute', top: '12px', right: '12px' }}>
                                        <Badge variant="red">HẾT HẠN</Badge>
                                    </div>
                                )}
                                <div style={{ fontSize: '15.5px', fontWeight: 700, marginBottom: '6px', color: 'var(--text-primary)' }}>
                                    👤 {s.customer_name || 'Chưa có tên'}
                                </div>
                                {s.customer_phone && (
                                    <div className="tabular-nums" style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                        📞 {s.customer_phone}
                                    </div>
                                )}
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                    <span>📦 {typeName}</span>
                                    <Badge variant="blue">
                                        {classType === 'ONE_ON_ONE' ? '1:1' : classType === 'ONE_ON_TWO' ? '1:2' : `1:${studentCount}`}
                                    </Badge>
                                </div>

                                <div className="ui-callout" style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '2px' }}>Buổi còn lại</div>
                                        <div className="tabular-nums" style={{ fontWeight: 800, fontSize: '18px', color: isLow ? 'var(--accent-orange)' : 'var(--accent-green)' }}>
                                            {sessionsLeft !== null ? sessionsLeft : '∞'}
                                            <span style={{ fontSize: '12px', color: 'var(--text-muted)', fontWeight: 400 }}> / {s.total_sessions || '∞'}</span>
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '11px', marginBottom: '2px' }}>Giá gói</div>
                                        <div className="tabular-nums" style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{s.price_paid.toLocaleString('vi-VN')}đ</div>
                                    </div>
                                </div>

                                {(s.valid_from || s.valid_until) && (
                                    <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '10px' }}>
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
