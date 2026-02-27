import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';

type ReportTab = 'REVENUE' | 'SESSIONS' | 'WARNINGS' | 'DAILY_PASSES' | 'MY_SALES' | 'LESSON_PACKAGES';
type DateRange = 'TODAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';

interface TicketRow {
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    card_code: string | null;
    price_paid: number;
    sold_at: string;
    status: string;
    valid_from: string | null;
    valid_until: string | null;
    remaining_sessions: number | null;
    total_sessions: number | null;
    type_name: string;
    category: string;
    type_price: number;
    sold_by_name: string | null;
    payment_method: string;
    lesson_class_type: string | null;
    lesson_schedule_type: string | null;
}

interface ScanLogRow {
    id: string;
    scanned_at: string;
    status: string;
    ticket_id: string;
    ticket: {
        customer_name: string | null;
        customer_phone: string | null;
        card_code: string | null;
        price_paid: number;
        type_name: string;
        category: string;
    } | null;
}

export default function DashboardPage() {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'ADMIN';

    const [activeTab, setActiveTab] = useState<ReportTab>('REVENUE');
    const [dateRange, setDateRange] = useState<DateRange>('TODAY');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [tickets, setTickets] = useState<TicketRow[]>([]);
    const [scanLogs, setScanLogs] = useState<ScanLogRow[]>([]);
    const [loading, setLoading] = useState(false);

    // Business Info for Printing
    const [bizInfo, setBizInfo] = useState<{ name: string; address: string; phone: string; logo: string }>({
        name: 'Hệ Thống Vé Bơi', address: '', phone: '', logo: ''
    });

    const [dailyPassFilter, setDailyPassFilter] = useState<'ALL' | 'UNUSED' | 'VERIFIED' | 'EXPIRED'>('ALL');

    // Compute date range
    function getDateBounds(): { from: string; to: string } {
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

        if (dateRange === 'TODAY') {
            return { from: todayStr, to: todayStr };
        } else if (dateRange === 'THIS_MONTH') {
            const first = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
            return { from: first, to: todayStr };
        } else if (dateRange === 'LAST_MONTH') {
            const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            const lastDay = new Date(now.getFullYear(), now.getMonth(), 0);
            const first = `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-01`;
            const last = `${lastDay.getFullYear()}-${pad(lastDay.getMonth() + 1)}-${pad(lastDay.getDate())}`;
            return { from: first, to: last };
        } else {
            return { from: customFrom || todayStr, to: customTo || todayStr };
        }
    }

    useEffect(() => {
        fetchTickets();
        if (activeTab === 'SESSIONS') fetchScanLogs();
        fetchBusinessInfo();
    }, [dateRange, customFrom, customTo, activeTab]);

    async function fetchBusinessInfo() {
        const { data } = await supabase.from('system_settings').select('key, value');
        if (data) {
            const info: any = {};
            data.forEach(r => {
                let val = r.value;
                try {
                    val = typeof val === 'string' ? val.replace(/^"|"$/g, '') : JSON.parse(JSON.stringify(val)).replace(/^"|"$/g, '');
                } catch (e) {
                    val = typeof val === 'string' ? val : String(val);
                }
                info[r.key] = val;
            });
            setBizInfo({
                name: info.business_name || 'Hệ Thống Vé Bơi',
                address: info.business_address || '',
                phone: info.business_phone || '',
                logo: info.business_logo || ''
            });
        }
    }

    async function fetchTickets() {
        setLoading(true);
        const { from, to } = getDateBounds();

        let query = supabase
            .from('tickets')
            .select(`
                id, customer_name, customer_phone, card_code, price_paid, sold_at, status,
                valid_from, valid_until, remaining_sessions, total_sessions, payment_method,
                ticket_types!inner (name, category, price, lesson_class_type, lesson_schedule_type),
                profiles:sold_by (full_name)
            `)
            .gte('sold_at', from + 'T00:00:00+07:00')
            .lte('sold_at', to + 'T23:59:59+07:00')
            .order('sold_at', { ascending: false });

        // For non-admin staff, only show their own sales (unless they are viewing warnings)
        if (!isAdmin && profile && activeTab !== 'WARNINGS') {
            query = query.eq('sold_by', profile.id);
        }

        const { data, error } = await query;

        if (error) {
            console.error('Error:', error);
            setTickets([]);
        } else {
            const today = new Date().toLocaleDateString('en-CA');
            const mapped = (data || []).map((t: any) => {
                let computedStatus = t.status;
                const soldDate = t.sold_at.substring(0, 10);

                // If it's a daily ticket, unused, and from a past date, force status to EXPIRED
                if (t.ticket_types?.category === 'DAILY' && computedStatus === 'UNUSED' && soldDate < today) {
                    computedStatus = 'EXPIRED';
                }

                return {
                    id: t.id,
                    customer_name: t.customer_name,
                    customer_phone: t.customer_phone,
                    card_code: t.card_code,
                    price_paid: t.price_paid,
                    sold_at: t.sold_at,
                    status: computedStatus,
                    valid_from: t.valid_from,
                    valid_until: t.valid_until,
                    remaining_sessions: t.remaining_sessions,
                    total_sessions: t.total_sessions,
                    type_name: t.ticket_types?.name || '',
                    category: t.ticket_types?.category || '',
                    type_price: t.ticket_types?.price || 0,
                    sold_by_name: t.profiles?.full_name || '—',
                    payment_method: t.payment_method || 'CASH',
                    lesson_class_type: t.ticket_types?.lesson_class_type || null,
                    lesson_schedule_type: t.ticket_types?.lesson_schedule_type || null
                };
            });
            setTickets(mapped);
        }
        setLoading(false);
    }

    async function fetchScanLogs() {
        setLoading(true);
        const { from, to } = getDateBounds();

        const { data, error } = await supabase
            .from('scan_logs')
            .select(`
                id, scanned_at, status, ticket_id,
                tickets (
                    customer_name, customer_phone, card_code, price_paid,
                    ticket_types (name, category)
                )
            `)
            .eq('status', 'IN') // Only count successful check-ins
            .gte('scanned_at', from + 'T00:00:00+07:00')
            .lte('scanned_at', to + 'T23:59:59+07:00')
            .order('scanned_at', { ascending: false });

        if (error) {
            console.error('Error fetching scan logs:', error);
            setScanLogs([]);
        } else {
            const mapped = (data || []).map((row: any) => ({
                id: row.id,
                scanned_at: row.scanned_at,
                status: row.status,
                ticket_id: row.ticket_id,
                ticket: row.tickets ? {
                    customer_name: row.tickets.customer_name,
                    customer_phone: row.tickets.customer_phone,
                    card_code: row.tickets.card_code,
                    price_paid: row.tickets.price_paid,
                    type_name: row.tickets.ticket_types?.name || 'Không rõ',
                    category: row.tickets.ticket_types?.category || 'UNKNOWN'
                } : null
            }));
            setScanLogs(mapped);
        }
        setLoading(false);
    }

    // --- WARNINGS: Fetch all active passes ---
    const [warningTickets, setWarningTickets] = useState<TicketRow[]>([]);
    useEffect(() => {
        if (activeTab === 'WARNINGS') fetchWarnings();
    }, [activeTab]);

    async function fetchWarnings() {
        setLoading(true);
        const { data } = await supabase
            .from('tickets')
            .select(`
                id, customer_name, customer_phone, card_code, price_paid, sold_at, status,
                valid_from, valid_until, remaining_sessions, total_sessions, payment_method,
                ticket_types!inner (name, category, price, lesson_class_type, lesson_schedule_type),
                profiles:sold_by (full_name)
            `)
            .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
            .neq('status', 'EXPIRED')
            .order('valid_until', { ascending: true });

        const mapped = (data || []).map((t: any) => ({
            id: t.id,
            customer_name: t.customer_name,
            customer_phone: t.customer_phone,
            card_code: t.card_code,
            price_paid: t.price_paid,
            sold_at: t.sold_at,
            status: t.status,
            valid_from: t.valid_from,
            valid_until: t.valid_until,
            remaining_sessions: t.remaining_sessions,
            total_sessions: t.total_sessions,
            type_name: t.ticket_types?.name || '',
            category: t.ticket_types?.category || '',
            type_price: t.ticket_types?.price || 0,
            sold_by_name: t.profiles?.full_name || '—',
            payment_method: t.payment_method || 'CASH',
            lesson_class_type: t.ticket_types?.lesson_class_type || null,
            lesson_schedule_type: t.ticket_types?.lesson_schedule_type || null
        }));

        // Filter: expiring within 7 days OR remaining_sessions <= 3
        const now = new Date();
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const filtered = mapped.filter(t => {
            const expiringSoon = t.valid_until && new Date(t.valid_until) <= sevenDaysLater;
            const lowSessions = t.remaining_sessions !== null && t.remaining_sessions <= 3;
            return expiringSoon || lowSessions;
        });

        setWarningTickets(filtered);
        setLoading(false);
    }

    // --- Computed data ---
    const dailyTickets = tickets.filter(t => t.category === 'DAILY' && t.type_price > 0);
    const lessonTickets = tickets.filter(t => t.type_price === 0);
    const totalRevenue = tickets.reduce((s, t) => s + t.price_paid, 0);
    const revCash = tickets.filter(t => t.payment_method === 'CASH').reduce((s, t) => s + t.price_paid, 0);
    const revTransfer = tickets.filter(t => t.payment_method === 'TRANSFER').reduce((s, t) => s + t.price_paid, 0);
    const revCard = tickets.filter(t => t.payment_method === 'CARD').reduce((s, t) => s + t.price_paid, 0);

    // --- FORMAT ---
    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
    const fmtDateTime = (d: string) => { const dt = new Date(d); return dt.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + dt.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }); };

    // --- PRINT A4 Landscape ---
    function handlePrintReport(title: string, tableHtml: string) {
        const now = new Date();
        const printDate = now.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const signatureFooter = `
            <div style="display:flex; justify-content:space-between; margin-top:40px; padding:0 24px; page-break-inside:avoid;">
                <div style="text-align:center; min-width:160px;">
                    <div style="font-weight:700; margin-bottom:4px;">Người lập</div>
                    <div style="font-size:10px; font-style:italic; color:#666;">(Ký và ghi rõ họ tên)</div>
                    <div style="height:60px;"></div>
                </div>
                <div style="text-align:center; min-width:160px;">
                    <div style="font-weight:700; margin-bottom:4px;">Kế toán</div>
                    <div style="font-size:10px; font-style:italic; color:#666;">(Ký và ghi rõ họ tên)</div>
                    <div style="height:60px;"></div>
                </div>
                <div style="text-align:center; min-width:160px;">
                    <div style="font-weight:700; margin-bottom:4px;">Quản lý</div>
                    <div style="font-size:10px; font-style:italic; color:#666;">(Ký và ghi rõ họ tên)</div>
                    <div style="height:60px;"></div>
                </div>
            </div>`;

        const win = window.open('', '_blank', 'width=1100,height=700');
        if (!win) return;
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
            .footer { margin-top: 16px; font-size: 10px; color: #999; text-align: center; }
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
            ${signatureFooter}
            <p class="footer">${bizInfo.name} — Phầm mềm quản lý bán vé tự động</p>
            <script>setTimeout(function(){ window.print(); }, 500);<\/script>
        </body></html>`);
        win.document.close();
    }

    // --- EXCEL EXPORT (.xlsx) ---
    function exportExcel(filename: string, headers: string[], rows: string[][]) {
        const wsData = [headers, ...rows];
        const ws = XLSX.utils.aoa_to_sheet(wsData);

        // Auto-fit column widths
        const colWidths = headers.map((h, i) => {
            const maxLen = Math.max(h.length, ...rows.map(r => (r[i] || '').length));
            return { wch: Math.min(maxLen + 2, 40) };
        });
        ws['!cols'] = colWidths;

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Báo cáo');
        XLSX.writeFile(wb, filename + '.xlsx');
    }

    // --- RENDER HELPERS ---
    function renderDateFilter() {
        return (
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', alignItems: 'center' }}>
                {(['TODAY', 'THIS_MONTH', 'LAST_MONTH', 'CUSTOM'] as DateRange[]).map(r => (
                    <button key={r} className={`btn ${dateRange === r ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ padding: '6px 14px', fontSize: '13px' }}
                        onClick={() => setDateRange(r)}>
                        {r === 'TODAY' ? 'Hôm nay' : r === 'THIS_MONTH' ? 'Tháng này' : r === 'LAST_MONTH' ? 'Tháng trước' : 'Tùy chọn'}
                    </button>
                ))}
                {dateRange === 'CUSTOM' && (
                    <>
                        <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} style={dateInputStyle} />
                        <span style={{ color: 'var(--text-secondary)' }}>→</span>
                        <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} style={dateInputStyle} />
                    </>
                )}
            </div>
        );
    }

    function renderRevenueTab() {
        const { from, to } = getDateBounds();
        const tableHtml = `<table><thead><tr><th>STT</th><th>Loại vé</th><th>Khách hàng</th><th>SĐT</th><th>Mã thẻ</th><th>H/T Thanh toán</th><th>Giá bán</th><th>Người bán</th><th>Thời gian</th></tr></thead><tbody>
            ${tickets.map((t, i) => {
            const paymentStr = t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS';
            return `<tr><td>${i + 1}</td><td>${t.type_name}</td><td>${t.customer_name || 'Khách lẻ'}</td><td>${t.customer_phone || ''}</td><td>${t.card_code || ''}</td><td>${paymentStr}</td><td style="text-align:right">${fmt(t.price_paid)}</td><td>${t.sold_by_name}</td><td>${fmtDateTime(t.sold_at)}</td></tr>`;
        }).join('')}
            <tr class="total-row"><td colspan="6">TỔNG CỘNG (${tickets.length} vé)</td><td style="text-align:right">${fmt(totalRevenue)}</td><td colspan="2"></td></tr>
            </tbody></table>
            
            <div style="margin-top: 24px; padding: 16px; border: 1px solid #999; width: 300px; font-weight: bold; line-height: 1.8;">
                <h3 style="margin-bottom: 8px; font-size: 14px; text-transform: uppercase;">Thống kê Thanh Toán</h3>
                <div style="display:flex; justify-content:space-between"><span>Tiền mặt:</span> <span>${fmt(revCash)}</span></div>
                <div style="display:flex; justify-content:space-between"><span>Chuyển khoản:</span> <span>${fmt(revTransfer)}</span></div>
                <div style="display:flex; justify-content:space-between"><span>Quẹt Thẻ POS:</span> <span>${fmt(revCard)}</span></div>
                <div style="display:flex; justify-content:space-between; border-top: 1px solid #ccc; margin-top: 8px; padding-top: 8px; color: #10b981;"><span>TỔNG THU:</span> <span>${fmt(totalRevenue)}</span></div>
            </div>`;

        return (
            <>
                {renderDateFilter()}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px', marginBottom: '16px' }}>
                    {[{ label: 'Tổng doanh thu', value: fmt(totalRevenue), color: '#10b981' },
                    { label: 'Số vé bán', value: `${tickets.length - lessonTickets.length} vé`, color: '#3b82f6' },
                    { label: 'Khách Học Bơi', value: `${lessonTickets.length} vé`, color: '#ec4899' },
                    { label: 'Tiền mặt', value: fmt(revCash), color: '#64748b' },
                    { label: 'Chuyển khoản', value: fmt(revTransfer), color: '#f59e0b' },
                    { label: 'Thẻ POS', value: fmt(revCard), color: '#8b5cf6' }
                    ].map(k => (
                        <div key={k.label} style={{ flex: 1, minWidth: '120px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                            <div style={{ fontSize: '18px', fontWeight: 700, color: k.color }}>{k.value}</div>
                            <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '2px' }}>{k.label}</div>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => handlePrintReport(`Báo cáo Doanh thu (${from} → ${to})`, tableHtml)}>🖨️ In A4</button>
                    <button className="btn btn-secondary" onClick={() => exportExcel(`doanh_thu_${from}_${to}`, ['STT', 'Loại vé', 'Khách hàng', 'SĐT', 'Mã thẻ', 'H/T Thanh toán', 'Giá bán', 'Người bán', 'Thời gian'],
                        tickets.map((t, i) => [
                            String(i + 1), t.type_name, t.customer_name || 'Khách lẻ', t.customer_phone || '', t.card_code || '',
                            t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS',
                            String(t.price_paid), t.sold_by_name || '', fmtDateTime(t.sold_at)
                        ])
                    )}>📊 Xuất Excel</button>
                </div>
                {renderTicketTable(tickets)}
            </>
        );
    }

    function renderSessionsTab() {
        const { from, to } = getDateBounds();

        // Categorize scan logs
        const dailyScans = scanLogs.filter(s => s.ticket?.category === 'DAILY');
        const multiScans = scanLogs.filter(s => s.ticket?.category === 'MULTI');
        const monthlyScans = scanLogs.filter(s => s.ticket?.category === 'MONTHLY');
        const lessonScans = scanLogs.filter(s => s.ticket?.category === 'LESSON');

        const sections = [
            { title: 'Khách Lẻ (Vé lượt)', data: dailyScans, color: '#f59e0b' },
            { title: 'Khách Nhiều Buổi', data: multiScans, color: '#8b5cf6' },
            { title: 'Khách Vé Tháng', data: monthlyScans, color: '#3b82f6' },
            { title: 'Học Bơi', data: lessonScans, color: '#ec4899' },
        ];

        const allTableHtml = sections.map(s => `<h3 style="margin:16px 0 4px">${s.title} (${s.data.length} lượt)</h3>` +
            `<table><thead><tr><th>STT</th><th>Khách</th><th>Loại vé</th><th>Mã thẻ</th><th>Thời gian vào cổng</th></tr></thead><tbody>` +
            s.data.map((t, i) => `<tr><td>${i + 1}</td><td>${t.ticket?.customer_name || 'Khách lẻ'}</td><td>${t.ticket?.type_name || ''}</td><td>${t.ticket?.card_code || ''}</td><td>${fmtDateTime(t.scanned_at)}</td></tr>`).join('') +
            `</tbody></table>`
        ).join('');

        return (
            <>
                {renderDateFilter()}
                <div style={{ marginBottom: '16px', padding: '12px', background: '#dbeafe', borderRadius: '8px', color: '#1e40af', fontSize: '13px' }}>
                    ℹ️ Lượt khách: Đếm số người khách <strong>đã quét mã/quẹt thẻ qua cổng</strong> thành công (chỉ đếm lượt IN). Báo cáo liệt kê khách thực tế đến hồ bơi.
                </div>
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    {sections.map(s => (
                        <div key={s.title} style={{ flex: 1, minWidth: '140px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                            <div style={{ fontSize: '22px', fontWeight: 700, color: s.color }}>{s.data.length}</div>
                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{s.title}</div>
                        </div>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => handlePrintReport(`Báo cáo Lượt Khách Qua Cổng (${from} → ${to})`, allTableHtml)}>🖨️ In A4</button>
                    <button className="btn btn-secondary" onClick={() => exportExcel(`luot_khach_qua_cong_${from}_${to}`, ['STT', 'Loại', 'Khách', 'Loại vé', 'Mã thẻ', 'Thời gian vào'],
                        scanLogs.map((s, i) => [String(i + 1), s.ticket?.category || '', s.ticket?.customer_name || 'Khách lẻ', s.ticket?.type_name || '', s.ticket?.card_code || '', fmtDateTime(s.scanned_at)])
                    )}>📊 Xuất Excel</button>
                </div>
                {sections.map(s => (
                    <div key={s.title} style={{ marginBottom: '20px' }}>
                        <h3 style={{ fontSize: '15px', marginBottom: '8px', color: s.color }}>● {s.title} ({s.data.length} lượt vào)</h3>
                        {s.data.length > 0 ? (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={thS}>#</th><th style={thS}>Loại vé</th><th style={thS}>Khách</th><th style={thS}>Mã thẻ</th><th style={thS}>Thời gian qua cổng</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {s.data.map((l, i) => (
                                            <tr key={l.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                                <td style={tdS}>{i + 1}</td>
                                                <td style={tdS}>
                                                    <span style={{ background: l.ticket?.category === 'DAILY' ? '#dcfce7' : l.ticket?.category === 'MONTHLY' ? '#dbeafe' : '#fef3c7', color: l.ticket?.category === 'DAILY' ? '#166534' : l.ticket?.category === 'MONTHLY' ? '#1d4ed8' : '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                                                        {l.ticket?.type_name || 'Không rõ'}
                                                    </span>
                                                </td>
                                                <td style={tdS}>{l.ticket?.customer_name || 'Khách lẻ'}</td>
                                                <td style={tdS}>{l.ticket?.card_code ? <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{l.ticket.card_code}</code> : '—'}</td>
                                                <td style={{ ...tdS, fontWeight: 600, color: '#059669' }}>{fmtDateTime(l.scanned_at)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Không có lượt khách qua cổng ở phân loại này.</p>}
                    </div>
                ))}
            </>
        );
    }

    function renderWarningsTab() {
        const tableHtml = `<table><thead><tr><th>STT</th><th>Khách</th><th>SĐT</th><th>Mã thẻ</th><th>Loại</th><th>Lượt còn</th><th>Hết hạn</th><th>Cảnh báo</th></tr></thead><tbody>` +
            warningTickets.map((t, i) => {
                const warns: string[] = [];
                if (t.remaining_sessions !== null && t.remaining_sessions <= 3) warns.push(`Còn ${t.remaining_sessions} lượt`);
                if (t.valid_until && new Date(t.valid_until) <= new Date(Date.now() + 7 * 86400000)) warns.push('Sắp hết hạn');
                return `<tr><td>${i + 1}</td><td>${t.customer_name || '—'}</td><td>${t.customer_phone || ''}</td><td>${t.card_code || ''}</td><td>${t.type_name}</td><td>${t.remaining_sessions ?? '∞'}</td><td>${fmtDate(t.valid_until)}</td><td style="color:red;font-weight:700">${warns.join(', ')}</td></tr>`;
            }).join('') + `</tbody></table>`;

        return (
            <>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => handlePrintReport('Cảnh báo Khách sắp hết hạn / hết lượt', tableHtml)}>🖨️ In A4</button>
                    <button className="btn btn-secondary" onClick={() => exportExcel('canh_bao_khach', ['STT', 'Khách', 'SĐT', 'Mã thẻ', 'Loại', 'Lượt còn', 'Hết hạn'],
                        warningTickets.map((t, i) => [String(i + 1), t.customer_name || '—', t.customer_phone || '', t.card_code || '', t.type_name, String(t.remaining_sessions ?? '∞'), fmtDate(t.valid_until)])
                    )}>📊 Xuất Excel</button>
                </div>
                <div style={{ marginBottom: '12px', padding: '12px', background: '#fef3c7', borderRadius: '8px', color: '#92400e', fontSize: '13px' }}>
                    ⚠️ Hiển thị khách có thẻ sắp hết hạn (7 ngày) hoặc còn ≤ 3 lượt bơi.
                </div>
                {warningTickets.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '32px' }}>✅ Không có khách nào cần cảnh báo!</p>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={thS}>Khách</th><th style={thS}>SĐT</th><th style={thS}>Mã thẻ</th><th style={thS}>Loại</th><th style={thS}>Lượt còn</th><th style={thS}>Hết hạn</th><th style={thS}>Cảnh báo</th>
                                </tr>
                            </thead>
                            <tbody>
                                {warningTickets.map(t => {
                                    const warns: string[] = [];
                                    if (t.remaining_sessions !== null && t.remaining_sessions <= 3) warns.push(`Còn ${t.remaining_sessions} lượt`);
                                    if (t.valid_until && new Date(t.valid_until) <= new Date(Date.now() + 7 * 86400000)) warns.push('Sắp hết hạn');
                                    return (
                                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={tdS}><strong>{t.customer_name || '—'}</strong></td>
                                            <td style={tdS}>{t.customer_phone || '—'}</td>
                                            <td style={tdS}><code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{t.card_code || '—'}</code></td>
                                            <td style={tdS}>{t.type_name}</td>
                                            <td style={{ ...tdS, textAlign: 'center', color: (t.remaining_sessions !== null && t.remaining_sessions <= 3) ? '#ef4444' : '', fontWeight: 700 }}>
                                                {t.remaining_sessions ?? '∞'}
                                            </td>
                                            <td style={{ ...tdS, color: (t.valid_until && new Date(t.valid_until) <= new Date(Date.now() + 7 * 86400000)) ? '#ef4444' : '' }}>
                                                {fmtDate(t.valid_until)}
                                            </td>
                                            <td style={{ ...tdS, color: '#ef4444', fontWeight: 700, fontSize: '12px' }}>{warns.join(', ')}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </>
        );
    }

    function renderDailyPassesTab() {
        const { from, to } = getDateBounds();

        let filteredTickets = dailyTickets;
        if (dailyPassFilter === 'UNUSED') filteredTickets = filteredTickets.filter(t => t.status === 'UNUSED');
        if (dailyPassFilter === 'VERIFIED') filteredTickets = filteredTickets.filter(t => t.status !== 'UNUSED' && t.status !== 'EXPIRED');
        if (dailyPassFilter === 'EXPIRED') filteredTickets = filteredTickets.filter(t => t.status === 'EXPIRED'); // New EXPIRED filter

        const totalSold = dailyTickets.length;
        const totalUsed = dailyTickets.filter(t => t.status !== 'UNUSED' && t.status !== 'EXPIRED').length;
        const totalUnused = dailyTickets.filter(t => t.status === 'UNUSED').length;
        const totalExpired = dailyTickets.filter(t => t.status === 'EXPIRED').length;

        const tableHtml = `<table><thead><tr><th>STT</th><th>Mã vé</th><th>Loại vé</th><th>Trạng thái</th><th>Giá bán</th><th>Người bán</th><th>Giờ bán</th></tr></thead><tbody>
            ${filteredTickets.map((t, i) => `<tr><td>${i + 1}</td><td><code style="background:#f1f5f9;padding:2px 6px;border-radius:4px;">${t.id.substring(0, 8).toUpperCase()}</code></td><td>${t.type_name}</td><td>${t.status === 'UNUSED' ? 'Chưa quét' : t.status === 'EXPIRED' ? 'Hết hạn' : 'Đã quét'}</td><td style="text-align:right">${fmt(t.price_paid)}</td><td>${t.sold_by_name}</td><td>${fmtDateTime(t.sold_at)}</td></tr>`).join('')}
            <tr class="total-row"><td colspan="4">TỔNG CỘNG (${filteredTickets.length} vé)</td><td style="text-align:right">${fmt(filteredTickets.reduce((s, t) => s + t.price_paid, 0))}</td><td></td><td></td></tr></tbody></table>`;

        return (
            <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '16px', marginBottom: '16px' }}>
                    {renderDateFilter()}
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)' }}>Trạng thái:</span>
                        <select className="input" style={{ width: '140px', padding: '6px 12px', fontSize: '13px' }} value={dailyPassFilter} onChange={(e: any) => setDailyPassFilter(e.target.value)}>
                            <option value="ALL">Tất cả vé</option>
                            <option value="UNUSED">Chưa quét cổng</option>
                            <option value="VERIFIED">Đã quét cổng</option>
                            <option value="EXPIRED">Hết hạn (Qua ngày)</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '140px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#3b82f6' }}>{totalSold}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Tổng vé bán ra</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '140px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>{totalUsed}</div>
                        <div style={{ fontSize: '12px', color: '#047857' }}>Khách đã vào cổng</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '140px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#ef4444' }}>{totalUnused}</div>
                        <div style={{ fontSize: '12px', color: '#b91c1c' }}>Khách chưa đến</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '140px', background: 'rgba(100, 116, 139, 0.1)', border: '1px solid rgba(100, 116, 139, 0.2)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#64748b' }}>{totalExpired}</div>
                        <div style={{ fontSize: '12px', color: '#475569' }}>Vé hết hạn</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => handlePrintReport(`Danh sách Vé Lẻ (${dailyPassFilter === 'ALL' ? 'Tất cả' : dailyPassFilter === 'UNUSED' ? 'Chưa quét' : 'Đã quét'}) — ${from} → ${to}`, tableHtml)}>🖨️ In A4</button>
                    <button className="btn btn-secondary" onClick={() => exportExcel(`ve_le_${from}_${to}`, ['STT', 'Mã vé', 'Loại vé', 'Trạng thái', 'H/T Thanh toán', 'Giá bán', 'Người bán', 'Thời gian'],
                        filteredTickets.map((t, i) => [
                            String(i + 1), t.id.substring(0, 8).toUpperCase(), t.type_name,
                            t.status === 'UNUSED' ? 'Chưa quét' : t.status === 'EXPIRED' ? 'Hết hạn' : 'Đã quét',
                            t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS',
                            String(t.price_paid), t.sold_by_name || '', fmtDateTime(t.sold_at)
                        ])
                    )}>📊 Xuất Excel</button>
                </div>

                <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                <th style={thS}>#</th><th style={thS}>Mã vé</th><th style={thS}>Loại vé</th><th style={thS}>Trạng thái</th><th style={thS}>Thanh toán</th><th style={thS}>Giá bán</th><th style={thS}>Người bán</th><th style={thS}>Giờ bán</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredTickets.length === 0 ? (
                                <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có khách ở mục này.</td></tr>
                            ) : filteredTickets.map((t, i) => (
                                <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                    <td style={tdS}>{i + 1}</td>
                                    <td style={tdS}><code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{t.id.substring(0, 8).toUpperCase()}</code></td>
                                    <td style={tdS}>{t.type_name}</td>
                                    <td style={tdS}>
                                        <span style={{
                                            background: t.status === 'UNUSED' ? 'rgba(239, 68, 68, 0.1)' : t.status === 'EXPIRED' ? '#f1f5f9' : 'rgba(16, 185, 129, 0.1)',
                                            color: t.status === 'UNUSED' ? '#ef4444' : t.status === 'EXPIRED' ? '#64748b' : '#10b981',
                                            padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600
                                        }}>
                                            {t.status === 'UNUSED' ? '🔴 Chưa dùng' : t.status === 'EXPIRED' ? '⚫ Hết hạn' : '🟢 Đã quét cổng'}
                                        </span>
                                    </td>
                                    <td style={tdS}>{t.payment_method === 'CASH' ? '💵 TM' : t.payment_method === 'TRANSFER' ? '🏦 CK' : '💳 POS'}</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                    <td style={tdS}>{t.sold_by_name}</td>
                                    <td style={tdS}>{fmtDateTime(t.sold_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </>
        );
    }

    function renderMySalesTab() {
        const { from, to } = getDateBounds();
        // Lọc bỏ mọi thứ không phải là MONTHLY và MULTI (Tức là chỉ hiển thị Vé nhiều buổi hoặc Vé tháng đã bán)
        const mySalesTickets = tickets.filter(t => t.category === 'MONTHLY' || t.category === 'MULTI');

        const myRevenue = mySalesTickets.reduce((s, t) => s + t.price_paid, 0);
        const myCash = mySalesTickets.filter(t => t.payment_method === 'CASH').reduce((s, t) => s + t.price_paid, 0);
        const myTransfer = mySalesTickets.filter(t => t.payment_method === 'TRANSFER').reduce((s, t) => s + t.price_paid, 0);
        const myCard = mySalesTickets.filter(t => t.payment_method === 'CARD').reduce((s, t) => s + t.price_paid, 0);

        const tableHtml = `
            <div style="display:flex; justify-content:space-around; margin-bottom: 20px; font-weight: bold; background: #f8fafc; padding: 10px; border: 1px solid #ddd; border-radius: 8px;">
                <span>Tổng Gói: ${mySalesTickets.length}</span>
                <span style="color:#10b981">Tổng Thu: ${fmt(myRevenue)}</span>
                <span style="color:#64748b">Tiền mặt: ${fmt(myCash)}</span>
                <span style="color:#f59e0b">Chuyển khoản: ${fmt(myTransfer)}</span>
                <span style="color:#8b5cf6">Quẹt thẻ: ${fmt(myCard)}</span>
            </div>
            <table><thead><tr><th>STT</th><th>Loại vé</th><th>Khách hàng</th><th>Mã thẻ</th><th>H/T Thanh toán</th><th>Giá bán</th><th>Thời gian</th></tr></thead><tbody>
            ${mySalesTickets.map((t, i) => {
            const paymentStr = t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS';
            return `<tr><td>${i + 1}</td><td>${t.type_name}</td><td>${t.customer_name || 'Khách lẻ'}</td><td>${t.card_code || ''}</td><td>${paymentStr}</td><td style="text-align:right">${fmt(t.price_paid)}</td><td>${fmtDateTime(t.sold_at)}</td></tr>`;
        }).join('')}
            <tr class="total-row"><td colspan="5">TỔNG CỘNG (${mySalesTickets.length} vé)</td><td style="text-align:right">${fmt(myRevenue)}</td><td></td></tr></tbody></table>`;

        return (
            <>
                {renderDateFilter()}
                <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                    <div style={{ flex: 1, minWidth: '140px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#10b981' }}>{fmt(myRevenue)}</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Doanh thu của tôi</div>
                    </div>
                    <div style={{ flex: 1, minWidth: '140px', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', padding: '14px 16px' }}>
                        <div style={{ fontSize: '22px', fontWeight: 700, color: '#3b82f6' }}>{mySalesTickets.length} vé</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Số vé đã bán</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <button className="btn btn-secondary" onClick={() => handlePrintReport(`Báo cáo Vé Dài Hạn Đã Bán (${profile?.full_name}) — ${from} → ${to}`, tableHtml)}>🖨️ In A4</button>
                    <button className="btn btn-secondary" onClick={() => exportExcel(`ve_dai_han_da_ban_${from}_${to}`, ['STT', 'Loại vé', 'Khách hàng', 'Mã thẻ', 'H/T Thanh toán', 'Giá bán', 'Thời gian'],
                        mySalesTickets.map((t, i) => [
                            String(i + 1), t.type_name, t.customer_name || 'Khách lẻ', t.card_code || '',
                            t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS',
                            String(t.price_paid), fmtDateTime(t.sold_at)
                        ])
                    )}>📊 Xuất Excel</button>
                </div>
                {renderTicketTable(mySalesTickets)}
            </>
        );
    }

    function renderTicketTable(data: TicketRow[]) {
        return (
            <div style={{ overflowX: 'auto' }}>
                <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={thS}>#</th><th style={thS}>Loại vé</th><th style={thS}>Khách</th><th style={thS}>Mã thẻ</th><th style={thS}>Thanh toán</th><th style={thS}>Giá bán</th><th style={thS}>Người bán</th><th style={thS}>Thời gian</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.length === 0 ? (
                            <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có dữ liệu.</td></tr>
                        ) : data.map((t, i) => (
                            <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                <td style={tdS}>{i + 1}</td>
                                <td style={tdS}>
                                    <span style={{ background: t.category === 'DAILY' ? '#dcfce7' : t.category === 'MONTHLY' ? '#dbeafe' : '#fef3c7', color: t.category === 'DAILY' ? '#166534' : t.category === 'MONTHLY' ? '#1d4ed8' : '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                                        {t.type_name}
                                    </span>
                                </td>
                                <td style={tdS}>{t.customer_name || 'Khách lẻ'}</td>
                                <td style={tdS}>{t.card_code ? <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{t.card_code}</code> : '—'}</td>
                                <td style={tdS}>{t.payment_method === 'CASH' ? '💵 TM' : t.payment_method === 'TRANSFER' ? '🏦 CK' : '💳 POS'}</td>
                                <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                <td style={tdS}>{t.sold_by_name}</td>
                                <td style={tdS}>{fmtDateTime(t.sold_at)}</td>
                            </tr>
                        ))}
                        {data.length > 0 && (
                            <tr style={{ background: 'var(--bg-hover)', fontWeight: 700 }}>
                                <td colSpan={4} style={{ ...tdS, textAlign: 'right' }}>TỔNG CỘNG ({data.length} vé)</td>
                                <td></td>
                                <td style={{ ...tdS, textAlign: 'right', color: '#10b981', fontSize: '15px' }}>{fmt(data.reduce((s, t) => s + t.price_paid, 0))}</td>
                                <td colSpan={2} style={tdS}></td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        );
    }

    // --- LESSON PACKAGES TAB ---
    function renderLessonPackagesTab() {
        const lessonTickets = tickets.filter(t => t.category === 'LESSON');

        function getLessonStatus(t: TicketRow): { label: string; color: string; bg: string } {
            if (t.status === 'EXPIRED' || (t.remaining_sessions !== null && t.remaining_sessions <= 0))
                return { label: 'Hoàn thành', color: '#64748b', bg: '#f1f5f9' };
            if (t.valid_until && new Date(t.valid_until) < new Date())
                return { label: 'Hết hạn', color: '#dc2626', bg: '#fef2f2' };
            if (!t.valid_from)
                return { label: 'Chưa KH', color: '#f59e0b', bg: '#fffbeb' };
            return { label: 'Đang học', color: '#10b981', bg: '#ecfdf5' };
        }

        const classLabel = (ct: string | null) => ct === 'GROUP' ? '👥 Nhóm' : ct === 'ONE_ON_ONE' ? '🧑‍🏫 1:1' : ct === 'ONE_ON_TWO' ? '🧑‍🏫 1:2' : '—';

        const tableRef = `<table id="lesson-table"><thead><tr><th>#</th><th>Khách hàng</th><th>SĐT</th><th>Mã thẻ</th><th>Gói</th><th>Loại lớp</th><th>Buổi còn</th><th>Hiệu lực</th><th>Giá</th><th>Trạng thái</th><th>Ngày ĐK</th></tr></thead><tbody>${lessonTickets.map((t, i) => { const st = getLessonStatus(t); return `<tr><td>${i + 1}</td><td>${t.customer_name || 'N/A'}</td><td>${t.customer_phone || ''}</td><td>${t.card_code || ''}</td><td>${t.type_name}</td><td>${t.lesson_class_type === 'GROUP' ? 'Nhóm' : t.lesson_class_type === 'ONE_ON_ONE' ? '1:1' : '1:2'}</td><td>${t.remaining_sessions ?? ''}/${t.total_sessions ?? ''}</td><td>${t.valid_from ? fmtDate(t.valid_from) + ' → ' + fmtDate(t.valid_until) : 'Chưa KH'}</td><td>${fmt(t.price_paid)}</td><td>${st.label}</td><td>${fmtDateTime(t.sold_at)}</td></tr>`; }).join('')}</tbody></table>`;

        return (
            <div style={{ animation: 'fadeIn 0.3s ease' }}>
                {renderDateFilter()}
                <div className="dashboard-content-card" style={{ marginTop: '16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                        <h2 style={{ margin: 0, fontSize: '16px' }}>📚 Gói Khóa Học Bơi ({lessonTickets.length} gói)</h2>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-ghost btn-sm" onClick={() => handlePrintReport('📚 Gói Khóa Học Bơi', tableRef)}>🖨️ In A4</button>
                            <button className="btn btn-ghost btn-sm" onClick={() => exportExcel(
                                'goi_hoc_boi',
                                ['#', 'Khách', 'SĐT', 'Mã thẻ', 'Gói', 'Loại lớp', 'Buổi còn', 'Hiệu lực', 'Giá', 'Trạng thái', 'Ngày ĐK'],
                                lessonTickets.map((t, i) => {
                                    const st = getLessonStatus(t);
                                    return [
                                        String(i + 1), t.customer_name || '', t.customer_phone || '', t.card_code || '',
                                        t.type_name, classLabel(t.lesson_class_type),
                                        `${t.remaining_sessions ?? ''}/${t.total_sessions ?? ''}`,
                                        t.valid_from ? `${fmtDate(t.valid_from)} → ${fmtDate(t.valid_until)}` : 'Chưa KH',
                                        fmt(t.price_paid), st.label, fmtDateTime(t.sold_at)
                                    ];
                                })
                            )}>📥 Excel</button>
                        </div>
                    </div>

                    <div style={{ overflowX: 'auto' }}>
                        <table className="data-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={thS}>#</th>
                                    <th style={thS}>Khách hàng</th>
                                    <th style={thS}>SĐT</th>
                                    <th style={thS}>Mã thẻ</th>
                                    <th style={thS}>Gói</th>
                                    <th style={thS}>Loại lớp</th>
                                    <th style={thS}>Buổi</th>
                                    <th style={thS}>Hiệu lực</th>
                                    <th style={thS}>Giá</th>
                                    <th style={thS}>Trạng thái</th>
                                    <th style={thS}>Ngày ĐK</th>
                                </tr>
                            </thead>
                            <tbody>
                                {lessonTickets.length === 0 ? (
                                    <tr><td colSpan={11} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Chưa có gói khóa học nào trong khoảng thời gian này.</td></tr>
                                ) : lessonTickets.map((t, i) => {
                                    const st = getLessonStatus(t);
                                    return (
                                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                                            <td style={tdS}>{i + 1}</td>
                                            <td style={tdS}><strong>{t.customer_name || 'N/A'}</strong></td>
                                            <td style={tdS}>{t.customer_phone || '—'}</td>
                                            <td style={tdS}>{t.card_code ? <code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{t.card_code}</code> : '—'}</td>
                                            <td style={tdS}>{t.type_name}</td>
                                            <td style={tdS}><span style={{ fontSize: '12px' }}>{classLabel(t.lesson_class_type)}</span></td>
                                            <td style={tdS}>
                                                <span style={{ fontWeight: 600 }}>{t.remaining_sessions ?? '—'}</span>
                                                <span style={{ color: '#94a3b8' }}> / {t.total_sessions ?? '—'}</span>
                                            </td>
                                            <td style={tdS}>
                                                {t.valid_from ? `${fmtDate(t.valid_from)} → ${fmtDate(t.valid_until)}` : <span style={{ color: '#f59e0b', fontWeight: 500 }}>Chưa kích hoạt</span>}
                                            </td>
                                            <td style={{ ...tdS, textAlign: 'right', fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                            <td style={tdS}>
                                                <span style={{ background: st.bg, color: st.color, padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>
                                                    {st.label}
                                                </span>
                                            </td>
                                            <td style={tdS}>{fmtDateTime(t.sold_at)}</td>
                                        </tr>
                                    );
                                })}
                                {lessonTickets.length > 0 && (
                                    <tr style={{ background: 'var(--bg-hover)', fontWeight: 700 }}>
                                        <td colSpan={8} style={{ ...tdS, textAlign: 'right' }}>TỔNG CỘNG ({lessonTickets.length} gói)</td>
                                        <td style={{ ...tdS, textAlign: 'right', color: '#10b981', fontSize: '15px' }}>{fmt(lessonTickets.reduce((s, t) => s + t.price_paid, 0))}</td>
                                        <td colSpan={2} style={tdS}></td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    const tabs: { key: ReportTab; label: string; icon: string; adminOnly?: boolean }[] = [
        { key: 'REVENUE', label: 'Doanh thu', icon: '💰' },
        { key: 'SESSIONS', label: 'Lượt khách (Scan)', icon: '🏊', adminOnly: true },
        { key: 'DAILY_PASSES', label: 'Vé lẻ hôm nay', icon: '�️', adminOnly: true },
        { key: 'LESSON_PACKAGES', label: 'Gói Học Bơi', icon: '📚', adminOnly: true },
        { key: 'WARNINGS', label: 'Cảnh báo', icon: '⚠️', adminOnly: true },
        { key: 'MY_SALES', label: 'Vé Dài Hạn Đã Bán', icon: '🛒' },
    ];

    return (
        <div className="page-container">
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h1>📈 Báo Cáo</h1>
                    <p>Xem doanh thu, danh sách vé và cảnh báo</p>
                </div>
                <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '12px', flexWrap: 'wrap' }}>
                    {tabs.filter(t => !t.adminOnly || isAdmin).map(t => (
                        <button key={t.key}
                            className={`btn ${activeTab === t.key ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ border: 'none', margin: 0, padding: '8px 14px', fontSize: '13px' }}
                            onClick={() => setActiveTab(t.key)}>
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>
            </div>

            {loading && <div style={{ textAlign: 'center', padding: '20px', color: 'var(--text-secondary)' }}>Đang tải dữ liệu...</div>}

            {!loading && activeTab === 'REVENUE' && renderRevenueTab()}
            {!loading && activeTab === 'SESSIONS' && renderSessionsTab()}
            {!loading && activeTab === 'DAILY_PASSES' && renderDailyPassesTab()}
            {!loading && activeTab === 'LESSON_PACKAGES' && renderLessonPackagesTab()}
            {!loading && activeTab === 'WARNINGS' && renderWarningsTab()}
            {!loading && activeTab === 'MY_SALES' && renderMySalesTab()}
        </div>
    );
}

const thS: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap' };
const tdS: React.CSSProperties = { padding: '8px 10px', fontSize: '13px', whiteSpace: 'nowrap' };
const dateInputStyle: React.CSSProperties = { padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', fontSize: '13px' };
