/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/immutability, react-hooks/exhaustive-deps */
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeScannerInput } from '../utils/scannerUtils';
import type { Customer } from '../types';
import * as XLSX from 'xlsx';
import PrintTicketModal, { type PrintTicketData } from '../components/PrintTicketModal';

// Helper to parse dates from Excel (DD/MM/YYYY or YYYY-MM-DD or Excel serial)
function parseDateDDMMYYYY(val: any): string {
    if (!val) return '';
    if (typeof val === 'number') {
        const date = new Date(Math.round((val - 25569) * 86400 * 1000));
        return date.toISOString().split('T')[0];
    }
    const str = String(val).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    const parts = str.split(/[/.-]/);
    if (parts.length === 3) {
        const d = parts[0], m = parts[1]; let y = parts[2];
        if (d.length === 4) return `${d}-${m.padStart(2, '0')}-${y.padStart(2, '0')}`;
        if (y.length === 2) y = '20' + y;
        return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    return str;
}

type SubTab = 'CUSTOMERS' | 'PACKAGES';
type DateRange = 'TODAY' | 'THIS_MONTH' | 'LAST_MONTH' | 'CUSTOM';

interface PackageRow {
    id: string;
    package_code: string | null;
    type_name: string;
    category: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_name_2?: string | null;
    customer_birth_year_2?: number | null;
    guardian_name?: string | null;
    guardian_phone?: string | null;
    card_code: string | null;
    customer_id: string | null;
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
    validity_days: number | null;
}

interface CustomerSummary {
    id: string;
    phone: string;
    name: string;
    card_code: string;
    email: string | null;
    birth_date: string | null;
    gender: string | null;
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
    const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Date filter for Packages tab
    const [dateRange, setDateRange] = useState<DateRange>('THIS_MONTH');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');

    // Expanded customer / detail modal
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [selectedPkg, setSelectedPkg] = useState<PackageRow | null>(null);
    const [editingCustomer, setEditingCustomer] = useState<CustomerSummary | null>(null);
    const [editCustData, setEditCustData] = useState({ name: '', phone: '', email: '', birth_date: '', gender: 'Khác' });

    // Card code editing
    const [editingCardPkgId, setEditingCardPkgId] = useState<string | null>(null);
    const [newCardCode, setNewCardCode] = useState('');

    // Package editing (Admin)
    const [isEditingPkg, setIsEditingPkg] = useState(false);
    const [editSessions, setEditSessions] = useState<number | ''>('');
    const [editTotalSessions, setEditTotalSessions] = useState<number | ''>('');
    const [editValidFrom, setEditValidFrom] = useState('');
    const [editValidUntil, setEditValidUntil] = useState('');
    const [editPricePaid, setEditPricePaid] = useState<number | ''>('');
    const [editSoldAt, setEditSoldAt] = useState('');

    // Import legacy customers
    const [showImportModal, setShowImportModal] = useState(false);
    const [importData, setImportData] = useState<{ name: string; phone: string; card_code: string; package_type: string; pkg_name: string; total_sessions: number; remaining: number; valid_from: string; valid_until: string; sold_at: string }[]>([]); const [importing, setImporting] = useState(false);
    const [importResult, setImportResult] = useState<{ success: number; skipped: number; errors: string[] } | null>(null);
    const [importWarnings, setImportWarnings] = useState<{ row: number; field: string; message: string }[]>([]);
    const [ticketTypesForImport, setTicketTypesForImport] = useState<{ id: string; name: string; category: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);


    // Print functionality
    const [printTicket, setPrintTicket] = useState<PrintTicketData | null>(null);
    const [bizInfo, setBizInfo] = useState<{ name: string; address: string; phone: string; logo: string; pool_close_time?: string }>({
        name: 'Hệ Thống Vé Bơi', address: '', phone: '', logo: ''
    });

    useEffect(() => {
        fetchAllData();
        fetchBusinessInfo();
        // Fetch ticket types for import mapping
        supabase.from('ticket_types').select('id, name, category').in('category', ['MULTI', 'LESSON']).eq('is_active', true)
            .then(({ data }) => { if (data) setTicketTypesForImport(data); });
    }, []);

    async function fetchAllData() {
        const { data: custData } = await supabase
            .from('customers')
            .select('*')
            .order('full_name');
        setAllCustomers((custData || []) as Customer[]);
        await fetchAllPackages();
    }

    async function fetchBusinessInfo() {
        const { data } = await supabase.from('system_settings').select('key, value');
        if (data) {
            const info: Record<string, string> = {};
            data.forEach(r => {
                let val = r.value;
                try { val = typeof val === 'string' ? val.replace(/^"|"$/g, '') : JSON.parse(JSON.stringify(val)).replace(/^"|"$/g, ''); }
                catch { val = typeof val === 'string' ? val : String(val); }
                info[r.key] = val;
            });
            setBizInfo({
                name: info.business_name || 'Hệ Thống Vé Bơi',
                address: info.business_address || '',
                phone: info.business_phone || '',
                logo: info.business_logo || '',
                pool_close_time: info.pool_close_time || ''
            });
        }
    }

    async function fetchAllPackages() {
        const { data, error } = await supabase
            .from('tickets')
            .select(`
                id, customer_name, customer_phone, card_code, customer_id, status,
                valid_from, valid_until, remaining_sessions, total_sessions,
                price_paid, sold_at, package_code,
                customer_name_2, customer_birth_year_2, guardian_name, guardian_phone,
                ticket_types!inner (name, category, price, session_count, validity_days),
                profiles:sold_by (full_name),
                promotions:promotion_id (name, type, value)
            `)
            .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
            .neq('source', 'CHECKIN')
            .order('sold_at', { ascending: false });

        if (error) { console.error(error); setLoading(false); return; }

        const mapped: PackageRow[] = (data || []).map((t: Record<string, any>) => ({
            id: t.id,
            package_code: t.package_code,
            type_name: t.ticket_types?.name || '',
            category: t.ticket_types?.category || '',
            customer_name: t.customer_name,
            customer_phone: t.customer_phone,
            customer_name_2: t.customer_name_2,
            customer_birth_year_2: t.customer_birth_year_2,
            guardian_name: t.guardian_name,
            guardian_phone: t.guardian_phone,
            card_code: t.card_code,
            customer_id: t.customer_id || null,
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
            validity_days: t.ticket_types?.validity_days || null,
        }));

        setAllPackages(mapped);
        setLoading(false);
    }

    function computeStatus(t: Record<string, any>): string {
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
        if (t.status === 'IN' || t.status === 'OUT' || t.status === 'IN_USE') return 'IN_USE';
        return 'UNUSED';
    }

    // Helper: Mask card code for non-admins
    function maskCardCode(code: string | null): string | null {
        if (!code) return null;
        if (profile?.role === 'ADMIN') return code;
        if (code.length <= 6) return '***';
        // Show first 5 and last 4, middle masked
        return `${code.substring(0, 5)}***${code.substring(code.length - 4)}`;
    }

    // --- Build customer summaries from customers table ---
    function buildCustomerList(): CustomerSummary[] {
        // Build maps: card_code -> packages, customer_id -> packages, customer_phone -> packages
        const pkgByCard = new Map<string, PackageRow[]>();
        const pkgByCustId = new Map<string, PackageRow[]>();
        const pkgByPhone = new Map<string, PackageRow[]>();
        allPackages.forEach(p => {
            if (p.card_code) {
                if (!pkgByCard.has(p.card_code)) pkgByCard.set(p.card_code, []);
                pkgByCard.get(p.card_code)!.push(p);
            }
            if (p.customer_id) {
                if (!pkgByCustId.has(p.customer_id)) pkgByCustId.set(p.customer_id, []);
                pkgByCustId.get(p.customer_id)!.push(p);
            }
            if (p.customer_phone) {
                if (!pkgByPhone.has(p.customer_phone)) pkgByPhone.set(p.customer_phone, []);
                pkgByPhone.get(p.customer_phone)!.push(p);
            }
        });

        return allCustomers.map(c => {
            // Match by card_code first, then by customer_id, then by phone
            const byCard = pkgByCard.get(c.card_code) || [];
            const byCustId = pkgByCustId.get(c.id) || [];
            const byPhone = c.phone ? (pkgByPhone.get(c.phone) || []) : [];
            // Merge & deduplicate by id
            const seenIds = new Set(byCard.map(p => p.id));
            const packages = [...byCard];
            byCustId.forEach(p => { if (!seenIds.has(p.id)) { packages.push(p); seenIds.add(p.id); } });
            byPhone.forEach(p => { if (!seenIds.has(p.id)) { packages.push(p); seenIds.add(p.id); } });
            const activeOrExpiring = packages.filter(p => p.status === 'IN_USE' || p.status === 'UNUSED' || p.status === 'EXPIRING');
            let overallStatus = 'EXPIRED';
            if (packages.length === 0) overallStatus = 'NONE';
            else if (activeOrExpiring.some(p => p.status === 'IN_USE' || p.status === 'UNUSED')) overallStatus = 'ACTIVE';
            else if (activeOrExpiring.some(p => p.status === 'EXPIRING')) overallStatus = 'EXPIRING';

            return {
                id: c.id,
                phone: c.phone,
                name: c.full_name,
                card_code: c.card_code,
                email: c.email,
                birth_date: c.birth_date,
                gender: c.gender,
                registeredAt: c.created_at,
                overallStatus,
                activePackages: activeOrExpiring.length,
                totalPackages: packages.length,
                packages,
            };
        });
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
        const inputCardCode = newCardCode.trim().toUpperCase();
        if (!inputCardCode) { alert('Vui lòng nhập mã thẻ mới!'); return; }
        if (!confirm('Bạn có chắc chắn muốn thay đổi mã thẻ cho khách hàng này?')) return;

        const pkg = allPackages.find(p => p.id === pkgId);
        if (!pkg) return;
        const oldCode = pkg.card_code;

        // --- 1. Validate against card_bank ---
        const { data: cardRes, error: cardErr } = await supabase
            .from('card_bank')
            .select('*')
            .eq('card_code', inputCardCode)
            .maybeSingle();

        let shouldInsertCard = false;
        let shouldUpdateCardId = null;

        if (cardErr || !cardRes) {
            if (profile?.role === 'ADMIN') {
                const c = window.confirm(`Mã thẻ "${inputCardCode}" không có trong ngân hàng thẻ. Bạn có muốn tự động tạo và gán không?`);
                if (!c) return;
                shouldInsertCard = true;
            } else {
                alert('Mã thẻ không hợp lệ hoặc chưa được khởi tạo. Vui lòng liên hệ Admin.');
                return;
            }
        } else {
            if (cardRes.status !== 'UNUSED') {
                if (profile?.role === 'ADMIN') {
                    const c = window.confirm(`Mã thẻ "${inputCardCode}" đã được sử dụng (Trạng thái: ${cardRes.status}). Bạn có chắc chắn muốn ép dùng mã này không?`);
                    if (!c) return;
                    shouldUpdateCardId = cardRes.id;
                } else {
                    alert(`Mã thẻ này đã được sử dụng hoặc hỏng (Trạng thái: ${cardRes.status}). Vui lòng lấy thẻ khác.`);
                    return;
                }
            } else {
                shouldUpdateCardId = cardRes.id;
            }
        }

        // --- 2. Update tickets ---
        if (oldCode) {
            await supabase.from('tickets').update({ card_code: inputCardCode }).eq('card_code', oldCode);
        } else {
            await supabase.from('tickets').update({ card_code: inputCardCode }).eq('id', pkgId);
        }

        // --- 3. Update customer table if needed ---
        if (pkg.customer_phone) {
            await supabase.from('customers').update({ card_code: inputCardCode }).eq('phone', pkg.customer_phone);
            // Also trigger a refresh of customers list
        }

        // --- 4. Update card bank ---
        if (shouldInsertCard) {
            await supabase.from('card_bank').insert({
                card_code: inputCardCode,
                prefix: null,
                month_year: null,
                sequence_number: null,
                random_string: null,
                status: 'USED',
                source: 'MANUAL',
                batch_number: null,
                batch_note: null,
                created_by: profile?.id
            });
        } else if (shouldUpdateCardId) {
            await supabase.from('card_bank').update({ status: 'USED' }).eq('id', shouldUpdateCardId);
        }

        // --- 5. Revoke old card ---
        if (oldCode && oldCode !== inputCardCode) {
            const { data: oldCard } = await supabase.from('card_bank').select('id').eq('card_code', oldCode).maybeSingle();
            if (oldCard) {
                await supabase.from('card_bank').update({ status: 'REVOKED' }).eq('id', oldCard.id);
            }
        }

        setEditingCardPkgId(null);
        setNewCardCode('');
        fetchAllData(); // Refresh customers and packages
        alert('✅ Đã cập nhật mã thẻ thành công!');
    }

    // --- Package Editing & Deleting (Admin) ---
    async function handleUpdatePackage() {
        if (!selectedPkg) return;
        if (!confirm('Bạn có chắc chắn muốn lưu các thay đổi này?')) return;

        const updatedRemaining = editSessions === '' ? null : Number(editSessions);
        const updatedTotal = editTotalSessions === '' ? null : Number(editTotalSessions);

        let finalStatus = selectedPkg.status;
        if (finalStatus === 'EXPIRING') finalStatus = 'IN_USE'; // EXPIRING is a frontend display status

        let finalValidFrom = editValidFrom || null;
        let finalValidUntil = editValidUntil || null;

        // Tự động kích hoạt nếu gói chưa dùng và có sửa giảm lượt HOẶC admin đã khai báo ngày bắt đầu/kết thúc
        const isReducingSessions = updatedRemaining !== null && updatedTotal !== null && updatedRemaining < updatedTotal;
        const hasStartOrEndDate = finalValidFrom !== null || finalValidUntil !== null;

        if (
            selectedPkg.status === 'UNUSED' &&
            (isReducingSessions || hasStartOrEndDate)
        ) {
            finalStatus = 'IN_USE';
            // Nếu admin chưa điền ngày bắt đầu thì lấy hôm nay
            if (!finalValidFrom) {
                const now = new Date();
                finalValidFrom = now.toLocaleDateString('en-CA');

                // Tính toán ngày kết thúc = hôm nay + validity_days (nếu có và admin chưa nhập)
                if (!finalValidUntil && selectedPkg.validity_days) {
                    const exp = new Date(now);
                    exp.setDate(exp.getDate() + selectedPkg.validity_days);
                    finalValidUntil = exp.toLocaleDateString('en-CA');
                }
            }
        }

        // Tự động thay đổi trạng thái dựa trên ngày và số buổi cập nhật mới
        const today = new Date().toLocaleDateString('en-CA');
        const isDateExpired = finalValidUntil && finalValidUntil < today;
        const isSessionExpired = updatedRemaining !== null && updatedRemaining <= 0;

        if (isDateExpired || isSessionExpired) {
            finalStatus = 'EXPIRED';
        } else if (finalStatus === 'EXPIRED') {
            // Nếu thẻ đang "Hết hạn" nhưng được gia hạn (ngày và số lượt đều hợp lệ)
            finalStatus = 'IN_USE';
        }

        const updateData: any = {
            status: finalStatus,
            remaining_sessions: updatedRemaining,
            total_sessions: updatedTotal,
            valid_from: finalValidFrom,
            valid_until: finalValidUntil,
            price_paid: editPricePaid === '' ? selectedPkg.price_paid : Number(editPricePaid),
            sold_at: editSoldAt && editSoldAt !== (selectedPkg.sold_at || '').substring(0, 10)
                ? new Date(editSoldAt + 'T12:00:00+07:00').toISOString()
                : selectedPkg.sold_at,
            updated_at: new Date().toISOString()
        };

        console.log('[DEBUG] handleUpdatePackage → updateData:', updateData, '→ id:', selectedPkg.id);

        const { error, data: updatedRows, count } = await supabase.from('tickets').update(updateData).eq('id', selectedPkg.id).select();

        console.log('[DEBUG] Supabase response → error:', error, '→ updatedRows:', updatedRows, '→ count:', count);

        if (error) {
            alert('Lỗi cập nhật gói: ' + error.message);
        } else if (!updatedRows || updatedRows.length === 0) {
            alert('⚠️ Supabase không cập nhật được dòng nào. Có thể do RLS chặn. Vui lòng kiểm tra RLS policy trên bảng tickets.');
        } else {
            alert('✅ Cập nhật thành công!');
            setIsEditingPkg(false);
            setSelectedPkg(null);
            fetchAllPackages();
        }
    }

    async function handleDeletePackage() {
        if (!selectedPkg) return;
        if (!confirm('⚠️ CẢNH BÁO: Hành động này sẽ XÓA VĨNH VIỄN gói thẻ này cùng toàn bộ lịch sử quẹt thẻ liên quan. Bạn có chắc chắn muốn tiếp tục?')) return;
        if (!confirm('Hỏi lại lần cuối: Bạn thực sự muốn XÓA VĨNH VIỄN gói thẻ này? Dữ liệu không thể khôi phục!')) return;

        // 1. Delete scan logs to avoid foreign key constraint errors
        await supabase.from('scan_logs').delete().eq('ticket_id', selectedPkg.id);

        // 2. Delete the ticket
        const { error } = await supabase.from('tickets').delete().eq('id', selectedPkg.id);

        if (error) {
            alert('Lỗi xóa gói: ' + error.message);
        } else {
            alert('✅ Đã xóa gói thành công!');
            setSelectedPkg(null);
            fetchAllPackages();
        }
    }

    // --- Edit Customer ---
    function openEditCustomer(c: CustomerSummary) {
        setEditingCustomer(c);
        setEditCustData({
            name: c.name || '',
            phone: c.phone || '',
            email: c.email || '',
            birth_date: c.birth_date || '',
            gender: c.gender || 'Khác'
        });
    }

    async function handleSaveCustomer() {
        if (!editingCustomer) return;
        if (!editCustData.name.trim()) { alert('Vui lòng nhập họ tên!'); return; }

        const updatePayload: any = {
            full_name: editCustData.name.trim(),
            phone: editCustData.phone.trim() || null,
            email: editCustData.email.trim() || null,
            gender: editCustData.gender
        };
        if (editCustData.birth_date) {
            updatePayload.birth_date = editCustData.birth_date;
        } else {
            updatePayload.birth_date = null;
        }

        const { error } = await supabase.from('customers').update(updatePayload).eq('id', editingCustomer.id);

        if (error) {
            alert('Lỗi cập nhật: ' + error.message);
        } else {
            alert('✅ Cập nhật khách hàng thành công!');
            setEditingCustomer(null);
            fetchAllData();
        }
    }

    async function handleDeleteCustomer(c: CustomerSummary) {
        if (!isAdmin) return;

        if (c.totalPackages > 0) {
            alert(`⚠️ Không thể xóa khách hàng này!\n\nKhách hàng đang có ${c.totalPackages} gói thẻ. Theo chính sách an toàn dữ liệu, bạn cần phải xóa các gói thẻ này trước khi xóa hồ sơ khách hàng.`);
            return;
        }

        if (!confirm(`⚠️ CẢNH BÁO: Xóa hồ sơ khách hàng "${c.name}"?\nHành động này không thể hoàn tác.`)) return;

        const { error } = await supabase.from('customers').delete().eq('id', c.id);

        if (error) {
            alert('Lỗi xóa khách hàng: ' + error.message);
        } else {
            alert('✅ Đã xóa khách hàng thành công!');
            setExpandedId(null);
            fetchAllData();
        }
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

    // --- DOWNLOAD IMPORT TEMPLATE ---
    function downloadImportTemplate() {
        const templateData = [
            { 'Tên KH': 'NGUYỄN VĂN A', 'SĐT': '0901234567', 'Mã thẻ': 'HB032600001ABC123', 'Loại gói': 'MULTI', 'Tên gói/vé': 'VÉ 10 BUỔI', 'Tổng buổi ĐK': 13, 'Buổi còn lại': 10, 'Ngày mua': '10/01/2026', 'Ngày bắt đầu': '15/01/2026', 'Ngày kết thúc': '15/07/2026' },
            { 'Tên KH': 'TRẦN THỊ B', 'SĐT': '0912345678', 'Mã thẻ': 'HB032600002DEF456', 'Loại gói': 'LESSON', 'Tên gói/vé': 'HỌC BƠI 1:1', 'Tổng buổi ĐK': 15, 'Buổi còn lại': 12, 'Ngày mua': '', 'Ngày bắt đầu': '', 'Ngày kết thúc': '' },
        ];
        const ws = XLSX.utils.json_to_sheet(templateData);
        ws['!cols'] = [
            { wch: 25 }, { wch: 15 }, { wch: 22 }, { wch: 12 },
            { wch: 20 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 14 },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Template');
        const instrData = [
            { 'Cột': 'Tên KH', 'Bắt buộc': '✅ Có', 'Mô tả': 'Họ tên đầy đủ khách hàng' },
            { 'Cột': 'SĐT', 'Bắt buộc': '⚠️ Nên có', 'Mô tả': 'Số điện thoại (10 số, bắt đầu bằng 0)' },
            { 'Cột': 'Mã thẻ', 'Bắt buộc': '✅ Có', 'Mô tả': 'Mã thẻ duy nhất trên hệ thống (IN HOA tự động)' },
            { 'Cột': 'Loại gói', 'Bắt buộc': '✅ Có', 'Mô tả': 'MULTI = Vé nhiều buổi, LESSON = Học bơi' },
            { 'Cột': 'Tên gói/vé', 'Bắt buộc': '⚠️ Nên có', 'Mô tả': 'Tên loại gói/vé đã có trong hệ thống (để khớp tự động). Để trống = lấy gói đầu tiên cùng loại' },
            { 'Cột': 'Tổng buổi ĐK', 'Bắt buộc': '⚠️ Nên có', 'Mô tả': 'Tổng số buổi đăng ký ban đầu. Để trống = không giới hạn' },
            { 'Cột': 'Buổi còn lại', 'Bắt buộc': '⚠️ Nên có', 'Mô tả': 'Số buổi còn lại hiện tại. Để trống = bằng tổng buổi ĐK' },
            { 'Cột': 'Ngày mua', 'Bắt buộc': '⚠️ Tùy chọn', 'Mô tả': 'Ngày mua gói. Định dạng: DD/MM/YYYY (VD: 10/01/2026). Để trống = ngày import' },
            { 'Cột': 'Ngày bắt đầu', 'Bắt buộc': '⚠️ Tùy chọn', 'Mô tả': 'Ngày bắt đầu hiệu lực gói. Định dạng: DD/MM/YYYY (VD: 15/01/2026). Để trống = chưa kích hoạt' },
            { 'Cột': 'Ngày kết thúc', 'Bắt buộc': '⚠️ Tùy chọn', 'Mô tả': 'Ngày hết hạn gói. Định dạng: DD/MM/YYYY. Để trống = không giới hạn' },
        ];
        const ws2 = XLSX.utils.json_to_sheet(instrData);
        ws2['!cols'] = [{ wch: 14 }, { wch: 14 }, { wch: 65 }];
        XLSX.utils.book_append_sheet(wb, ws2, 'Hướng dẫn');
        XLSX.writeFile(wb, 'template_import_khach_hang.xlsx');
    }

    // --- IMPORT EXCEL ---
    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (evt) => {
            const data = evt.target?.result;
            const wb = XLSX.read(data, { type: 'binary' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const rows: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });

            if (rows.length === 0) {
                alert('❌ File Excel trống hoặc không có dữ liệu. Vui lòng kiểm tra lại.\n\nBấm "Tải Template" để lấy file mẫu.');
                return;
            }

            // Check required columns exist
            const firstRow = rows[0];
            const hasNameCol = 'Tên KH' in firstRow || 'ten_kh' in firstRow || 'Tên' in firstRow || 'name' in firstRow || 'Ho ten' in firstRow;
            const hasCardCol = 'Mã thẻ' in firstRow || 'ma_the' in firstRow || 'card_code' in firstRow || 'Ma the' in firstRow;
            if (!hasNameCol || !hasCardCol) {
                alert('❌ File Excel thiếu cột bắt buộc!\n\nCần có ít nhất 2 cột:\n• "Tên KH" — Họ tên khách hàng\n• "Mã thẻ" — Mã thẻ khách\n\nBấm "Tải Template" để lấy file mẫu đúng định dạng.');
                return;
            }

            const warnings: { row: number; field: string; message: string }[] = [];
            const parsed = rows.map((r: any, idx: number) => {
                const rowNum = idx + 2; // Excel row (header=1)
                const name = String(r['Tên KH'] || r['ten_kh'] || r['Tên'] || r['name'] || r['Ho ten'] || '').trim();
                const phone = String(r['SĐT'] || r['sdt'] || r['Số điện thoại'] || r['phone'] || r['SDT'] || '').trim();
                const card = String(r['Mã thẻ'] || r['ma_the'] || r['card_code'] || r['Ma the'] || '').trim();
                const pkgType = String(r['Loại gói'] || r['loai_goi'] || r['package_type'] || r['Loai goi'] || 'MULTI').trim().toUpperCase();
                const pkgName = String(r['Tên gói/vé'] || r['Ten goi'] || r['pkg_name'] || r['Tên gói'] || '').trim();
                const totalSessions = Number(r['Tổng buổi ĐK'] || r['Tong buoi DK'] || r['total_sessions'] || r['Số buổi'] || r['so_buoi'] || r['sessions'] || 0);
                const remaining = Number(r['Buổi còn lại'] || r['Buoi con lai'] || r['remaining'] || 0) || totalSessions;
                const soldAtStr = parseDateDDMMYYYY(r['Ngày mua'] || r['Ngay mua'] || r['sold_at'] || '');
                const validFrom = parseDateDDMMYYYY(r['Ngày bắt đầu'] || r['Ngay bat dau'] || r['valid_from'] || '');
                const validUntil = parseDateDDMMYYYY(r['Ngày kết thúc'] || r['Ngay ket thuc'] || r['valid_until'] || '');

                // Validate
                if (!name) warnings.push({ row: rowNum, field: 'Tên KH', message: 'Thiếu tên khách hàng → dòng sẽ bị bỏ qua' });
                if (!card) warnings.push({ row: rowNum, field: 'Mã thẻ', message: 'Thiếu mã thẻ → dòng sẽ bị bỏ qua' });
                if (name && card && !phone) warnings.push({ row: rowNum, field: 'SĐT', message: 'Không có SĐT — nên bổ sung' });
                if (name && card && totalSessions <= 0) warnings.push({ row: rowNum, field: 'Tổng buổi', message: 'Tổng buổi = 0 → sẽ không giới hạn lượt' });
                if (name && card && remaining > totalSessions && totalSessions > 0) warnings.push({ row: rowNum, field: 'Buổi còn lại', message: `Buổi còn lại (${remaining}) > Tổng buổi (${totalSessions})` });
                if (validFrom && validUntil && validFrom > validUntil) warnings.push({ row: rowNum, field: 'Ngày', message: 'Ngày bắt đầu > Ngày kết thúc' });

                return { name, phone, card_code: card, package_type: pkgType.includes('LESSON') ? 'LESSON' : 'MULTI', pkg_name: pkgName, total_sessions: totalSessions, remaining, valid_from: validFrom, valid_until: validUntil, sold_at: soldAtStr };
            }).filter(r => r.name && r.card_code);

            // Check for duplicate card codes in file
            const cardCounts = new Map<string, number>();
            parsed.forEach(r => cardCounts.set(r.card_code, (cardCounts.get(r.card_code) || 0) + 1));
            cardCounts.forEach((count, code) => {
                if (count > 1) warnings.push({ row: 0, field: 'Mã thẻ', message: `Mã thẻ "${code}" bị trùng ${count} lần trong file` });
            });

            if (parsed.length === 0) {
                alert('❌ Không tìm thấy dòng dữ liệu hợp lệ nào!\n\nMỗi dòng cần có ít nhất "Tên KH" và "Mã thẻ".\nBấm "Tải Template" để lấy file mẫu.');
                return;
            }

            setImportWarnings(warnings);
            setImportData(parsed);
            setImportResult(null);
            setShowImportModal(true);
        };
        reader.readAsBinaryString(file);
        e.target.value = ''; // reset file input
    }

    async function handleConfirmImport() {
        if (importData.length === 0) return;
        setImporting(true);
        let success = 0;
        let skipped = 0;
        const errors: string[] = [];

        for (const row of importData) {
            try {
                // 1. Check if customer with this card_code already exists
                const { data: existingCust } = await supabase.from('customers').select('id').eq('card_code', row.card_code).maybeSingle();
                let customerId = existingCust?.id;

                if (!customerId) {
                    // Create new customer
                    const { data: newCust, error: custErr } = await supabase.from('customers').insert({
                        card_code: row.card_code,
                        full_name: row.name,
                        phone: row.phone || '',
                    }).select('id').single();
                    if (custErr) { errors.push(`${row.card_code}: Lỗi tạo KH - ${custErr.message}`); skipped++; continue; }
                    customerId = newCust.id;
                } else {
                    skipped++;
                    // Customer exists, still create ticket for them
                }

                // 2. Find matching ticket type (by name if provided, else by category)
                let matchType = row.pkg_name
                    ? ticketTypesForImport.find(t => t.name.toLowerCase() === row.pkg_name.toLowerCase() && t.category === row.package_type)
                    : null;
                if (!matchType) matchType = ticketTypesForImport.find(t => t.category === row.package_type);
                if (!matchType) { errors.push(`${row.card_code}: Không tìm thấy loại gói ${row.pkg_name || row.package_type}`); continue; }

                // 3. Create ticket with price_paid=0, source='IMPORT'
                const ticketStatus = (row.valid_from && row.remaining < row.total_sessions && row.total_sessions > 0) ? 'IN_USE' : 'UNUSED';
                const { error: tickErr } = await supabase.from('tickets').insert({
                    ticket_type_id: matchType.id,
                    status: ticketStatus,
                    customer_name: row.name,
                    customer_phone: row.phone || null,
                    card_code: row.card_code,
                    customer_id: customerId,
                    remaining_sessions: row.remaining > 0 ? row.remaining : null,
                    total_sessions: row.total_sessions > 0 ? row.total_sessions : null,
                    valid_from: row.valid_from || null,
                    valid_until: row.valid_until || null,
                    price_paid: 0,
                    source: 'IMPORT',
                    sold_by: profile?.id,
                    sold_at: row.sold_at ? new Date(row.sold_at + 'T00:00:00').toISOString() : new Date().toISOString(),
                });
                if (tickErr) { errors.push(`${row.card_code}: Lỗi tạo vé - ${tickErr.message}`); continue; }

                // 4. Add card to card_bank (source='MANUAL')
                const { data: existingCard } = await supabase.from('card_bank').select('id').eq('card_code', row.card_code).maybeSingle();
                if (!existingCard) {
                    await supabase.from('card_bank').insert({
                        card_code: row.card_code,
                        prefix: null,
                        month_year: null,
                        sequence_number: null,
                        random_string: null,
                        source: 'MANUAL',
                        status: 'USED',
                        created_by: profile?.id,
                    });
                }

                success++;
            } catch (err: any) {
                errors.push(`${row.card_code}: ${err.message}`);
            }
        }

        setImportResult({ success, skipped, errors });
        setImporting(false);
        if (success > 0) fetchAllData(); // Refresh
    }

    if (loading) return <div className="page-loading">Đang tải...</div>;

    const customers = buildCustomerList();
    const filteredCustomers = customers.filter(c =>
        !searchTerm ||
        c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.phone.includes(searchTerm) ||
        c.card_code.toLowerCase().includes(searchTerm.toLowerCase())
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
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    {isAdmin && (
                        <>
                            <input type="file" ref={fileInputRef} accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
                            <button className="btn btn-ghost" onClick={downloadImportTemplate} style={{ padding: '8px 16px', fontSize: '13px' }}>
                                📋 Tải Template
                            </button>
                            <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} style={{ padding: '8px 16px', fontSize: '13px' }}>
                                📥 Import Excel
                            </button>
                        </>
                    )}
                    <div style={{ display: 'flex', gap: '4px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '10px' }}>
                        {([['CUSTOMERS', '👤 Khách hàng'], ['PACKAGES', '📦 Gói thẻ']] as [SubTab, string][]).map(([key, label]) => (
                            <button key={key} className={`btn ${subTab === key ? 'btn-primary' : 'btn-ghost'}`}
                                style={{ padding: '8px 16px', fontSize: '13px', margin: 0 }}
                                onClick={() => { setSubTab(key); setSearchTerm(''); setExpandedId(null); }}>
                                {label}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Search */}
            <input type="text" placeholder={subTab === 'CUSTOMERS' ? '🔍 Tìm theo tên, SĐT...' : '🔍 Tìm theo tên, SĐT, mã thẻ, mã gói...'}
                value={searchTerm} onChange={e => setSearchTerm(normalizeScannerInput(e.target.value))}
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
                            {filteredCustomers.map((c) => {
                                const st = getStatusBadge(c.overallStatus);
                                const isExpanded = expandedId === c.id;
                                return (
                                    <div key={c.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '12px', overflow: 'hidden' }}>
                                        {/* Customer Row — clickable */}
                                        <div onClick={() => setExpandedId(isExpanded ? null : c.id)}
                                            style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                                                <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px', fontWeight: 700, flexShrink: 0 }}>
                                                    {(c.name || '?')[0].toUpperCase()}
                                                </div>
                                                <div>
                                                    <div style={{ fontWeight: 600, fontSize: '15px' }}>{c.name}</div>
                                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                                        🏷️ {maskCardCode(c.card_code)} · 📞 {c.phone}
                                                        {c.email && <span> · ✉️ {c.email}</span>}
                                                        {allCustomers.find(x => x.id === c.id)?.hotkey && <span style={{ marginLeft: '6px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>⌨ {allCustomers.find(x => x.id === c.id)!.hotkey}</span>}
                                                    </div>
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
                                                <div style={{ display: 'flex', gap: '24px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Họ tên:</span> <strong>{c.name}</strong></div>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>SĐT:</span> <strong>{c.phone}</strong></div>
                                                    <div><span style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>Gói đang dùng:</span> <strong>{c.activePackages}</strong></div>
                                                    <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
                                                        <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: '12px' }} onClick={(e) => { e.stopPropagation(); openEditCustomer(c); }}>✏️ Sửa thông tin</button>
                                                        {isAdmin && (
                                                            <button className="btn btn-ghost" style={{ padding: '4px 12px', fontSize: '12px', color: '#ef4444' }} onClick={(e) => { e.stopPropagation(); handleDeleteCustomer(c); }}>🗑️ Xóa</button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Package list */}
                                                <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>📦 Danh sách gói thẻ ({c.totalPackages})</div>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                    {c.packages.map(p => {
                                                        const pst = getStatusBadge(p.status);
                                                        return (
                                                            <div key={p.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, minWidth: '200px' }}>
                                                                    <div style={{ fontSize: '14px', fontWeight: 600 }}>{p.customer_name}</div>
                                                                    <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                                        Mã thẻ: {maskCardCode(p.card_code || '—')} {p.customer_phone ? `· SĐT: ${p.customer_phone}` : ''}
                                                                    </div>
                                                                    <span style={{ background: p.category === 'MONTHLY' ? '#dbeafe' : p.category === 'LESSON' ? '#f0fdf4' : '#fef3c7', color: p.category === 'MONTHLY' ? '#1d4ed8' : p.category === 'LESSON' ? '#166534' : '#92400e', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{p.type_name}</span>
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
                                                                <input type="text" value={newCardCode} onChange={e => setNewCardCode(normalizeScannerInput(e.target.value))}
                                                                    placeholder="Quét hoặc nhập mã thẻ mới" autoFocus
                                                                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--border-color)', fontSize: '14px', fontWeight: 700, flex: 1 }} />
                                                                <button className="btn btn-primary" style={{ padding: '6px 14px', fontSize: '12px' }} onClick={(e) => { e.stopPropagation(); handleUpdateCardCode(editingCardPkgId); }}>Lưu</button>
                                                                <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: '12px' }} onClick={(e) => { e.stopPropagation(); setEditingCardPkgId(null); setNewCardCode(''); }}>Hủy</button>
                                                            </div>
                                                        ) : (
                                                            <button className="btn btn-ghost" style={{ fontSize: '12px', padding: '6px 12px' }}
                                                                onClick={(e) => { e.stopPropagation(); setEditingCardPkgId(c.packages[0]?.id || null); setNewCardCode(c.packages[0]?.card_code || ''); }}>
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
                                    const st = getStatusBadge(t.status);
                                    return (
                                        <tr key={t.id} style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card)', transition: 'background 0.15s', cursor: 'pointer' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            onClick={() => setSelectedPkg(t)}>
                                            <td style={{ ...tdS, fontWeight: 700, minWidth: '80px' }}>{t.package_code || '—'}</td>
                                            <td style={{ ...tdS, fontWeight: 600 }}>{t.customer_name || '—'}</td>
                                            <td style={tdS}>{t.customer_phone || '—'}</td>
                                            {isAdmin && <td style={tdS}>{t.card_code || '—'}</td>}
                                            <td style={tdS}>
                                                <span style={{ background: t.category === 'MONTHLY' ? '#dbeafe' : t.category === 'LESSON' ? '#f0fdf4' : '#fef3c7', color: t.category === 'MONTHLY' ? '#1d4ed8' : t.category === 'LESSON' ? '#166534' : '#92400e', padding: '4px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{t.type_name}</span>
                                            </td>
                                            <td style={tdS}>
                                                <span style={{ background: st.bg, color: st.color, padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600 }}>{st.text}</span>
                                            </td>
                                            <td style={{ ...tdS, fontWeight: 700, color: t.remaining_sessions !== null && t.remaining_sessions <= 3 ? '#ef4444' : '' }}>
                                                {t.remaining_sessions !== null ? `${t.remaining_sessions}/${t.total_sessions ?? t.remaining_sessions}` : '∞'}
                                            </td>
                                            <td style={{ ...tdS, color: 'var(--text-secondary)' }}>{fmtDate(t.valid_from)} → {fmtDate(t.valid_until)}</td>
                                            <td style={{ ...tdS, fontWeight: 700 }}>{fmt(t.price_paid)}</td>
                                            <td style={{ ...tdS, color: 'var(--text-secondary)' }}>{fmtDate(t.sold_at)}</td>
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
                    onClick={() => { setSelectedPkg(null); setIsEditingPkg(false); }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '28px', maxWidth: '440px', width: '90%', boxShadow: 'var(--shadow-lg)', maxHeight: '85vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>{isEditingPkg ? '✏️ Chỉnh sửa Gói' : '📋 Chi tiết Gói Bơi'}</h2>
                            <button onClick={() => { setSelectedPkg(null); setIsEditingPkg(false); }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                { label: 'Mã gói', value: selectedPkg.package_code || '—' },
                                { label: selectedPkg.category === 'LESSON' ? 'Học viên 1' : 'Họ tên', value: selectedPkg.customer_name || '—' },
                                ...(selectedPkg.category === 'LESSON' && selectedPkg.customer_name_2 ? [{ label: 'Học viên 2', value: `${selectedPkg.customer_name_2} - NS: ${selectedPkg.customer_birth_year_2 || 'N/A'}` }] : []),
                                ...(selectedPkg.guardian_name ? [{ label: 'Người giám hộ', value: `${selectedPkg.guardian_name} - ${selectedPkg.guardian_phone || 'N/A'}` }] : []),
                                { label: 'Số điện thoại', value: selectedPkg.customer_phone || '—' },
                                ...(isAdmin ? [{ label: 'Mã thẻ', value: selectedPkg.card_code || '—' }] : []),
                                { label: 'Loại thẻ', value: selectedPkg.type_name },
                                { label: 'Trạng thái', value: getStatusBadge(selectedPkg.status).text },
                                isEditingPkg ? { label: 'Lượt còn lại', value: <input type="number" min="0" value={editSessions} onChange={e => setEditSessions(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '80px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', textAlign: 'right' }} /> } : { label: 'Lượt còn lại', value: selectedPkg.remaining_sessions !== null ? selectedPkg.remaining_sessions : '∞' },
                                isEditingPkg ? { label: 'Tổng số lượt', value: <input type="number" min="0" value={editTotalSessions} onChange={e => setEditTotalSessions(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '80px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', textAlign: 'right' }} /> } : { label: 'Tổng số lượt', value: selectedPkg.total_sessions !== null ? selectedPkg.total_sessions : '∞' },
                                isEditingPkg ? { label: 'Ngày bắt đầu', value: <input type="date" value={editValidFrom} onChange={e => setEditValidFrom(e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} /> } : { label: 'Ngày bắt đầu', value: fmtDate(selectedPkg.valid_from) },
                                isEditingPkg ? { label: 'Ngày hết hạn', value: <input type="date" value={editValidUntil} onChange={e => setEditValidUntil(e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} /> } : { label: 'Ngày hết hạn', value: fmtDate(selectedPkg.valid_until) },
                                isEditingPkg ? { label: 'Giá bán', value: <input type="number" min="0" step="1000" value={editPricePaid} onChange={e => setEditPricePaid(e.target.value === '' ? '' : Number(e.target.value))} style={{ width: '120px', padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)', textAlign: 'right' }} /> } : { label: 'Giá bán', value: fmt(selectedPkg.price_paid) },
                                isEditingPkg ? { label: 'Ngày mua', value: <input type="date" value={editSoldAt} onChange={e => setEditSoldAt(e.target.value)} style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid var(--border-color)' }} /> } : { label: 'Ngày mua', value: fmtDate(selectedPkg.sold_at) },
                                { label: 'Người bán', value: selectedPkg.sold_by_name || '—' },
                            ].map(row => (
                                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                                    {typeof row.value === 'string' || typeof row.value === 'number' ? <strong>{row.value}</strong> : row.value}
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

                        {/* Admin Action Buttons */}
                        {isAdmin && !isEditingPkg && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                                <button className="btn btn-outline" style={{ flex: 1, color: '#475569', background: '#f8fafc', border: '1px solid #cbd5e1' }}
                                    onClick={() => setPrintTicket(selectedPkg as any)}>
                                    🖨️ In thẻ QR
                                </button>
                                <button className="btn btn-ghost" style={{ flex: 1, color: '#0369a1', background: '#e0f2fe' }}
                                    onClick={() => {
                                        setEditSessions(selectedPkg.remaining_sessions !== null ? selectedPkg.remaining_sessions : '');
                                        setEditTotalSessions(selectedPkg.total_sessions !== null ? selectedPkg.total_sessions : '');
                                        setEditValidFrom(selectedPkg.valid_from || '');
                                        setEditValidUntil(selectedPkg.valid_until || '');
                                        setEditPricePaid(selectedPkg.price_paid);
                                        setEditSoldAt(selectedPkg.sold_at ? selectedPkg.sold_at.split('T')[0] : '');
                                        setIsEditingPkg(true);
                                    }}>
                                    ✏️ Sửa gói
                                </button>
                                <button className="btn btn-primary" style={{ flex: 1, background: '#ef4444' }} onClick={handleDeletePackage}>
                                    🗑️ Xóa gói
                                </button>
                            </div>
                        )}

                        {isEditingPkg ? (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                                <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleUpdatePackage}>Lưu thay đổi</button>
                                <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setIsEditingPkg(false)}>Hủy</button>
                            </div>
                        ) : (
                            <button className="btn btn-primary" style={{ width: '100%', marginTop: '8px' }} onClick={() => setSelectedPkg(null)}>Đóng</button>
                        )}
                    </div>
                </div>
            )}

            {/* ===== EDIT CUSTOMER MODAL ===== */}
            {editingCustomer && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={() => setEditingCustomer(null)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', maxWidth: '440px', width: '90%', boxShadow: 'var(--shadow-lg)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>✏️ Sửa Thông Tin Khách Hàng</h2>
                            <button onClick={() => setEditingCustomer(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Họ tên *</label>
                                <input type="text" value={editCustData.name} onChange={e => setEditCustData({ ...editCustData, name: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-hover)' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Số điện thoại</label>
                                <input type="text" value={editCustData.phone} onChange={e => setEditCustData({ ...editCustData, phone: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-hover)' }} />
                            </div>
                            <div>
                                <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Email</label>
                                <input type="email" value={editCustData.email} onChange={e => setEditCustData({ ...editCustData, email: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-hover)' }} />
                            </div>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Ngày sinh</label>
                                    <input type="date" value={editCustData.birth_date} onChange={e => setEditCustData({ ...editCustData, birth_date: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-hover)' }} />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <label style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '4px', display: 'block' }}>Giới tính</label>
                                    <select value={editCustData.gender} onChange={e => setEditCustData({ ...editCustData, gender: e.target.value })} style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-hover)' }}>
                                        <option value="Nam">Nam</option>
                                        <option value="Nữ">Nữ</option>
                                        <option value="Khác">Khác</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
                            <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleSaveCustomer}>Lưu thay đổi</button>
                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setEditingCustomer(null)}>Hủy</button>
                        </div>
                    </div>
                </div>
            )}

            {/* ===== IMPORT MODAL ===== */}
            {showImportModal && (
                <div className="modal-overlay" style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div style={{ background: '#fff', borderRadius: '12px', padding: '24px', maxWidth: '800px', width: '95%', maxHeight: '80vh', overflow: 'auto' }}>
                        <h2 style={{ fontSize: '20px', marginBottom: '16px' }}>📥 Import Khách Hàng Cũ</h2>

                        {!importResult ? (
                            <>
                                <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                    Tìm thấy <b>{importData.length}</b> khách hàng hợp lệ từ file Excel. Xem lại trước khi import:
                                </div>

                                {importWarnings.length > 0 && (
                                    <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '12px' }}>
                                        <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>⚠️ Cảnh báo ({importWarnings.length}):</div>
                                        <ul style={{ fontSize: '12px', color: '#92400e', paddingLeft: '20px', margin: 0, maxHeight: '120px', overflowY: 'auto' }}>
                                            {importWarnings.map((w, i) => (
                                                <li key={i}>{w.row > 0 ? `Dòng ${w.row}` : 'File'} — <b>{w.field}</b>: {w.message}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                <div style={{ maxHeight: '350px', overflowY: 'auto', marginBottom: '16px' }}>
                                    <table className="data-table" style={{ width: '100%' }}>
                                        <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                                            <tr>
                                                <th style={{ ...thS, width: '30px' }}>#</th>
                                                <th style={thS}>Tên KH</th>
                                                <th style={thS}>SĐT</th>
                                                <th style={thS}>Mã Thẻ</th>
                                                <th style={thS}>Loại</th>
                                                <th style={thS}>Tên gói</th>
                                                <th style={thS}>Tổng</th>
                                                <th style={thS}>Còn</th>
                                                <th style={thS}>Bắt đầu</th>
                                                <th style={thS}>Kết thúc</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {importData.map((r, i) => {
                                                const rowWarnings = importWarnings.filter(w => w.row === i + 2);
                                                const hasWarn = rowWarnings.length > 0;
                                                return (
                                                    <tr key={i} style={{ background: hasWarn ? '#fffbeb' : '' }}>
                                                        <td style={tdS}>{i + 1}</td>
                                                        <td style={tdS}>{r.name}</td>
                                                        <td style={{ ...tdS, color: !r.phone ? '#dc2626' : '' }}>{r.phone || '⚠️'}</td>
                                                        <td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 'bold', fontSize: '11px' }}>{r.card_code}</td>
                                                        <td style={tdS}>
                                                            <span className={`badge ${r.package_type === 'LESSON' ? 'badge-primary' : 'badge-success'}`} style={{ fontSize: '10px' }}>
                                                                {r.package_type === 'LESSON' ? 'HB' : 'MT'}
                                                            </span>
                                                        </td>
                                                        <td style={{ ...tdS, fontSize: '11px' }}>{r.pkg_name || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>auto</span>}</td>
                                                        <td style={tdS}>{r.total_sessions || '∞'}</td>
                                                        <td style={tdS}>{r.remaining || '∞'}</td>
                                                        <td style={{ ...tdS, fontSize: '11px' }}>{r.valid_from || '—'}</td>
                                                        <td style={{ ...tdS, fontSize: '11px' }}>{r.valid_until || '—'}</td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>

                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={handleConfirmImport} disabled={importing || importData.length === 0}>
                                        {importing ? '⏳ Đang import...' : `✅ Xác nhận Import ${importData.length} khách`}
                                    </button>
                                    <button className="btn btn-ghost" onClick={downloadImportTemplate} disabled={importing} style={{ padding: '8px 16px', fontSize: '13px' }}>
                                        📋 Tải Template
                                    </button>
                                    <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowImportModal(false); setImportData([]); setImportWarnings([]); }} disabled={importing}>
                                        Hủy
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ padding: '16px', background: '#f0fdf4', borderRadius: '8px', marginBottom: '16px' }}>
                                    <div style={{ fontSize: '16px', fontWeight: 700, color: '#166534', marginBottom: '8px' }}>
                                        ✅ Import hoàn tất!
                                    </div>
                                    <div>Thành công: <b>{importResult.success}</b> khách</div>
                                    {importResult.skipped > 0 && <div>KH đã tồn tại (vẫn tạo gói): <b>{importResult.skipped}</b></div>}
                                    {importResult.errors.length > 0 && (
                                        <div style={{ marginTop: '12px' }}>
                                            <div style={{ color: '#991b1b', fontWeight: 600 }}>Lỗi ({importResult.errors.length}):</div>
                                            <ul style={{ fontSize: '12px', color: '#991b1b', maxHeight: '150px', overflowY: 'auto', paddingLeft: '20px' }}>
                                                {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                                            </ul>
                                        </div>
                                    )}
                                </div>
                                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setShowImportModal(false); setImportData([]); setImportResult(null); }}>
                                    Đóng
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {printTicket && (
                <PrintTicketModal
                    isOpen={true}
                    onClose={() => setPrintTicket(null)}
                    ticket={printTicket}
                    bizInfo={bizInfo}
                />
            )}
        </div>
    );
}

const thS: React.CSSProperties = { textAlign: 'left', padding: '8px 12px', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '2px solid var(--border-color)', whiteSpace: 'nowrap' };
const tdS: React.CSSProperties = { padding: '10px 12px', fontSize: '13px', whiteSpace: 'nowrap' };
