/* eslint-disable react-hooks/set-state-in-effect */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PnLReportTab from '../components/PnLReportTab';

interface Expense {
    id: string;
    amount: number;
    reason: string;
    created_by: string;
    created_at: string;
    profiles?: { full_name: string };
}

export default function CashPage() {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'ADMIN';

    const [activeMode, setActiveMode] = useState<'SHIFT_CASH' | 'ADMIN_ACCOUNTING'>('SHIFT_CASH');
    const [expenses, setExpenses] = useState<Expense[]>([]);
    const [loading, setLoading] = useState(true);

    // Stats
    const [totalThu, setTotalThu] = useState(0);
    const [totalChi, setTotalChi] = useState(0);
    const tonTienMat = totalThu - totalChi;

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [amount, setAmount] = useState<number | ''>('');
    const [reason, setReason] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const [bizInfo, setBizInfo] = useState<{ name: string; address: string; phone: string; logo: string }>({
        name: 'Hệ Thống Vé Bơi',
        address: '',
        phone: '',
        logo: '',
    });

    async function fetchCashData() {
        setLoading(true);
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);

        try {
            // 1. Fetch Expenses (Chi) for today
            const { data: expData } = await supabase
                .from('expenses')
                .select('*, profiles(full_name)')
                .gte('created_at', startOfDay.toISOString())
                .order('created_at', { ascending: false });

            if (expData) {
                setExpenses(expData as Expense[]);
                setTotalChi(expData.reduce((sum, e) => sum + e.amount, 0));
            }

            // 2. Fetch Tickets Revenue (Thu) for today (Cash only)
            const { data: ticketsData } = await supabase
                .from('tickets')
                .select('price_paid')
                .gte('created_at', startOfDay.toISOString());

            if (ticketsData) {
                setTotalThu(ticketsData.reduce((sum, t) => sum + (t.price_paid || 0), 0));
            }

            if (isAdmin) {
                const { data: sData } = await supabase.from('system_settings').select('key, value');
                if (sData) {
                    const info: Record<string, string> = {};
                    sData.forEach(r => {
                        let val = r.value;
                        try {
                            val = typeof val === 'string' ? val.replace(/^"|"$/g, '') : JSON.parse(JSON.stringify(val)).replace(/^"|"$/g, '');
                        } catch {
                            val = typeof val === 'string' ? val : String(val);
                        }
                        info[r.key] = val;
                    });
                    setBizInfo({
                        name: info.business_name || 'Hệ Thống Vé Bơi',
                        address: info.business_address || '',
                        phone: info.business_phone || '',
                        logo: info.business_logo || '',
                    });
                }
            }
        } catch (e) {
            console.error(e);
        }
        setLoading(false);
    }

    useEffect(() => {
        fetchCashData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    function openExpenseModal() {
        setAmount('');
        setReason('');
        setShowModal(true);
    }

    async function handleSaveExpense(e: React.FormEvent) {
        e.preventDefault();
        if (!amount || !profile) return;

        const chiAmount = Number(amount);
        if (chiAmount <= 0) {
            alert('Số tiền chi phải lớn hơn 0');
            return;
        }

        if (chiAmount > tonTienMat) {
            alert('Lỗi: Số tiền muốn chi vượt quá số tiền mặt tồn quỹ hiện tại trong ca! Không thể lập phiếu chi.');
            return;
        }

        setIsSaving(true);
        const { error } = await supabase.from('expenses').insert([
            {
                amount: chiAmount,
                reason: reason,
                created_by: profile.id,
            },
        ]);

        if (error) {
            alert('Lỗi khi lập phiếu chi: ' + error.message);
        } else {
            alert('Lập phiếu chi thành công!');
            setShowModal(false);
            fetchCashData();
        }
        setIsSaving(false);
    }

    function handlePrintReport(title: string, tableHtml: string) {
        const now = new Date();
        const printDate = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';
        document.body.appendChild(iframe);
        const win = iframe.contentWindow;
        if (!win) {
            document.body.removeChild(iframe);
            return;
        }
        win.document.open();
        win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
        <style>
            @page { size: A4 landscape; margin: 10mm; }
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Times New Roman', Times, serif; font-size: 13px; color: #000; padding: 20px; }
            .header { display: flex; align-items: center; margin-bottom: 24px; border-bottom: 2px solid #333; padding-bottom: 12px; }
            .header img { max-height: 60px; margin-right: 16px; object-fit: contain; }
            .header-info h1 { font-size: 18px; text-transform: uppercase; margin-bottom: 4px; }
            .header-info p { margin: 2px 0; font-size: 12px; }
            .report-title { text-align: center; margin-bottom: 20px; }
            .report-title h2 { font-size: 20px; margin-bottom: 4px; text-transform: uppercase; }
            .subtitle { font-size: 12px; color: #666; margin-bottom: 16px; text-align: center; font-style: italic; }
            table { width: 100%; border-collapse: collapse; margin-top: 12px; }
            th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; font-size: 12px; }
            th { background: #f0f0f0; font-weight: 700; }
            .total-row { font-weight: 900; background: #e8f5e9; }
        </style></head><body>
            <div class="header">
                ${bizInfo.logo ? `<img src="${bizInfo.logo}" alt="Logo" />` : ''}
                <div class="header-info">
                    <h1>${bizInfo.name}</h1>
                    ${bizInfo.address ? `<p>Địa chỉ: ${bizInfo.address}</p>` : ''}
                    ${bizInfo.phone ? `<p>Hotline: ${bizInfo.phone}</p>` : ''}
                </div>
            </div>
            <div class="report-title">
                <h2>${title}</h2>
                <p class="subtitle">Ngày in: ${printDate}</p>
            </div>
            ${tableHtml}
        </body></html>`);
        win.document.close();
        setTimeout(() => {
            win.focus();
            win.print();
            setTimeout(() => document.body.removeChild(iframe), 500);
        }, 300);
    }

    if (!profile?.can_create_expense && profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">Bạn không có quyền lập Phiếu chi.</div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1>💵 Quản lý Quỹ & Thu - Chi</h1>
                    <p>
                        {activeMode === 'SHIFT_CASH'
                            ? 'Theo dõi luồng tiền mặt tại quầy trong ca làm việc hôm nay'
                            : 'Hạch toán Thu khác, Định phí, Biến phí (kể cả quá khứ) & Báo cáo KQKD (Chỉ Admin)'}
                    </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                    {isAdmin && (
                        <div style={{ display: 'flex', background: 'var(--bg-hover)', padding: '4px', borderRadius: '10px', gap: '4px' }}>
                            <button
                                className={`btn ${activeMode === 'SHIFT_CASH' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                                onClick={() => setActiveMode('SHIFT_CASH')}
                            >
                                💵 Quỹ Ca Hôm Nay
                            </button>
                            <button
                                className={`btn ${activeMode === 'ADMIN_ACCOUNTING' ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                                onClick={() => setActiveMode('ADMIN_ACCOUNTING')}
                            >
                                📊 Hạch Toán KQKD & Định Phí (Admin)
                            </button>
                        </div>
                    )}

                    {activeMode === 'SHIFT_CASH' && (
                        <button className="btn btn-primary" onClick={openExpenseModal}>
                            ✍️ Lập Phiếu Chi Tại Quầy
                        </button>
                    )}
                </div>
            </div>

            {isAdmin && activeMode === 'ADMIN_ACCOUNTING' ? (
                <div style={{ marginTop: '16px' }}>
                    <PnLReportTab bizInfo={bizInfo} onPrintReport={handlePrintReport} />
                </div>
            ) : (
                <>
                    <div className="dashboard-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginTop: '24px' }}>
                        <div className="stat-card" style={{ borderLeft: '4px solid #10b981', padding: '16px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tổng Thu (Hôm nay)</h3>
                            <div className="value" style={{ fontSize: '20px', fontWeight: 'bold', color: '#10b981', margin: '4px 0' }}>{totalThu.toLocaleString('vi-VN')} ₫</div>
                            <p className="trend" style={{ opacity: 0.8, fontSize: '12px' }}>Tiền bán vé + đồ</p>
                        </div>
                        <div className="stat-card" style={{ borderLeft: '4px solid #ef4444', padding: '16px', background: 'var(--bg-card)', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Tổng Chi Tại Quầy (Hôm nay)</h3>
                            <div className="value" style={{ fontSize: '20px', fontWeight: 'bold', color: '#ef4444', margin: '4px 0' }}>{totalChi.toLocaleString('vi-VN')} ₫</div>
                            <p className="trend" style={{ opacity: 0.8, fontSize: '12px' }}>{expenses.length} phiếu chi</p>
                        </div>
                        <div className="stat-card" style={{ borderLeft: '4px solid #3b82f6', background: tonTienMat < 0 ? '#fee2e2' : 'var(--bg-card)', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                            <h3 style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>TỒN QUỸ HIỆN TẠI</h3>
                            <div className="value" style={{ fontSize: '20px', fontWeight: 'bold', color: tonTienMat < 0 ? '#ef4444' : '#3b82f6', margin: '4px 0' }}>{tonTienMat.toLocaleString('vi-VN')} ₫</div>
                            <p className="trend" style={{ opacity: 0.8, fontSize: '12px' }}>Thu - Chi</p>
                        </div>
                    </div>

                    <div className="dashboard-content-card" style={{ marginTop: '24px' }}>
                        <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>Lịch sử Phiếu Chi Trong Ngày</h2>
                        {loading ? (
                            <div className="page-loading">Đang tải...</div>
                        ) : (
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Thời gian</th>
                                            <th>Số tiền chi</th>
                                            <th>Lý do</th>
                                            <th>Người lập phiếu</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {expenses.map(exp => (
                                            <tr key={exp.id}>
                                                <td>{new Date(exp.created_at).toLocaleString('vi-VN')}</td>
                                                <td style={{ fontWeight: 600, color: 'var(--alert-red)' }}>
                                                    -{exp.amount.toLocaleString('vi-VN')}đ
                                                </td>
                                                <td style={{ maxWidth: '300px' }}>{exp.reason}</td>
                                                <td>{exp.profiles?.full_name || 'Không rõ'}</td>
                                            </tr>
                                        ))}
                                        {expenses.length === 0 && (
                                            <tr><td colSpan={4} style={{ textAlign: 'center' }}>Chưa có phiếu chi nào trong hôm nay.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {showModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '400px' }}>
                        <h2>Lập Phiếu Chi Tiền Mặt (Tại Quầy)</h2>
                        <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '13px' }}>
                            Số tiền mặt tồn tại quầy hiện tại: <strong>{tonTienMat.toLocaleString('vi-VN')}đ</strong>
                        </div>
                        <form onSubmit={handleSaveExpense}>
                            <div className="form-group">
                                <label>Số tiền chi (VND)</label>
                                <input type="number" min="1" required value={amount} onChange={e => setAmount(Number(e.target.value))} placeholder="Ví dụ: 50000" />
                            </div>
                            <div className="form-group">
                                <label>Lý do chi (Ghi rõ mục đích sử dụng)</label>
                                <textarea
                                    required
                                    value={reason}
                                    onChange={e => setReason(e.target.value)}
                                    placeholder="Mua nước tẩy bồn cầu, ứng lương nhân viên..."
                                    style={{ width: '100%', padding: '10px', borderRadius: '8px', border: '1px solid var(--border-color)', minHeight: '80px', fontFamily: 'inherit' }}
                                />
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowModal(false)} disabled={isSaving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1, background: '#ef4444', borderColor: '#ef4444', color: '#fff' }} disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu Phiếu Chi'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
