import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

type SubTab = 'CUSTOMERS' | 'PACKAGES';
type DateRange = 'TODAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';

interface PackageRow {
    id: string;
    package_code: string | null;
    type_name: string;
    category: string;
    customer_name: string | null;
    customer_phone: string | null;
    card_code: string | null;
    status: string;
    valid_from: string | null;
    valid_until: string | null;
    remaining_sessions: number | null;
    total_sessions: number | null;
    price_paid: number;
    sold_at: string;
    sold_by_name: string | null;
    // Promotion & original info
    original_price: number;
    original_sessions: number | null;
    promo_name: string | null;
    promo_type: string | null;
    promo_value: number | null;
}

interface CustomerSummary {
    phone: string;
    name: string;
    registeredAt: string;
    overallStatus: string;
    activePackages: number;
    totalPackages: number;
    packages: PackageRow[];
}

export default function CustomerPage() {
    const { profile } = useAuth();
    const isAdmin = profile?.role === 'ADMIN';

    const [subTab, setSubTab] = useState<SubTab>('CUSTOMERS');
    const [allPackages, setAllPackages] = useState<PackageRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Date filter for Packages tab
    const [dateRange, setDateRange] = useState<DateRange>('THIS_MONTH');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    // Expanded customer / detail modal
    const [expandedPhone, setExpandedPhone] = useState<string | null>(null);
    const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);

    // Card code editing
    const [editingCardPkgId, setEditingCardPkgId] = useState<string | null>(null);
    const [newCardCode, setNewCardCode] = useState('');

    useEffect(() => { fetchAllPackages(); }, []);

    async function fetchAllPackages() {
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                id, customer_name, customer_phone, card_code, status,
                valid_from, valid_until, remaining_sessions, total_sessions,
                price_paid, sold_at, package_code,
                ticket_types!inner (name, category, price, session_count),
                profiles:sold_by (full_name),
                promotions:promotion_id (name, type, value)
            `)
            .in('ticket_types.category', ['MONTHLY', 'MULTI'])
            .order('sold_at', { ascending: false });

        if (error) { console.error(error); setLoading(false); return; }

        const mapped: PackageRow[] = (data || []).map((t: any) => ({
            id: t.id,
            package_code: t.package_code,
            type_name: t.ticket_types?.name || '',
            category: t.ticket_types?.category || '',
            customer_name: t.customer_name,
            customer_phone: t.customer_phone,
            card_code: t.card_code,
            status: computeStatus(t),
            valid_from: t.valid_from,
            valid_until: t.valid_until,
            remaining_sessions: t.remaining_sessions,
            total_sessions: t.total_sessions,
            price_paid: t.price_paid,
            sold_at: t.sold_at,
            sold_by_name: t.profiles?.full_name || '—',
            original_price: t.ticket_types?.price || t.price_paid,
            original_sessions: t.ticket_types?.session_count || null,
            promo_name: t.promotions?.name || null,
            promo_type: t.promotions?.type || null,
            promo_value: t.promotions?.value || null,
        }));

        setAllPackages(mapped);
        setLoading(false);
    }

    function computeStatus(t: any): string {
        if (t.status === 'EXPIRED') return 'EXPIRED';
        const today = new Date().toLocaleDateString('en-CA');
        if (t.valid_until && t.valid_until < today) return 'EXPIRED';
        if (t.remaining_sessions !== null && t.remaining_sessions <= 0) return 'EXPIRED';
        if (t.valid_until) {
            const daysLeft = (new Date(t.valid_until).getTime() - Date.now()) / 86400000;
            if (daysLeft <= 7 && daysLeft > 0) return 'EXPIRING';
        }
        if (t.remaining_sessions !== null && t.remaining_sessions <= 3 && t.remaining_sessions > 0) return 'EXPIRING';
        if (t.remaining_sessions !== null && t.total_sessions !== null && t.remaining_sessions < t.total_sessions) return 'IN_USE';
        if (t.status === 'IN' || t.status === 'OUT') return 'IN_USE';
        return 'UNUSED';
    }

    // --- Build customer summaries ---
    function buildCustomerList(): CustomerSummary[] {
        const map = new Map<string, { name: string; packages: PackageRow[] }>();
        allPackages.forEach(p => {
            const key = p.customer_phone || p.id;
            if (!map.has(key)) map.set(key, { name: p.customer_name || '—', packages: [] });
            map.get(key)!.packages.push(p);
        });

        const result: CustomerSummary[] = [];
        map.forEach((val, phone) => {
            const sorted = [...val.packages].sort((a, b) => a.sold_at.localeCompare(b.sold_at));
            const registeredAt = sorted[0]?.sold_at || '';
            const activeOrExpiring = val.packages.filter(p => p.status === 'IN_USE' || p.status === 'UNUSED' || p.status === 'EXPIRING');
            let overallStatus = 'EXPIRED';
            if (activeOrExpiring.some(p => p.status === 'IN_USE' || p.status === 'UNUSED')) overallStatus = 'ACTIVE';
            else if (activeOrExpiring.some(p => p.status === 'EXPIRING')) overallStatus = 'EXPIRING';

            result.push({
                phone: phone.length > 20 ? '—' : phone,
                name: val.name,
                registeredAt,
                overallStatus,
                activePackages: activeOrExpiring.length,
                totalPackages: val.packages.length,
                packages: val.packages,
            });
        });
        return result;
    }

    // --- Date filter ---
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

    function filterPackagesByDate(pkgs: PackageRow[]): PackageRow[] {
        const { from, to } = getDateBounds();
        return pkgs.filter(p => { const d = p.sold_at.substring(0, 10); return d >= from && d <= to; });
    }

    // --- Card code update ---
    async function handleUpdateCardCode(pkgId: string) {
        if (!newCardCode.trim()) { alert('Vui lòng nhập mã thẻ mới!'); return; }
        if (!confirm('Bạn có chắc chắn muốn thay đổi mã thẻ cho khách hàng này?')) return;

        // Update all packages with the same old card_code
        const pkg = allPackages.find(p => p.id === pkgId);
        if (!pkg) return;
        const oldCode = pkg.card_code;

        if (oldCode) {
            await supabase.from('tickets').update({ card_code: newCardCode.trim() }).eq('card_code', oldCode);
        } else {
            await supabase.from('tickets').update({ card_code: newCardCode.trim() }).eq('id', pkgId);
        }

        setEditingCardPkgId(null);
        setNewCardCode('');
        fetchAllPackages();
        alert('✅ Đã cập nhật mã thẻ thành công!');
    }

    // --- Helpers ---
    const fmt = (n: number) => new Intl.NumberFormat('vi-VN').format(n) + 'đ';
    const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('vi-VN') : '—';

    function getStatusBadge(status: string) {
        switch (status) {
            case 'IN_USE': case 'ACTIVE': return { text: 'Đang sử dụng', bg: '#dcfce7', color: '#166534' };
            case 'EXPIRING': return { text: 'Sắp hết hạn', bg: '#fef3c7', color: '#92400e' };
            case 'EXPIRED': return { text: 'Hết hạn', bg: '#fee2e2', color: '#991b1b' };
            default: return { text: 'Chưa sử dụng', bg: '#dbeafe', color: '#1d4ed8' };
        }
    }

    if (loading) return <div className="page-loading">Đang tải...</div>;

    const customers = buildCustomerList();
    const filteredCustomers = customers.filter(c =>
        !searchTerm || c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.phone.includes(searchTerm)
    );
    const filteredPackages = filterPackagesByDate(allPackages).filter(p =>
        !searchTerm ||
        (p.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.customer_phone || '').includes(searchTerm) ||
        (p.card_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.package_code || '').toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <div className="page-container" style={{ maxWidth: '1100px' }}>
            {/* Header with sub-tabs */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ fontSize: '24px', fontWeight: 700 }}>👥 Khách Hàng</h1>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Quản lý khách hàng và các gói thẻ bơi</p>
                </div>
                <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '10px' }}>
                    {([['CUSTOMERS', '👤 Khách hàng'], ['PACKAGES', '📦 Gói thẻ']] as [SubTab, string][]).map(([key, label]) => (
                        <button key={key} className={`btn ${subTab === key ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ padding: '8px 16px', fontSize: '13px', margin: 0 }}
                            onClick={() => { setSubTab(key); setSearchTerm(''); setExpandedPhone(null); }}>
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Search */}
            <input type="text" placeholder={subTab === 'CUSTOMERS' ? '🔍 Tìm theo tên, SĐT...' : '🔍 Tìm theo tên, SĐT, mã thẻ, mã gói...'}
                value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-card)', marginBottom: '16px' }}
            />

            {/* ====================== TAB: CUSTOMERS ====================== */}
            {subTab === 'CUSTOMERS' && (
                <>
                    {/* Stats */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        {[
                            { label: 'Tổng khách hàng', value: String(filteredCustomers.length), color: '#3b82f6' },
                            { label: 'Đang hoạt động', value: String(filteredCustomers.filter(c => c.overallStatus === 'ACTIVE').length), color: '#10b981' },
                            { label: 'Sắp hết hạn', value: String(filteredCustomers.filter(c => c.overallStatus === 'EXPIRING').length), color: '#f59e0b' },
                        ].map(k => (
                            <div key={k.label} style={{ flex: 1, minWidth: '130px', background: 'var(--bg-card)', padding: '14px 18px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.value}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{k.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Customer List */}
                    {filteredCustomers.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Chưa có khách hàng.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {filteredCustomers.map((c, i) => {
                                const st = getStatusBadge(c.overallStatus);
                                const isExpanded = expandedPhone === c.phone;
                                return (
                                    <div key={c.phone + i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                                        {/* Customer Row — clickable */}
                                        <div onClick={() => setExpandedPhone(isExpanded ? null : c.phone)}
                                            style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                                                    {(c.name || '?')[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{c.name}</div>
                                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>📞 {c.phone} · Đăng ký: {fmtDate(c.registeredAt)}</div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <span style={{ background: st.bg, color: st.color, padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600 }}>{st.text}</span>
                                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{c.totalPackages} gói</span>
                                                <span style={{ fontSize: '16px', color: 'var(--text-muted)', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : '' }}>▼</span>
                                            </div>
                                        </div>

                                        {/* Expanded: Customer packages */}
                                        {isExpanded && (
                                            <div style={{ borderTop: '1px solid var(--border-color)', padding: '16px 18px', background: 'var(--bg-hover)', animation: 'fadeIn 0.2s ease' }}>
                                                {/* Customer Info */}
                                                <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap' }}>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Họ tên:</span> <strong>{c.name}</strong></div>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>SĐT:</span> <strong>{c.phone}</strong></div>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Gói đang dùng:</span> <strong>{c.activePackages}</strong></div>
                                                </div>

                                                {/* Package list */}
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>📦 Danh sách gói thẻ ({c.totalPackages})</div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    {c.packages.map(p => {
                                                        const pst = getStatusBadge(p.status);
                                                        return (
                                                            <div key={p.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '200px' }}>
                                                                    <span style={{ background: p.category === 'MONTHLY' ? '#dbeafe' : '#fef3c7', color: p.category === 'MONTHLY' ? '#1d4ed8' : '#92400e', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{p.type_name}</span>
                                                                    <span style={{ background: pst.bg, color: pst.color, padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{pst.text}</span>
                                                                    {p.remaining_sessions !== null && (
                                                                        <span style={{ fontWeight: 700, fontSize: '13px', color: p.remaining_sessions <= 3 ? '#ef4444' : '' }}>
                                                                            {p.remaining_sessions}/{p.total_sessions ?? p.remaining_sessions} lượt
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                    <span>{fmtDate(p.valid_from)} → {fmtDate(p.valid_until)}</span>
                                                                    <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(p.price_paid)}</span>
                                                                    <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '11px' }} onClick={(e) => { e.stopPropagation(); setSelectedPkg(p); }}>Chi tiết</button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>

                                                {/* Edit card code — ADMIN only */}
                                                {isAdmin && (
                                                    <div style={{ marginTop: '14px', paddingTop: '14px', borderTop: '1px dashed var(--border-color)' }}>
                                                        {editingCardPkgId && c.packages.some(p => p.id === editingCardPkgId) ? (
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Mã thẻ mới:</span>
                                                                <input type="text" value={newCardCode} onChange={e => setNewCardCode(e.target.value)}
                                                                    placeholder="Quét hoặc nhập mã thẻ mới" autoFocus
                                                                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '14px', fontWeight: 700, flex: 1 }} />
                                                                <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={() => handleUpdateCardCode(editingCardPkgId)}>Lưu</button>
                                                                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={() => { setEditingCardPkgId(null); setNewCardCode(''); }}>Hủy</button>
                                                            </div>
                                                        ) : (
                                                            <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }}
                                                                onClick={() => { setEditingCardPkgId(c.packages[0]?.id || null); setNewCardCode(c.packages[0]?.card_code || ''); }}>
                                                                ✏️ Đổi mã thẻ (mất thẻ)
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}

            {/* ====================== TAB: PACKAGES ====================== */}
            {subTab === 'PACKAGES' && (
                <>
                    {/* Date Filter */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {(['THIS_MONTH', 'LAST_MONTH', 'TODAY', 'CUSTOM'] as DateRange[]).map(r => (
                            <button key={r} className={`btn ${dateRange === r ? 'btn-primary' : 'btn-ghost'}`}
                                style={{ padding: '6px 14px', fontSize: '13px' }}
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

                    {/* Stats */}
                    <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap' }}>
                        {[
                            { label: 'Tổng gói', value: String(filteredPackages.length), color: '#8b5cf6' },
                            { label: 'Đang dùng', value: String(filteredPackages.filter(p => p.status === 'IN_USE' || p.status === 'UNUSED').length), color: '#10b981' },
                            { label: 'Doanh thu', value: fmt(filteredPackages.reduce((s, p) => s + p.price_paid, 0)), color: '#3b82f6' },
                        ].map(k => (
                            <div key={k.label} style={{ flex: 1, minWidth: '130px', background: 'var(--bg-card)', padding: '14px 18px', borderRadius: '12px', border: '1px solid var(--border-color)' }}>
                                <div style={{ fontSize: '22px', fontWeight: 700, color: k.color }}>{k.value}</div>
                                <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{k.label}</div>
                            </div>
                        ))}
                    </div>

                    {/* Package Table */}
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', background: 'var(--bg-card)', borderRadius: '12px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                            <thead>
                                <tr>
                                    <th style={thS}>Mã gói</th>
                                    <th style={thS}>Khách hàng</th>
                                    <th style={thS}>SĐT</th>
                                    {isAdmin && <th style={thS}>Mã thẻ</th>}
                                    <th style={thS}>Loại</th>
                                    <th style={thS}>Trạng thái</th>
                                    <th style={thS}>Lượt còn</th>
                                    <th style={thS}>Hiệu lực</th>
                                    <th style={thS}>Giá</th>
                                    <th style={thS}>Ngày mua</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPackages.length === 0 ? (
                                    <tr><td colSpan={isAdmin ? 10 : 9} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có gói thẻ nào trong khoảng thời gian này.</td></tr>
                                ) : filteredPackages.map(t => {
                                    const pst = getStatusBadge(t.status);
                                    return (
                                        <tr key={t.id} onClick={() => setSelectedPkg(t)}
                                            style={{ borderBottom: '1px solid var(--border-color)', cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '11px', color: 'var(--text-muted)' }}>{t.package_code || '—'}</td>
                                            <td style={{ ...tdS, fontWeight: 600 }}>{t.customer_name || '—'}</td>
                                            <td style={tdS}>{t.customer_phone || '—'}</td>
                                            {isAdmin && <td style={tdS}><code style={{ background: 'var(--bg-hover)', padding: '2px 6px', borderRadius: '4px', fontSize: '12px' }}>{t.card_code || '—'}</code></td>}
                                            <td style={tdS}>
                                                <span style={{ background: t.category === 'MONTHLY' ? '#dbeafe' : '#fef3c7', color: t.category === 'MONTHLY' ? '#1d4ed8' : '#92400e', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{t.type_name}</span>
                                            </td>
                                            <td style={tdS}>
                                                <span style={{ background: pst.bg, color: pst.color, padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{pst.text}</span>
                                            </td>
                                            <td style={{ ...tdS, textAlign: 'center', fontWeight: 700, color: (t.remaining_sessions !== null && t.remaining_sessions <= 3) ? '#ef4444' : '' }}>
                                                {t.remaining_sessions !== null ? `${t.remaining_sessions}/${t.total_sessions ?? t.remaining_sessions}` : '∞'}
                                            </td>
                                            <td style={tdS}>{fmtDate(t.valid_from)} → {fmtDate(t.valid_until)}</td>
                                            <td style={{ ...tdS, fontWeight: 600 }}>{fmt(t.price_paid)}</td>
                                            <td style={tdS}>{fmtDate(t.sold_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* Detail Modal */}
            {selectedPkg && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => setSelectedPkg(null)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '28px', maxWidth: '440px', width: '90%', boxShadow: 'var(--shadow-lg)', maxHeight: '85vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>📋 Chi tiết Gói Bơi</h2>
                            <button onClick={() => setSelectedPkg(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                { label: 'Mã gói', value: selectedPkg.package_code || '—' },
                                { label: 'Họ tên', value: selectedPkg.customer_name || '—' },
                                { label: 'Số điện thoại', value: selectedPkg.customer_phone || '—' },
                                ...(isAdmin ? [{ label: 'Mã thẻ', value: selectedPkg.card_code || '—' }] : []),
                                { label: 'Loại thẻ', value: selectedPkg.type_name },
                                { label: 'Trạng thái', value: getStatusBadge(selectedPkg.status).text },
                                { label: 'Lượt bơi', value: selectedPkg.remaining_sessions !== null ? `${selectedPkg.remaining_sessions} / ${selectedPkg.total_sessions ?? selectedPkg.remaining_sessions} lượt` : 'Không giới hạn' },
                                { label: 'Hiệu lực', value: `${fmtDate(selectedPkg.valid_from)} → ${fmtDate(selectedPkg.valid_until)}` },
                                { label: 'Giá bán', value: fmt(selectedPkg.price_paid) },
                                { label: 'Ngày mua', value: fmtDate(selectedPkg.sold_at) },
                                { label: 'Người bán', value: selectedPkg.sold_by_name || '—' },
                            ].map(row => (
                                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                                    <strong>{row.value}</strong>
                                </div>
                            ))}
                        </div>

                        {/* Promotion breakdown */}
                        <div style={{ marginTop: '16px', padding: '14px', borderRadius: '10px', background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: '#475569' }}>🎁 Thông tin gói & KM</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: '#64748b' }}>Gói gốc</span>
                                    <span>{selectedPkg.type_name} — {fmt(selectedPkg.original_price)}{selectedPkg.original_sessions ? ` (${selectedPkg.original_sessions} lượt)` : ''}</span>
                                </div>
                                {selectedPkg.promo_name ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: '#64748b' }}>Khuyến mãi</span>
                                            <span style={{ color: '#059669', fontWeight: 600 }}>
                                                🎉 {selectedPkg.promo_name}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: '#64748b' }}>Ưu đãi</span>
                                            <span style={{ color: '#059669', fontWeight: 700 }}>
                                                {selectedPkg.promo_type === 'AMOUNT' && `−${fmt(selectedPkg.promo_value!)}`}
                                                {selectedPkg.promo_type === 'PERCENT' && `−${selectedPkg.promo_value}%`}
                                                {selectedPkg.promo_type === 'BONUS_SESSION' && `+${selectedPkg.promo_value} lượt`}
                                            </span>
                                        </div>
                                        <div style={{ borderTop: '1px dashed #cbd5e1', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                            <span>Sau KM</span>
                                            <span>
                                                {fmt(selectedPkg.price_paid)}
                                                {selectedPkg.total_sessions !== null && ` (${selectedPkg.total_sessions} lượt)`}
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ color: '#94a3b8', fontStyle: 'italic' }}>Không áp dụng khuyến mãi</div>
                                )}
                            </div>
                        </div>

                        <button className="btn btn-primary" style={{ width: '100%', marginTop: '20px' }} onClick={() => setSelectedPkg(null)}>Đóng</button>
                    </div>
                </div>
            )}
        </div>
    );
}

const thS: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap' };
const tdS: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', whiteSpace: 'nowrap' };
