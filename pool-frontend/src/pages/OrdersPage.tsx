/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/exhaustive-deps, react-hooks/rules-of-hooks */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { getTodayLocalVN } from '../utils/helpers';
import { normalizeScannerInput } from '../utils/scannerUtils';
import { Badge, Drawer, PageHeader, SegmentedTabs } from '../components/ui';

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

    // Edit Order Date
    const [isEditingOrderDate, setIsEditingOrderDate] = useState(false);
    const [editOrderDate, setEditOrderDate] = useState('');

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
            .gte('created_at', `${from}T00:00:00+07:00`)
            .lte('created_at', `${to}T23:59:59.999+07:00`)
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

    async function handleSaveOrderDate() {
        if (!selectedOrder) return;
        if (!editOrderDate) {
            alert('Vui lòng chọn ngày giờ!');
            return;
        }
        if (!confirm('Bạn có chắc chắn muốn thay đổi thời gian của hóa đơn và các vé đi kèm?')) return;

        const newDateIso = new Date(editOrderDate).toISOString();

        // Update orders table
        const { error: err1 } = await supabase
            .from('orders')
            .update({ created_at: newDateIso })
            .eq('id', selectedOrder.id);

        if (err1) { alert('Lỗi: ' + err1.message); return; }

        // Update tickets table for tickets in this order
        const ticketIds = selectedOrder.tickets.map(t => t.id);
        if (ticketIds.length > 0) {
            await supabase
                .from('tickets')
                .update({ sold_at: newDateIso })
                .in('id', ticketIds);
        }

        alert('✅ Cập nhật thời gian thành công!');
        setIsEditingOrderDate(false);
        // Refresh detail view
        const updatedOrder = { ...selectedOrder, created_at: newDateIso };
        updatedOrder.tickets = updatedOrder.tickets.map(t => ({ ...t, sold_at: newDateIso }));
        setSelectedOrder(updatedOrder);

        // Refresh list
        setOrders(prev => prev.map(o => o.id === selectedOrder.id ? updatedOrder : o));
    }

    async function handleUpdatePackage() {
        if (!selectedPkg) return;
        if (!confirm('Bạn có chắc chắn muốn lưu các thay đổi này?')) return;

        let finalStatus = selectedPkg.status;
        const updatedRemaining = editSessions === '' ? null : Number(editSessions);
        const finalValidUntil = editValidUntil || null;

        const today = getTodayLocalVN();
        const isDateExpired = finalValidUntil && finalValidUntil < today;
        const isSessionExpired = updatedRemaining !== null && updatedRemaining <= 0;

        if (isDateExpired || isSessionExpired) {
            finalStatus = 'EXPIRED';
        } else if (finalStatus === 'EXPIRED') {
            finalStatus = editValidFrom ? 'IN_USE' : 'UNUSED';
        }

        const updateData: any = {
            status: finalStatus,
            remaining_sessions: updatedRemaining,
            total_sessions: editTotalSessions === '' ? null : Number(editTotalSessions),
            valid_from: editValidFrom || null,
            valid_until: finalValidUntil,
        };

        if (editCardCode.trim() !== (selectedPkg.card_code || '')) {
            const cleanCard = editCardCode.trim().toUpperCase();
            updateData.card_code = cleanCard || null;
            if (cleanCard) {
                await supabase
                    .from('card_bank')
                    .upsert(
                        { card_code: cleanCard, prefix: 'M', status: 'USED', source: 'MANUAL', created_by: profile?.id },
                        { onConflict: 'card_code' }
                    );
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

    return (
        <div className="page-container">
            <PageHeader
                title="Danh Sách Hóa Đơn"
                subtitle="Quản lý hóa đơn bán hàng, điều chỉnh thông tin và tùy chỉnh gói dịch vụ (Admin)"
            />

            {/* Controls */}
            <div className="ui-filter-bar">
                <input
                    type="text"
                    className="ui-search-input"
                    placeholder="🔍 Tên KH, SĐT, Mã HĐ..."
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />

                <SegmentedTabs
                    size="sm"
                    tabs={[
                        { key: 'THIS_MONTH', label: 'Tháng này' },
                        { key: 'LAST_MONTH', label: 'Tháng trước' },
                        { key: 'TODAY', label: 'Hôm nay' },
                        { key: 'CUSTOM', label: 'Tùy chọn' },
                    ]}
                    activeKey={dateRange}
                    onChange={(k) => setDateRange(k as DateRange)}
                />
                {dateRange === 'CUSTOM' && (
                    <>
                        <input type="date" className="ui-date-input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                        <span style={{ color: 'var(--text-secondary)' }}>→</span>
                        <input type="date" className="ui-date-input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
                    </>
                )}
            </div>

            <div className="table-wrap">
                <table>
                    <thead>
                        <tr>
                            <th>Mã ĐH</th>
                            <th>Ngày giờ</th>
                            <th>Khách hàng</th>
                            <th>SĐT</th>
                            <th>Nội dung</th>
                            <th style={{ textAlign: 'right' }}>Tổng tiền</th>
                            <th>Thanh toán</th>
                            <th>Người tạo</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredOrders.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có hóa đơn trong khoảng thời gian này.</td></tr>
                        ) : filteredOrders.map(o => (
                            <tr key={o.id} style={{ cursor: 'pointer' }} onClick={() => openOrderModal(o)}>
                                <td style={{ fontFamily: 'monospace', fontSize: '12px', color: 'var(--text-secondary)' }}>{o.id.substring(0, 8).toUpperCase()}</td>
                                <td className="tabular-nums">{fmtDT(o.created_at)}</td>
                                <td style={{ fontWeight: 600 }}>{o.customer_name || '—'}</td>
                                <td className="tabular-nums">{o.customer_phone || '—'}</td>
                                <td>
                                    <div style={{ fontSize: '12.5px' }}>
                                        {o.tickets.length > 0 && <span style={{ color: 'var(--accent-blue)', marginRight: '8px', fontWeight: 600 }}>🎫 {o.tickets.length} vé</span>}
                                        {o.products.length > 0 && <span style={{ color: 'var(--accent-purple)', fontWeight: 600 }}>🛍️ {o.products.reduce((acc, p) => acc + p.quantity, 0)} sp</span>}
                                    </div>
                                </td>
                                <td className="tabular-nums" style={{ fontWeight: 700, textAlign: 'right' }}>{fmt(o.total_amount)}</td>
                                <td>
                                    <Badge variant={o.payment_method === 'CASH' ? 'green' : o.payment_method === 'TRANSFER' || o.payment_method === 'TRANSFER_COMPANY' ? 'blue' : 'purple'}>
                                        {o.payment_method === 'CASH' ? '💵 Tiền mặt' : o.payment_method === 'TRANSFER' ? '🏦 Chuyển khoản' : o.payment_method === 'TRANSFER_COMPANY' ? '🏢 CK Công ty' : '💳 Quẹt thẻ'}
                                    </Badge>
                                </td>
                                <td style={{ color: 'var(--text-secondary)' }}>{o.created_by_name}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* ORDER DETAIL DRAWER */}
            <Drawer
                open={Boolean(selectedOrder)}
                onClose={() => { setSelectedOrder(null); setIsEditingPkg(false); setSelectedPkg(null); }}
                title={selectedOrder ? `Chi tiết Hóa đơn #${selectedOrder.id.substring(0, 8).toUpperCase()}` : ''}
                subtitle={selectedOrder ? `${fmtDT(selectedOrder.created_at)} · Thu ngân: ${selectedOrder.created_by_name || '—'}` : undefined}
                width={760}
            >
                {selectedOrder && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
                        {/* Customer Info Section */}
                        <div className="ui-callout">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <div style={{ fontWeight: 700, fontSize: '14px' }}>👤 Thông tin khách hàng</div>
                                {!isEditingCustomer && (
                                    <button type="button" className="btn btn-ghost btn-sm"
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
                                        <input type="text" className="input" value={editCustName} onChange={e => setEditCustName(e.target.value)} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: '150px' }}>
                                        <label style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }}>SĐT</label>
                                        <input type="text" className="input" value={editCustPhone} onChange={e => setEditCustPhone(e.target.value)} />
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', width: '100%' }}>
                                        <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveCustomerInfo}>Lưu thay đổi</button>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setIsEditingCustomer(false)}>Hủy</button>
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', gap: '28px', flexWrap: 'wrap' }}>
                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Họ tên:</span> <strong>{selectedOrder.customer_name || '—'}</strong></div>
                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>SĐT:</span> <strong className="tabular-nums">{selectedOrder.customer_phone || '—'}</strong></div>
                                </div>
                            )}
                        </div>

                        {/* Order Meta */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px', fontSize: '13.5px' }}>
                            <div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    Thời gian
                                    {!isEditingOrderDate && <button type="button" className="btn btn-ghost" style={{ padding: '2px 4px', fontSize: '10px', height: 'auto' }} onClick={() => {
                                        const dt = new Date(selectedOrder.created_at);
                                        dt.setMinutes(dt.getMinutes() - dt.getTimezoneOffset());
                                        setEditOrderDate(dt.toISOString().slice(0, 16));
                                        setIsEditingOrderDate(true);
                                    }}>✏️</button>}
                                </div>
                                {isEditingOrderDate ? (
                                    <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                                        <input type="datetime-local" className="input" value={editOrderDate} onChange={e => setEditOrderDate(e.target.value)} style={{ padding: '4px 8px', fontSize: '12px' }} />
                                        <button type="button" className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={handleSaveOrderDate}>Lưu</button>
                                        <button type="button" className="btn btn-ghost btn-sm" style={{ flex: 1 }} onClick={() => setIsEditingOrderDate(false)}>✕</button>
                                    </div>
                                ) : (
                                    <div className="tabular-nums" style={{ marginTop: '2px', fontWeight: 600 }}>{fmtDT(selectedOrder.created_at)}</div>
                                )}
                            </div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Thu ngân</div><strong>{selectedOrder.created_by_name}</strong></div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Thanh toán</div><strong>{selectedOrder.payment_method}</strong></div>
                            <div><div style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>Ghi chú</div><span>{selectedOrder.note || '—'}</span></div>
                        </div>

                        <hr style={{ border: 'none', borderTop: '1px dashed var(--border-color)' }} />

                        {/* Items List */}
                        <div style={{ fontWeight: 700, fontSize: '14.5px' }}>🛒 Chi tiết Hóa đơn</div>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Sản phẩm / Gói vé</th>
                                        <th>SL/Lượt</th>
                                        <th style={{ textAlign: 'right' }}>Đơn giá</th>
                                        <th style={{ textAlign: 'right' }}>Thành tiền</th>
                                        <th style={{ width: '70px' }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedOrder.products.map(p => (
                                        <tr key={p.id}>
                                            <td>🛍️ {p.product_name}</td>
                                            <td className="tabular-nums">{p.quantity}</td>
                                            <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmt(p.unit_price)}</td>
                                            <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(p.subtotal)}</td>
                                            <td></td>
                                        </tr>
                                    ))}
                                    {selectedOrder.tickets.map(t => {
                                        const st = getStatusBadge(t.status);
                                        return (
                                            <tr key={t.id} style={{ background: 'var(--accent-blue-soft)' }}>
                                                <td>
                                                    <div style={{ fontWeight: 600 }}>🎫 {t.type_name}</div>
                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '3px' }}>
                                                        {t.card_code ? `Thẻ: ${maskCardCode(t.card_code)} • ` : ''}
                                                        {fmtDate(t.valid_from)} - {fmtDate(t.valid_until)}
                                                    </div>
                                                </td>
                                                <td className="tabular-nums">
                                                    {t.remaining_sessions !== null ? `${t.remaining_sessions}/${t.total_sessions}` : '∞'} lượt
                                                    <div style={{ marginTop: '4px' }}><span className="ui-badge" style={{ ...st, fontSize: '10.5px' }}>{st.text}</span></div>
                                                </td>
                                                <td className="tabular-nums" style={{ textAlign: 'right' }}>{fmt(t.price_paid)}</td>
                                                <td className="tabular-nums" style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--accent-blue)' }}
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
                                        <td colSpan={3} style={{ padding: '14px', textAlign: 'right', fontWeight: 700 }}>Tổng Hóa Đơn:</td>
                                        <td className="tabular-nums" style={{ padding: '14px', textAlign: 'right', fontWeight: 800, fontSize: '17px', color: 'var(--accent-red)' }}>{fmt(selectedOrder.total_amount)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}
            </Drawer>

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
