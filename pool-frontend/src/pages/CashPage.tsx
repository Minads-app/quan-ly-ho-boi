import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import PnLReportTab from '../components/PnLReportTab';
import { PageHeader, SegmentedTabs, StatCard } from '../components/ui';
import { fetchBusinessSettings, getTodayLocalVN } from '../utils/helpers';

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
    const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
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
        const todayStr = getTodayLocalVN();
        const fromIso = `${todayStr}T00:00:00+07:00`;
        const toIso = `${todayStr}T23:59:59.999+07:00`;

        try {
            // 1. Fetch Expenses (Chi) for today
            const { data: expData } = await supabase
                .from('expenses')
                .select('*, profiles(full_name)')
                .gte('created_at', fromIso)
                .lte('created_at', toIso)
                .order('created_at', { ascending: false });

            if (expData) {
                setExpenses(expData as Expense[]);
                setTotalChi(expData.reduce((sum, e) => sum + e.amount, 0));
            }

            // 2. Fetch Cash Revenue (Thu tiền mặt thực tế trong ngày: Vé CASH không hủy + Bán lẻ CASH)
            const [{ data: ticketsData }, { data: retailOrdersData }] = await Promise.all([
                supabase
                    .from('tickets')
                    .select('price_paid')
                    .eq('payment_method', 'CASH')
                    .neq('status', 'CANCELLED')
                    .gt('price_paid', 0)
                    .gte('sold_at', fromIso)
                    .lte('sold_at', toIso),
                supabase
                    .from('orders')
                    .select('id, order_items!inner(subtotal, product_id)')
                    .eq('payment_method', 'CASH')
                    .not('order_items.product_id', 'is', null)
                    .gte('created_at', fromIso)
                    .lte('created_at', toIso)
            ]);

            const cashTicketSum = (ticketsData || []).reduce((sum, t) => sum + (t.price_paid || 0), 0);
            let cashRetailSum = 0;
            for (const ord of (retailOrdersData || []) as Array<{ order_items?: Array<{ subtotal: number; product_id: string | null }> }>) {
                for (const item of ord.order_items || []) {
                    if (item.product_id) cashRetailSum += item.subtotal || 0;
                }
            }
            setTotalThu(cashTicketSum + cashRetailSum);

            if (isAdmin) {
                const info = await fetchBusinessSettings();
                setBizInfo({
                    name: info.business_name || 'Hệ Thống Vé Bơi',
                    address: info.business_address || '',
                    phone: info.business_phone || '',
                    logo: info.business_logo || '',
                });
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
        setEditingExpense(null);
        setAmount('');
        setReason('');
        setShowModal(true);
    }

    function openEditExpenseModal(exp: Expense) {
        setEditingExpense(exp);
        setAmount(exp.amount);
        setReason(exp.reason);
        setShowModal(true);
    }

    async function handleDeleteExpense(exp: Expense) {
        if (!confirm(`Bạn có chắc muốn xóa phiếu chi "${exp.reason}" (${exp.amount.toLocaleString('vi-VN')}đ)?`)) return;
        const { error } = await supabase.from('expenses').delete().eq('id', exp.id);
        if (error) {
            alert('Lỗi khi xóa phiếu chi: ' + error.message);
        } else {
            fetchCashData();
        }
    }

    async function handleSaveExpense(e: React.FormEvent) {
        e.preventDefault();
        if (!amount || !profile) return;

        const chiAmount = Number(amount);
        if (chiAmount <= 0) {
            alert('Số tiền chi phải lớn hơn 0');
            return;
        }

        const availableCash = editingExpense ? tonTienMat + editingExpense.amount : tonTienMat;
        if (chiAmount > availableCash) {
            alert('Lỗi: Số tiền muốn chi vượt quá số tiền mặt tồn quỹ hiện tại trong ca! Không thể lưu phiếu chi.');
            return;
        }

        setIsSaving(true);
        if (editingExpense) {
            const { error } = await supabase
                .from('expenses')
                .update({ amount: chiAmount, reason: reason.trim() })
                .eq('id', editingExpense.id);

            if (error) {
                alert('Lỗi khi cập nhật phiếu chi: ' + error.message);
            } else {
                alert('Cập nhật phiếu chi thành công!');
                setShowModal(false);
                setEditingExpense(null);
                fetchCashData();
            }
        } else {
            const { error } = await supabase.from('expenses').insert([
                {
                    amount: chiAmount,
                    reason: reason.trim(),
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
            <PageHeader
                title="Quỹ & Thu - Chi"
                subtitle={
                    activeMode === 'SHIFT_CASH'
                        ? 'Theo dõi luồng tiền mặt tại quầy trong ca làm việc hôm nay'
                        : 'Hạch toán Thu khác, Định phí, Biến phí (kể cả quá khứ) & Báo cáo KQKD (Chỉ Admin)'
                }
                actions={
                    <>
                        {isAdmin && (
                            <SegmentedTabs
                                size="sm"
                                tabs={[
                                    { key: 'SHIFT_CASH', label: 'Quỹ Ca Hôm Nay', icon: '💵' },
                                    { key: 'ADMIN_ACCOUNTING', label: 'Hạch Toán KQKD & Định Phí', icon: '📊' },
                                ]}
                                activeKey={activeMode}
                                onChange={(k) => setActiveMode(k as 'SHIFT_CASH' | 'ADMIN_ACCOUNTING')}
                            />
                        )}
                        {activeMode === 'SHIFT_CASH' && (
                            <button type="button" className="btn btn-primary" onClick={openExpenseModal}>
                                ✍️ Lập Phiếu Chi Tại Quầy
                            </button>
                        )}
                    </>
                }
            />

            {isAdmin && activeMode === 'ADMIN_ACCOUNTING' ? (
                <PnLReportTab bizInfo={bizInfo} onPrintReport={handlePrintReport} />
            ) : (
                <>
                    <div className="stats-grid">
                        <StatCard label="Tổng Thu (Hôm nay)" value={`${totalThu.toLocaleString('vi-VN')} ₫`} tone="green" subtext="Tiền bán vé + đồ" icon="💰" />
                        <StatCard label="Tổng Chi Tại Quầy (Hôm nay)" value={`${totalChi.toLocaleString('vi-VN')} ₫`} tone="red" subtext={`${expenses.length} phiếu chi`} icon="🧾" />
                        <StatCard label="Tồn Quỹ Hiện Tại" value={`${tonTienMat.toLocaleString('vi-VN')} ₫`} tone={tonTienMat < 0 ? 'red' : 'blue'} subtext="Thu - Chi" icon="🏦" />
                    </div>

                    <div className="dashboard-content-card">
                        <h2 style={{ fontSize: '16px', fontWeight: 700, marginBottom: '14px' }}>Lịch sử Phiếu Chi Trong Ngày</h2>
                        {loading ? (
                            <div className="page-loading">Đang tải...</div>
                        ) : (
                            <div className="table-responsive">
                                <table className="data-table">
                                    <thead>
                                        <tr>
                                            <th>Thời gian</th>
                                            <th style={{ textAlign: 'right' }}>Số tiền chi</th>
                                            <th>Lý do</th>
                                            <th>Người lập phiếu</th>
                                            <th style={{ textAlign: 'center' }}>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {expenses.map(exp => {
                                            const canModify = isAdmin || exp.created_by === profile?.id;
                                            return (
                                                <tr key={exp.id}>
                                                    <td className="tabular-nums">{new Date(exp.created_at).toLocaleString('vi-VN')}</td>
                                                    <td className="tabular-nums" style={{ fontWeight: 700, color: 'var(--accent-red)', textAlign: 'right' }}>
                                                        -{exp.amount.toLocaleString('vi-VN')}đ
                                                    </td>
                                                    <td style={{ maxWidth: '320px' }}>{exp.reason}</td>
                                                    <td>{exp.profiles?.full_name || 'Không rõ'}</td>
                                                    <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                        {canModify && (
                                                            <div style={{ display: 'inline-flex', gap: '6px' }}>
                                                                <button type="button" className="btn btn-outline btn-sm" onClick={() => openEditExpenseModal(exp)}>Sửa</button>
                                                                {isAdmin && (
                                                                    <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteExpense(exp)}>Xóa</button>
                                                                )}
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {expenses.length === 0 && (
                                            <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Chưa có phiếu chi nào trong hôm nay.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {showModal && (
                <div className="modal-overlay" onClick={() => !isSaving && setShowModal(false)}>
                    <div className="modal-card" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
                        <h2>{editingExpense ? 'Sửa Phiếu Chi Tiền Mặt' : 'Lập Phiếu Chi Tiền Mặt (Tại Quầy)'}</h2>
                        <div className="ui-callout" style={{ marginBottom: '16px' }}>
                            Số tiền mặt khả dụng tại quầy: <strong className="tabular-nums">{(editingExpense ? tonTienMat + editingExpense.amount : tonTienMat).toLocaleString('vi-VN')}đ</strong>
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
                                    style={{ minHeight: '80px' }}
                                />
                            </div>

                            <div className="modal-actions" style={{ marginTop: '20px' }}>
                                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowModal(false)} disabled={isSaving}>Hủy</button>
                                <button type="submit" className="btn btn-danger" style={{ flex: 1 }} disabled={isSaving}>{isSaving ? 'Đang lưu...' : 'Lưu Phiếu Chi'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
