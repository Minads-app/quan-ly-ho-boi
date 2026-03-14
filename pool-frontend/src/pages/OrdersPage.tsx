/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, react-hooks/rules-of-hooks */
import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeScannerInput } from '../utils/scannerUtils';

type DateRange = 'TODAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';

interface OrderRow {
    id: string;
    total_amount: number;
    payment_method: string;
    customer_name: string | null;
    customer_phone: string | null;
    note: string | null;
    created_at: string;
    created_by_name: string | null;
    // Expanded data
    tickets: TicketRow[];
    products: ProductRow[];
}

interface TicketRow {
    id: string;
    ticket_type_id: string;
    type_name: string;
    category: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_name_2: string | null;
    customer_birth_year_2: number | null;
    guardian_name: string | null;
    guardian_phone: string | null;
    card_code: string | null;
    remaining_sessions: number | null;
    total_sessions: number | null;
    valid_from: string | null;
    valid_until: string | null;
    price_paid: number;
    status: string;
    sold_at: string;
}

interface ProductRow {
    id: string;
    product_name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
}

export default function OrdersPage() {
    const { profile } = useAuth();
    if (profile?.role !== 'ADMIN') {
        return <div className="p-8 text-center">Bạn không có quyền truy cập trang này.</div>;
    }

    const [orders, setOrders] = useState<OrderRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRange, setDateRange] = useState<DateRange>('THIS_MONTH');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    const [selectedOrder, setSelectedOrder] = useState<OrderRow | null>(null);

    // Helper: Mask card code for non-admins
    function maskCardCode(code: string | null): string | null {
        if (!code) return null;
        if (profile?.role === 'ADMIN') return code;
        if (code.length <= 6) return '***';
        // Show first 5 and last 4, middle masked
        return `${code.substring(0, 5)}***${code.substring(code.length - 4)}`;
    }

    // Edit Customer Info Modal
    const [isEditingCustomer, setIsEditingCustomer] = useState(false);
    const [editCustName, setEditCustName] = useState('');
    const [editCustPhone, setEditCustPhone] = useState('');

    // Edit Package Modal
    const [selectedPkg, setSelectedPkg] = useState<TicketRow | null>(null);
    const [isEditingPkg, setIsEditingPkg] = useState(false);
    const [editSessions, setEditSessions] = useState<number | ''>('');
    const [editTotalSessions, setEditTotalSessions] = useState<number | ''>('');
    const [editValidFrom, setEditValidFrom] = useState('');
    const [editValidUntil, setEditValidUntil] = useState('');
    const [editCardCode, setEditCardCode] = useState('');

    useEffect(() => {
        fetchOrders();
    }, [dateRange, customFrom, customTo]);

    function getDateBounds(): { from: string; to: string } {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        if (dateRange === 'TODAY') return { from: todayStr, to: todayStr };
        if (dateRange === 'THIS_MONTH') return { from: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`, to: todayStr };
        if (dateRange === 'LAST_MONTH') {
            const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const ld = new Date(now.getFullYear(), now.getMonth(), 0);
            return { from: `${lm.getFullYear()}-${pad(lm.getMonth() + 1)}-01`, to: `${ld.getFullYear()}-${pad(ld.getMonth() + 1)}-${pad(ld.getDate())}` };
        }
        return { from: customFrom || todayStr, to: customTo || todayStr };
    }

    async function fetchOrders() {
        setLoading(true);
        const { from, to } = getDateBounds();

        // Fetch Orders
        const { data: oData, error: oErr } = await supabase
            .from('orders')
            .select(`
                id, total_amount, payment_method, customer_name, customer_phone, note, created_at,
                profiles:created_by (full_name)
            `)
            .gte('created_at', `${from}T00:00:00`)
            .lte('created_at', `${to}T23:59:59`)
            .order('created_at', { ascending: false });

        if (oErr) { console.error('Error fetching orders:', oErr); setLoading(false); return; }

        const ordersList: OrderRow[] = (oData || []).map(o => ({
            id: o.id,
            total_amount: o.total_amount,
            payment_method: o.payment_method,
            customer_name: o.customer_name,
            customer_phone: o.customer_phone,
            note: o.note,
            created_at: o.created_at,
            created_by_name: (o as any).profiles?.full_name || '—',
            tickets: [],
            products: []
        }));

        if (ordersList.length > 0) {
            const orderIds = ordersList.map(o => o.id);

            // Fetch Products (order_items)
            const { data: itemsData } = await supabase
                .from('order_items')
                .select(`
                    id, order_id, product_id, quantity, unit_price, subtotal,
                    products(name)
                `)
                .in('order_id', orderIds)
                .not('product_id', 'is', null);

            // Fetch Tickets
            const { data: ticketsData } = await supabase
                .from('tickets')
                .select(`
                    id, order_id, ticket_type_id, customer_name, customer_phone, card_code,
                    customer_name_2, customer_birth_year_2, guardian_name, guardian_phone,
                    remaining_sessions, total_sessions, valid_from, valid_until, price_paid, status, sold_at,
                    ticket_types(name, category),
                    customers:customer_id(full_name)
                `)
                .in('order_id', orderIds);

            // Populate
            for (const order of ordersList) {
                if (itemsData) {
                    order.products = itemsData
                        .filter(i => i.order_id === order.id)
                        .map(i => ({
                            id: i.id,
                            product_name: (i as any).products?.name || 'Sản phẩm',
                            quantity: i.quantity,
                            unit_price: i.unit_price,
                            subtotal: i.subtotal
                        }));
                }
                if (ticketsData) {
                    order.tickets = ticketsData
                        .filter(t => t.order_id === order.id)
                        .map(t => ({
                            id: t.id,
                            ticket_type_id: t.ticket_type_id,
                            type_name: (t as any).ticket_types?.name || 'Vé',
                            category: (t as any).ticket_types?.category || 'DAILY',
                            customer_name: (t as any).customers?.full_name || t.customer_name,
                            customer_phone: t.customer_phone,
                            customer_name_2: t.customer_name_2,
                            customer_birth_year_2: t.customer_birth_year_2,
                            guardian_name: t.guardian_name,
                            guardian_phone: t.guardian_phone,
                            card_code: t.card_code,
                            remaining_sessions: t.remaining_sessions,
                            total_sessions: t.total_sessions,
                            valid_from: t.valid_from,
                            valid_until: t.valid_until,
                            price_paid: t.price_paid,
                            status: t.status,
                            sold_at: t.sold_at
                        }));
                }
            }
        }

        setOrders(ordersList);
        setLoading(false);
    }

    // --- Detail & Edit Logic ---

    function openOrderModal(o: OrderRow) {
        setSelectedOrder(o);
        setIsEditingCustomer(false);
        setIsEditingPkg(false);
        setSelectedPkg(null);
    }

    async function handleSaveCustomerInfo() {
        if (!selectedOrder) return;
        if (!confirm('Bạn có chắc chắn muốn thay đổi thông tin khách hàng cho đơn hàng và các vé đi kèm?')) return;

        // Update orders table
        const { error: err1 } = await supabase
            .from('orders')
            .update({ customer_name: editCustName, customer_phone: editCustPhone })
            .eq('id', selectedOrder.id);

        if (err1) { alert('Lỗi: ' + err1.message); return; }

        // Update tickets table for tickets in this order
        const ticketIds = selectedOrder.tickets.map(t => t.id);
        if (ticketIds.length > 0) {
            await supabase
                .from('tickets')
                .update({ customer_name: editCustName, customer_phone: editCustPhone })
                .in('id', ticketIds);
        }

        // Also optionally update customers table if phone exists, but skip for safety/simplicity unless there's an exact match

        alert('✅ Cập nhật thông tin khách hàng thành công!');
        setIsEditingCustomer(false);
        // Refresh detail view
        const updatedOrder = { ...selectedOrder, customer_name: editCustName, customer_phone: editCustPhone };
        updatedOrder.tickets = updatedOrder.tickets.map(t => ({ ...t, customer_name: editCustName, customer_phone: editCustPhone }));
        setSelectedOrder(updatedOrder);

        // Refresh list
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? updatedOrder : o));
    }

    async function handleUpdatePackage() {
        if (!selectedPkg) return;
        if (!confirm('Bạn có chắc chắn muốn lưu các thay đổi này?')) return;

        const updateData: any = {
            remaining_sessions: editSessions === '' ? null : Number(editSessions),
            total_sessions: editTotalSessions === '' ? null : Number(editTotalSessions),
            valid_from: editValidFrom || null,
            valid_until: editValidUntil || null,
        };

        // If card_code changes, validate via manual code flow in DB or just update tickets
        // For simplicity in this edit form, we just update tickets.
        // Full card mapping is available in CustomerPage
        if (editCardCode !== (selectedPkg.card_code || '')) {
            updateData.card_code = editCardCode || null;
            // Best effort to insert into card_bank
            if (editCardCode) {
                await supabase.from('card_bank').insert({ card_code: editCardCode, prefix: 'M', status: 'USED', source: 'MANUAL', created_by: profile?.id }).select().single();
            }
        }

        const { error } = await supabase.from('tickets').update(updateData).eq('id', selectedPkg.id);

        if (error) {
            alert('Lỗi cập nhật gói: ' + error.message);
        } else {
            alert('✅ Cập nhật thành công!');

            // refresh
            const updatedPkg = {
                ...selectedPkg,
                ...updateData,
                card_code: editCardCode || null
            };

            if (selectedOrder) {
                const updatedOrder = {
                    ...selectedOrder,
                    tickets: selectedOrder.tickets.map(t => t.id === selectedPkg.id ? updatedPkg : t)
                };
                setSelectedOrder(updatedOrder);
                setOrders(prev => prev.map(o => o.id === selectedOrder.id ? updatedOrder : o));
            }

            setIsEditingPkg(false);
            setSelectedPkg(null);
        }
    }


    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
    const fmtDT = (d: string) => new Date(d).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

    function getStatusBadge(status: string) {
        switch (status) {
            case 'IN_USE': return { text: 'Đang dùng', bg: '#dcfce7', color: '#166534' };
            case 'EXPIRED': return { text: 'Hết hạn', bg: '#fee2e2', color: '#991b1b' };
            default: return { text: 'Chưa dùng', bg: '#dbeafe', color: '#1d4ed8' };
        }
    }

    const filteredOrders = orders.filter(o =>
        !searchTerm ||
        (o.id.includes(searchTerm)) ||
        (o.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (o.customer_phone || '').includes(searchTerm)
    );

    if (loading) return <div className="page-loading">Đang tải...</div>;

    const thS: React.CSSProperties = { textAlign: 'left', padding: '12px 16px', fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border-color)', whiteSpace: 'nowrap' };
    const tdS: React.CSSProperties = { padding: '12px 16px', fontSize: '14px', whiteSpace: 'nowrap' };

    return (
        <div className="page-container" style={{ maxWidth: '1100px' }}>
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ fontSize: '24px', fontWeight: 700 }}>🧾 Danh sách Hóa Đơn</h1>
                <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Quản lý hóa đơn mua hàng và tùy chỉnh gói dịch vụ (Admin)</p>
            </div>

            {/* Controls */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="text" placeholder="🔍 Tên KH, SĐT, Mã HĐ..."
                    value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                    style={{ flex: 1, minWidth: '200px', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
                />

                <div style={{ display: 'flex', gap: '4px' }}>
                    {(['THIS_MONTH', 'LAST_MONTH', 'TODAY', 'CUSTOM'] as DateRange[]).map(r => (
                        <button key={r} className={`btn ${dateRange === r ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '6px 12px', fontSize: '13px' }}
                            onClick={() => setDateRange(r)}>
                            {r === 'TODAY' ? 'Hôm nay' : r === 'THIS_MONTH' ? 'Tháng này' : r === 'LAST_MONTH' ? 'Tháng trước' : 'Tùy chọn'}
                        </button>
                    ))}
                    {dateRange === 'CUSTOM' && (
                        <>
                            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: '13px' }} />
                            <span style={{ color: 'var(--text-secondary)' }}>→</span>
                            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: '13px' }} />
                        </>
                    )}
                </div>
            </div>

            <div style={{ overflowX: 'auto', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={thS}>Mã ĐH</th>
                            <th style={thS}>Ngày giờ</th>
                            <th style={thS}>Khách hàng</th>
                            <th style={thS}>SĐT</th>
                            <th style={thS}>Nội dung</th>
                            <th style={thS}>Tổng tiền</th>
                            <th style={thS}>Thanh toán</th>
                            <th style={thS}>Người tạo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có hóa đơn trong khoảng thời gian này.</td></tr>
                        ) : filteredOrders.map(o => (
                            <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.15s' }}
                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                onMouseLeave={e => (e.currentTarget.style.background = '')}
                                onClick={() => openOrderModal(o)}>
                                <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{o.id.substring(0, 8).toUpperCase()}</td>
                                <td style={tdS}>{fmtDT(o.created_at)}</td>
                                <td style={{ ...tdS, fontWeight: 600 }}>{o.customer_name || '—'}</td>
                                <td style={tdS}>{o.customer_phone || '—'}</td>
                                <td style={tdS}>
                                    <div style={{ fontSize: '13px' }}>
                                        {o.tickets.length > 0 && <span style={{ color: '#0369a1', marginRight: '8px' }}>🎫 {o.tickets.length} vé</span>}
                                        {o.products.length > 0 && <span style={{ color: '#9d174d' }}>🛍️ {o.products.reduce((acc, p) => acc + p.quantity, 0)} sp</span>}
                                    </div>
                                </td>
                                <td style={{ ...tdS, fontWeight: 700 }}>{fmt(o.total_amount)}</td>
                                <td style={tdS}>
                                    <span style={{ fontSize: '12px', padding: '4px 8px', borderRadius: '4px', background: o.payment_method === 'CASH' ? '#dcfce7' : o.payment_method === 'TRANSFER' ? '#dbeafe' : '#f3e8ff' }}>
                                        {o.payment_method === 'CASH' ? '💵 Tiền mặt' : o.payment_method === 'TRANSFER' ? '🏦 Chuyển khoản' : '💳 Quẹt thẻ'}
                                    </span>
                                </td>
                                <td style={{ ...tdS, color: 'var(--text-secondary)' }}>{o.created_by_name}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ORDER DETAIL MODAL */}
            {selectedOrder && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => { setSelectedOrder(null); setIsEditingPkg(false); setSelectedPkg(null); }}>

                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '800px', maxHeight: '85vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '20px' }}
                        onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h2 style={{ fontSize: '20px', fontWeight: 700 }}>Chi tiết Hóa đơn #{selectedOrder.id.substring(0, 8).toUpperCase()}</h2>
                            <button onClick={() => { setSelectedOrder(null); setIsEditingPkg(false); setSelectedPkg(null); }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
                        </div>

                        {/* Customer Info Section */}
                        <div style={{ background: 'var(--bg-hover)', borderRadius: '12px', padding: '16px', border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <div style={{ fontWeight: 600, fontSize: '15px' }}>👤 Thông tin khách hàng</div>
                                {!isEditingCustomer && (
                                    <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 12px' }}
                                        onClick={() => {
                                            setEditCustName(selectedOrder.customer_name || '');
                                            setEditCustPhone(selectedOrder.customer_phone || '');
                                            setIsEditingCustomer(true);
                                        }}>
                                        ✏️ Sửa thông tin
                                    </button>
                                )}
                            </div>

                            {isEditingCustomer ? (
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>Họ tên</label>
                                        <input type="text" value={editCustName} onChange={e => setEditCustName(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>SĐT</label>
                                        <input type="text" value={editCustPhone} onChange={e => setEditCustPhone(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', width: '100%' }}>
                                        <button className="btn btn-primary" onClick={handleSaveCustomerInfo}>Lưu thay đổi</button>
                                        <button className="btn btn-ghost" onClick={() => setIsEditingCustomer(false)}>Hủy</button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '32px' }}>
                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Họ tên:</span> <strong>{selectedOrder.customer_name || '—'}</strong></div>
                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>SĐT:</span> <strong>{selectedOrder.customer_phone || '—'}</strong></div>
                                </div>
                            )}
                        </div>

                        {/* Order Meta */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px', fontSize: '14px' }}>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Thời gian</div>{fmtDT(selectedOrder.created_at)}</div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Thu ngân</div>{selectedOrder.created_by_name}</div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Thanh toán</div>{selectedOrder.payment_method}</div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Ghi chú</div>{selectedOrder.note || '—'}</div>
                        </div>

                        <hr style={{ border: 'none', borderTop: '1px dashed var(--border-color)' }} />

                        {/* Items List */}
                        <div style={{ fontWeight: 600, fontSize: '15px' }}>🛒 Chi tiết Hóa đơn</div>
                        <div style={{ border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '14px' }}>
                                <thead style={{ background: 'var(--bg-hover)' }}>
                                    <tr>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Sản phẩm / Gói vé</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>SL/Lượt</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600 }}>Đơn giá</th>
                                        <th style={{ padding: '12px 16px', color: 'var(--text-secondary)', fontWeight: 600, textAlign: 'right' }}>Thành tiền</th>
                                        <th style={{ width: '80px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedOrder.products.map(p => (
                                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={{ padding: '12px 16px' }}>🛍️ {p.product_name}</td>
                                            <td style={{ padding: '12px 16px' }}>{p.quantity}</td>
                                            <td style={{ padding: '12px 16px' }}>{fmt(p.unit_price)}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{fmt(p.subtotal)}</td>
                                            <td></td>
                                        </tr>
                                    ))}
                                    {selectedOrder.tickets.map(t => {
                                        const st = getStatusBadge(t.status);
                                        return (
                                            <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', background: '#f0f9ff' }}>
                                                <td style={{ padding: '12px 16px' }}>
                                                    <div style={{ fontWeight: 600 }}>🎫 {t.type_name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                                        {t.card_code ? `Thẻ: ${maskCardCode(t.card_code)} • ` : ''}
                                                        {fmtDate(t.valid_from)} - {fmtDate(t.valid_until)}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>
                                                    {t.remaining_sessions !== null ? `${t.remaining_sessions}/${t.total_sessions}` : '∞'} lượt
                                                    <div style={{ marginTop: '4px' }}><span style={{ ...st, padding: '2px 6px', borderRadius: '4px', fontSize: '10px' }}>{st.text}</span></div>
                                                </td>
                                                <td style={{ padding: '12px 16px' }}>{fmt(t.price_paid)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                                <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                    <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '4px 8px', color: '#0369a1' }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setSelectedPkg(t);
                                                            setEditSessions(t.remaining_sessions !== null ? t.remaining_sessions : '');
                                                            setEditTotalSessions(t.total_sessions !== null ? t.total_sessions : '');
                                                            setEditValidFrom(t.valid_from || '');
                                                            setEditValidUntil(t.valid_until || '');
                                                            setEditCardCode(t.card_code || '');
                                                            setIsEditingPkg(true);
                                                        }}>
                                                        Sửa
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td colSpan={3} style={{ padding: '16px', textAlign: 'right', fontWeight: 600 }}>Tổng Hóa Đơn:</td>
                                        <td style={{ padding: '16px', textAlign: 'right', fontWeight: 700, fontSize: '18px', color: '#dc2626' }}>{fmt(selectedOrder.total_amount)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                    </div>
                </div>
            )}

            {/* EDIT PACKAGE MODAL */}
            {isEditingPkg && selectedPkg && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100 }}
                    onClick={() => setIsEditingPkg(false)}>

                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', width: '90%', maxWidth: '400px', display: 'flex', flexDirection: 'column', gap: '16px' }}
                        onClick={e => e.stopPropagation()}>

                        <h3 style={{ fontSize: '18px', fontWeight: 700 }}>✏️ Chỉnh sửa Gói Vé</h3>
                        <div style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>{selectedPkg.type_name}</div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Mã thẻ từ</label>
                                <input type="text" value={editCardCode} onChange={e => setEditCardCode(normalizeScannerInput(e.target.value))} placeholder="Nhập mã thẻ..." style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)', fontWeight: 600 }} />
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>*Để trống nếu không dùng thẻ từ</div>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Lượt còn lại</label>
                                    <input type="number" min="0" value={editSessions} onChange={e => setEditSessions(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Tổng lượt</label>
                                    <input type="number" min="0" value={editTotalSessions} onChange={e => setEditTotalSessions(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Có giá trị từ</label>
                                    <input type="date" value={editValidFrom} onChange={e => setEditValidFrom(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', display: 'block', marginBottom: '4px' }}>Đến ngày</label>
                                    <input type="date" value={editValidUntil} onChange={e => setEditValidUntil(e.target.value)} style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid var(--border-color)' }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setIsEditingPkg(false)}>Hủy</button>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleUpdatePackage}>Lưu & Cập nhật</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
