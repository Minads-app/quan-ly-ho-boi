/* eslint-disable @typescript-eslint/no-explicit-any, react-hooks/immutability, react-hooks/exhaustive-deps */
import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { normalizeScannerInput } from '../utils/scannerUtils';
import type { Customer } from '../types';
import * as XLSX from 'xlsx';
import PrintTicketModal, { type PrintTicketData } from '../components/PrintTicketModal';
import { Badge, Drawer, EmptyState, PageHeader, SegmentedTabs, StatCard } from '../components/ui';
import { fetchAllSupabaseRows } from '../utils/financialService';
import {
    maskCardCode as maskCardCodeUtil,
    fetchBusinessSettings,
    getTodayLocalVN,
    hasPermission
} from '../utils/helpers';

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
    ticket_type_id: string;
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
    raw_status?: string;
    valid_from: string | null;
    valid_until: string | null;
    remaining_sessions: number | null;
    total_sessions: number | null;
    price_paid: number;
    sold_at: string;
    sold_by_name: string | null;
    source: string | null;
    // Promotion & original info
    original_price: number;
    original_sessions: number | null;
    promo_name: string | null;
    promo_type: string | null;
    promo_value: number | null;
    validity_days: number | null;
    coach_id: string | null;
    coach_name: string | null;
    sport_type: string | null;
    extension_logs?: any[];
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
    const canEditCustomer = hasPermission(profile, 'customers', 'edit');
    const canDeleteCustomer = hasPermission(profile, 'customers', 'delete');
    const canEditPackage = hasPermission(profile, 'packages', 'edit') || canEditCustomer;
    const canDeletePackage = hasPermission(profile, 'packages', 'delete') || canDeleteCustomer;

    const [subTab, setSubTab] = useState<SubTab>('CUSTOMERS');
    const [allPackages, setAllPackages] = useState<PackageRow[]>([]);
    const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
    const [coaches, setCoaches] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');

    // Date filter for Packages tab
    const [dateRange, setDateRange] = useState<DateRange>('THIS_MONTH');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [filterExpiring, setFilterExpiring] = useState(false);

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
    const [importErrors, setImportErrors] = useState<{ row: number; field: string; message: string }[]>([]);
    const [ticketTypesForImport, setTicketTypesForImport] = useState<{ id: string; name: string; category: string }[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Bulk edit
    const [bulkMode, setBulkMode] = useState(false);
    const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkTargetTypeId, setBulkTargetTypeId] = useState('');
    const [bulkProcessing, setBulkProcessing] = useState(false);

    // Check-in history for a package
    const [pkgCheckinHistory, setPkgCheckinHistory] = useState<any[]>([]);
    const [loadingPkgHistory, setLoadingPkgHistory] = useState(false);
    const [showPkgHistory, setShowPkgHistory] = useState(false);

    // Print functionality
    const [printTicket, setPrintTicket] = useState<PrintTicketData | null>(null);
    const [bizInfo, setBizInfo] = useState<{ name: string; address: string; phone: string; logo: string; pool_close_time?: string }>({
        name: 'Hệ Thống Vé Bơi', address: '', phone: '', logo: ''
    });

    useEffect(() => {
        fetchAllData();
        fetchBusinessInfo();
        fetchCoaches();
        // Fetch ticket types for import mapping
        supabase.from('ticket_types').select('id, name, category').in('category', ['MULTI', 'LESSON']).eq('is_active', true)
            .then(({ data }) => { if (data) setTicketTypesForImport(data); });
    }, []);

    async function fetchAllData() {
        const { data: custData } = await fetchAllSupabaseRows<Customer>((fromIdx, toIdx) =>
            supabase
                .from('customers')
                .select('*')
                .order('full_name')
                .order('id', { ascending: true })
                .range(fromIdx, toIdx)
        );
        setAllCustomers((custData || []) as Customer[]);
        await fetchAllPackages();
    }

    async function fetchCoaches() {
        const { data } = await supabase.from('coaches').select('*').eq('is_active', true).order('full_name');
        if (data) setCoaches(data);
    }

    async function fetchPkgCheckinHistory(ticketId: string) {
        setLoadingPkgHistory(true);
        setShowPkgHistory(true);
        try {
            const { data, error } = await supabase
                .from('checkin_logs')
                .select(`
                    id, checked_in_at, status, remaining_sessions,
                    is_new_activation, sport_type,
                    profiles:checked_in_by (full_name)
                `)
                .eq('source_ticket_id', ticketId)
                .order('checked_in_at', { ascending: false })
                .limit(200);
            if (error) { console.error(error); setPkgCheckinHistory([]); }
            else setPkgCheckinHistory(data || []);
        } catch (err) {
            console.error(err);
            setPkgCheckinHistory([]);
        }
        setLoadingPkgHistory(false);
    }

    async function fetchBusinessInfo() {
        const info = await fetchBusinessSettings();
        setBizInfo({
            name: info.business_name || 'Hệ Thống Vé Bơi',
            address: info.business_address || '',
            phone: info.business_phone || '',
            logo: info.business_logo || '',
            pool_close_time: info.pool_close_time || ''
        });
    }

    async function fetchAllPackages() {
        const { data, error } = await fetchAllSupabaseRows<any>((fromIdx, toIdx) =>
            supabase
                .from('tickets')
                .select(`
                    id, ticket_type_id, source, customer_name, customer_phone, card_code, customer_id, status,
                    valid_from, valid_until, remaining_sessions, total_sessions,
                    price_paid, sold_at, package_code, coach_id,
                    customer_name_2, customer_birth_year_2, guardian_name, guardian_phone,
                    ticket_types!inner (name, category, price, session_count, validity_days, sport_type),
                    profiles:sold_by (full_name),
                    promotions:promotion_id (name, type, value),
                    coaches:coach_id (full_name),
                    ticket_extension_logs (id, old_valid_until, new_valid_until, bulk_extensions(closed_start, days_extended))
                `)
                .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
                .neq('source', 'CHECKIN')
                .neq('status', 'CANCELLED')
                .order('sold_at', { ascending: false })
                .order('id', { ascending: true })
                .range(fromIdx, toIdx)
        );

        if (error) { console.error(error); setLoading(false); return; }

        const mapped: PackageRow[] = (data || []).map((t: Record<string, any>) => ({
            id: t.id,
            package_code: t.package_code,
            ticket_type_id: t.ticket_type_id || '',
            type_name: t.ticket_types?.name || '',
            source: t.source || null,
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
            raw_status: t.status,
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
            coach_id: t.coach_id || null,
            coach_name: t.coaches?.full_name || null,
            sport_type: t.ticket_types?.sport_type || null,
            extension_logs: t.ticket_extension_logs || [],
        }));

        setAllPackages(mapped);
        setLoading(false);
    }

    function computeStatus(t: Record<string, any>): string {
        if (t.status === 'CANCELLED') return 'CANCELLED';
        if (t.status === 'EXPIRED') return 'EXPIRED';
        const today = getTodayLocalVN();
        if (t.valid_until && t.valid_until < today) return 'EXPIRED';
        if (t.remaining_sessions !== null && t.remaining_sessions <= 0) return 'EXPIRED';

        // Gói chưa kích hoạt (UNUSED, chưa có ngày bắt đầu và chưa trừ buổi nào) thì giữ nguyên UNUSED
        const isNotStartedYet =
            t.status === 'UNUSED' &&
            !t.valid_from &&
            (t.total_sessions === null || t.remaining_sessions === t.total_sessions);
        if (isNotStartedYet) return 'UNUSED';

        if (t.valid_until) {
            const daysLeft = (new Date(`${t.valid_until}T23:59:59+07:00`).getTime() - Date.now()) / 86400000;
            if (daysLeft <= 7 && daysLeft > 0) return 'EXPIRING';
        }
        if (t.remaining_sessions !== null && t.remaining_sessions <= 3 && t.remaining_sessions > 0) return 'EXPIRING';
        if (t.remaining_sessions !== null && t.total_sessions !== null && t.remaining_sessions < t.total_sessions) return 'IN_USE';
        if (t.status === 'IN' || t.status === 'OUT' || t.status === 'IN_USE') return 'IN_USE';
        return 'UNUSED';
    }

    function maskCardCode(code: string | null): string | null {
        return maskCardCodeUtil(code, profile?.role);
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

    // --- Card code update (Atomic RPC with fallback) ---
    async function handleUpdateCardCode(pkgId: string) {
        const inputCardCode = newCardCode.trim().toUpperCase();
        if (!inputCardCode) { alert('Vui lòng nhập mã thẻ mới!'); return; }
        if (!confirm('Bạn có chắc chắn muốn thay đổi mã thẻ cho khách hàng này?')) return;

        const pkg = allPackages.find(p => p.id === pkgId);
        if (!pkg) return;
        const oldCode = pkg.card_code;

        // Ưu tiên gọi RPC nguyên tử change_customer_card_code (migration 058)
        const { data: rpcRes, error: rpcErr } = await supabase.rpc('change_customer_card_code', {
            p_ticket_id: pkg.id,
            p_customer_id: pkg.customer_id || null,
            p_old_code: oldCode || '',
            p_new_code: inputCardCode,
            p_actor_id: profile?.id || null
        });

        if (!rpcErr && rpcRes) {
            if (!rpcRes.success) {
                alert('Lỗi đổi mã thẻ: ' + (rpcRes.error || 'Không xác định'));
                return;
            }
            setEditingCardPkgId(null);
            setNewCardCode('');
            fetchAllData();
            alert('✅ Đã cập nhật mã thẻ thành công!');
            return;
        }

        // Fallback nếu DB chưa chạy migration 058
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
        } else if (cardRes.status !== 'UNUSED') {
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

        if (oldCode) {
            await supabase.from('tickets').update({ card_code: inputCardCode }).eq('card_code', oldCode);
        } else {
            await supabase.from('tickets').update({ card_code: inputCardCode }).eq('id', pkgId);
        }

        if (pkg.customer_id) {
            await supabase.from('customers').update({ card_code: inputCardCode }).eq('id', pkg.customer_id);
        } else if (pkg.customer_phone) {
            await supabase.from('customers').update({ card_code: inputCardCode }).eq('phone', pkg.customer_phone);
        }

        if (shouldInsertCard) {
            await supabase.from('card_bank').upsert({
                card_code: inputCardCode,
                status: 'USED',
                source: 'MANUAL',
                created_by: profile?.id
            }, { onConflict: 'card_code' });
        } else if (shouldUpdateCardId) {
            await supabase.from('card_bank').update({ status: 'USED' }).eq('id', shouldUpdateCardId);
        }

        if (oldCode && oldCode !== inputCardCode) {
            await supabase.from('card_bank').update({ status: 'REVOKED' }).eq('card_code', oldCode);
        }

        setEditingCardPkgId(null);
        setNewCardCode('');
        fetchAllData();
        alert('✅ Đã cập nhật mã thẻ thành công!');
    }

    // --- Package Editing & Deleting ---
    async function handleUpdatePackage() {
        if (!selectedPkg || !canEditPackage) return;
        if (!confirm('Bạn có chắc chắn muốn lưu các thay đổi này?')) return;

        const updatedRemaining = editSessions === '' ? null : Number(editSessions);
        const updatedTotal = editTotalSessions === '' ? null : Number(editTotalSessions);

        let finalStatus = selectedPkg.raw_status || selectedPkg.status;
        if (finalStatus === 'EXPIRING') finalStatus = 'IN_USE';

        let finalValidFrom = editValidFrom || null;
        let finalValidUntil = editValidUntil || null;

        const isReducingSessions = updatedRemaining !== null && updatedTotal !== null && updatedRemaining < updatedTotal;
        const hasStartOrEndDate = finalValidFrom !== null || finalValidUntil !== null;

        if (
            finalStatus === 'UNUSED' &&
            (isReducingSessions || hasStartOrEndDate)
        ) {
            finalStatus = 'IN_USE';
            if (!finalValidFrom) {
                finalValidFrom = getTodayLocalVN();

                if (!finalValidUntil && selectedPkg.validity_days) {
                    const exp = new Date(`${finalValidFrom}T00:00:00+07:00`);
                    exp.setDate(exp.getDate() + selectedPkg.validity_days);
                    finalValidUntil = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`;
                }
            }
        }

        const today = getTodayLocalVN();
        const isDateExpired = finalValidUntil && finalValidUntil < today;
        const isSessionExpired = updatedRemaining !== null && updatedRemaining <= 0;

        if (isDateExpired || isSessionExpired) {
            finalStatus = 'EXPIRED';
        } else if (finalStatus === 'EXPIRED') {
            finalStatus = finalValidFrom ? 'IN_USE' : 'UNUSED';
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
        if (!selectedPkg || !canDeletePackage) return;
        if (!confirm('⚠️ CẢNH BÁO: Hành động này sẽ XÓA VĨNH VIỄN gói thẻ này cùng toàn bộ lịch sử quẹt thẻ liên quan. Bạn có chắc chắn muốn tiếp tục?')) return;
        if (!confirm('Hỏi lại lần cuối: Bạn thực sự muốn XÓA VĨNH VIỄN gói thẻ này? Dữ liệu không thể khôi phục!')) return;

        // 1. Gỡ tham chiếu ở checkin_logs, promotion_usage và scan_logs để tránh lỗi khóa ngoại
        await supabase.from('checkin_logs').update({ source_ticket_id: null }).eq('source_ticket_id', selectedPkg.id);
        await supabase.from('promotion_usage').update({ ticket_id: null }).eq('ticket_id', selectedPkg.id);
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
        if (!canDeleteCustomer) return;

        if (c.totalPackages > 0) {
            alert(`⚠️ Không thể xóa khách hàng này!\n\nKhách hàng đang có ${c.totalPackages} gói thẻ. Theo chính sách an toàn dữ liệu, bạn cần phải xóa các gói thẻ này trước khi xóa hồ sơ khách hàng.`);
            return;
        }

        if (!confirm(`⚠️ CẢNH BÁO: Xóa hồ sơ khách hàng "${c.name}"?\nHành động này không thể hoàn tác.`)) return;

        await supabase.from('checkin_logs').update({ customer_id: null }).eq('customer_id', c.id);
        await supabase.from('promotion_usage').update({ customer_id: null }).eq('customer_id', c.id);
        await supabase.from('tickets').update({ customer_id: null }).eq('customer_id', c.id);

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
            const criticalErrors: { row: number; field: string; message: string }[] = [];

            const allParsed = rows.map((r: any, idx: number) => {
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

                // --- Lỗi nghiêm trọng (chặn import) ---
                if (!name) criticalErrors.push({ row: rowNum, field: 'Tên KH', message: 'Thiếu tên khách hàng — bắt buộc phải có' });
                if (!card) criticalErrors.push({ row: rowNum, field: 'Mã thẻ', message: 'Thiếu mã thẻ — bắt buộc phải có' });
                if (name && card && remaining > totalSessions && totalSessions > 0) criticalErrors.push({ row: rowNum, field: 'Buổi còn lại', message: `Buổi còn lại (${remaining}) lớn hơn Tổng buổi (${totalSessions})` });
                if (validFrom && validUntil && validFrom > validUntil) criticalErrors.push({ row: rowNum, field: 'Ngày', message: 'Ngày bắt đầu lớn hơn Ngày kết thúc' });

                // --- Cảnh báo (cho phép bỏ qua) ---
                if (name && card && !phone) warnings.push({ row: rowNum, field: 'SĐT', message: 'Không có SĐT — nên bổ sung để dễ tìm kiếm' });
                if (name && card && totalSessions <= 0) warnings.push({ row: rowNum, field: 'Tổng buổi', message: 'Tổng buổi = 0 → sẽ không giới hạn lượt' });

                return { name, phone, card_code: card, package_type: pkgType.includes('LESSON') ? 'LESSON' : 'MULTI', pkg_name: pkgName, total_sessions: totalSessions, remaining, valid_from: validFrom, valid_until: validUntil, sold_at: soldAtStr };
            });

            const parsed = allParsed.filter(r => r.name && r.card_code);

            // Check for duplicate card codes in file
            const cardCounts = new Map<string, number>();
            parsed.forEach(r => cardCounts.set(r.card_code, (cardCounts.get(r.card_code) || 0) + 1));
            cardCounts.forEach((count, code) => {
                if (count > 1) criticalErrors.push({ row: 0, field: 'Mã thẻ', message: `Mã thẻ "${code}" bị trùng ${count} lần trong file — mỗi mã thẻ chỉ được xuất hiện 1 lần` });
            });

            if (allParsed.length === 0) {
                alert('❌ Không tìm thấy dòng dữ liệu nào trong file!\n\nMỗi dòng cần có ít nhất "Tên KH" và "Mã thẻ".\nBấm "Tải Template" để lấy file mẫu.');
                return;
            }

            setImportErrors(criticalErrors);
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
                let matchType: typeof ticketTypesForImport[0] | undefined = undefined;
                if (row.pkg_name) {
                    // a. Exact match by name + category
                    matchType = ticketTypesForImport.find(t => t.name.toLowerCase() === row.pkg_name.toLowerCase() && t.category === row.package_type);
                    // b. Partial match (tên gói chứa từ khóa hoặc ngược lại)
                    if (!matchType) {
                        matchType = ticketTypesForImport.find(t =>
                            t.category === row.package_type && (
                                t.name.toLowerCase().includes(row.pkg_name.toLowerCase()) ||
                                row.pkg_name.toLowerCase().includes(t.name.toLowerCase())
                            )
                        );
                    }
                    // c. Match by name only (bỏ qua category)
                    if (!matchType) {
                        matchType = ticketTypesForImport.find(t => t.name.toLowerCase() === row.pkg_name.toLowerCase());
                    }
                    // d. Nếu vẫn không tìm thấy → BÁO LỖI, không tự gán gói khác
                    if (!matchType) {
                        const availableNames = ticketTypesForImport.filter(t => t.category === row.package_type).map(t => `"${t.name}"`).join(', ');
                        errors.push(`${row.card_code}: Tên gói "${row.pkg_name}" không khớp gói nào trong hệ thống. Các gói ${row.package_type} hiện có: ${availableNames || 'chưa có'}`);
                        continue;
                    }
                } else {
                    // Không ghi tên gói → lấy gói đầu tiên theo category
                    matchType = ticketTypesForImport.find(t => t.category === row.package_type);
                    if (!matchType) { errors.push(`${row.card_code}: Không tìm thấy loại gói nào thuộc category ${row.package_type}`); continue; }
                }

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

                // 4. Add card to card_bank (source='MANUAL') or update status to USED
                const { data: existingCard } = await supabase.from('card_bank').select('id, status').eq('card_code', row.card_code).maybeSingle();
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
                } else if (existingCard.status !== 'USED') {
                    await supabase.from('card_bank').update({ status: 'USED' }).eq('id', existingCard.id);
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
        (!filterExpiring || p.status === 'EXPIRING') &&
        (!searchTerm ||
        (p.customer_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.customer_phone || '').includes(searchTerm) ||
        (p.card_code || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (p.package_code || '').toLowerCase().includes(searchTerm.toLowerCase()))
    );

    function exportPackagesExcel(pkgs: PackageRow[]) {
        const data = pkgs.map(p => ({
            'Mã gói': p.package_code || '—',
            'Khách hàng': p.customer_name || '—',
            'SĐT': p.customer_phone || '—',
            'Mã thẻ': p.card_code || '—',
            'Loại gói': p.type_name || '—',
            'Lượt còn': p.remaining_sessions !== null ? `${p.remaining_sessions}/${p.total_sessions || p.remaining_sessions}` : 'Không giới hạn',
            'Hiệu lực': `${fmtDate(p.valid_from)} → ${fmtDate(p.valid_until)}`,
            'Giá bán': p.price_paid,
            'Trạng thái': getStatusBadge(p.status).text,
            'Ngày mua': new Date(p.sold_at).toLocaleString('vi-VN')
        }));
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'GoiThe');
        XLSX.writeFile(wb, `Danh_sach_goi_the_${new Date().toISOString().slice(0, 10)}.xlsx`);
    }

    const activeCustomerDrawer = expandedId ? customers.find(c => c.id === expandedId) || null : null;

    return (
        <div className="page-container">
            <PageHeader
                title="Khách Hàng & Gói Thẻ"
                subtitle="Quản lý hồ sơ khách hàng, gói thẻ tháng, thẻ nhiều buổi và lịch sử sử dụng"
                actions={
                    <>
                        {isAdmin && (
                            <>
                                <input type="file" ref={fileInputRef} accept=".xlsx,.xls" style={{ display: 'none' }} onChange={handleFileSelect} />
                                <button type="button" className="btn btn-ghost btn-sm" onClick={downloadImportTemplate}>
                                    📋 Tải Template
                                </button>
                                <button type="button" className="btn btn-outline btn-sm" onClick={() => fileInputRef.current?.click()}>
                                    📥 Import Excel
                                </button>
                            </>
                        )}
                        <SegmentedTabs
                            size="sm"
                            tabs={[
                                { key: 'CUSTOMERS', label: 'Khách hàng', icon: '👤', count: customers.length },
                                { key: 'PACKAGES', label: 'Gói thẻ', icon: '📦', count: allPackages.length },
                            ]}
                            activeKey={subTab}
                            onChange={(k) => { setSubTab(k as SubTab); setSearchTerm(''); setExpandedId(null); }}
                        />
                    </>
                }
            />

            {/* Search */}
            <div className="ui-filter-bar">
                <input
                    type="text"
                    className="ui-search-input"
                    placeholder={subTab === 'CUSTOMERS' ? '🔍 Tìm theo tên, SĐT, mã thẻ...' : '🔍 Tìm theo tên, SĐT, mã thẻ, mã gói...'}
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            {/* ====================== TAB: CUSTOMERS ====================== */}
            {subTab === 'CUSTOMERS' && (
                <>
                    <div className="stats-grid">
                        <StatCard label="Tổng khách hàng" value={filteredCustomers.length} tone="blue" icon="👥" />
                        <StatCard label="Đang hoạt động" value={filteredCustomers.filter(c => c.overallStatus === 'ACTIVE').length} tone="green" icon="✅" />
                        <StatCard label="Sắp hết hạn" value={filteredCustomers.filter(c => c.overallStatus === 'EXPIRING').length} tone="amber" icon="⚠️" />
                    </div>

                    {filteredCustomers.length === 0 ? (
                        <div className="ui-card">
                            <EmptyState icon="👤" title="Chưa có khách hàng" description="Không tìm thấy khách hàng phù hợp với từ khóa." />
                        </div>
                    ) : (
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Khách hàng</th>
                                        <th>Mã thẻ</th>
                                        <th>SĐT</th>
                                        <th>Số gói</th>
                                        <th>Trạng thái</th>
                                        <th style={{ textAlign: 'right' }}>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredCustomers.map((c) => {
                                        const st = getStatusBadge(c.overallStatus);
                                        const hk = allCustomers.find(x => x.id === c.id)?.hotkey;
                                        return (
                                            <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setExpandedId(c.id)}>
                                                <td>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                        <div style={{ width: '34px', height: '34px', borderRadius: '999px', background: 'var(--gradient-blue)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, flexShrink: 0 }}>
                                                            {(c.name || '?')[0].toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <div style={{ fontWeight: 600 }}>
                                                                {c.name}
                                                                {hk && <Badge variant="blue" className="ml-2">⌨ {hk}</Badge>}
                                                            </div>
                                                            {c.email && <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{c.email}</div>}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td><code style={{ fontSize: '12px', background: 'var(--bg-subtle)', padding: '2px 7px', borderRadius: '5px' }}>{maskCardCode(c.card_code)}</code></td>
                                                <td className="tabular-nums">{c.phone || '—'}</td>
                                                <td className="tabular-nums"><strong>{c.activePackages}</strong> / {c.totalPackages} gói</td>
                                                <td>
                                                    <span className="ui-badge" style={{ background: st.bg, color: st.color }}>{st.text}</span>
                                                </td>
                                                <td style={{ textAlign: 'right', color: 'var(--accent-blue)', fontWeight: 600 }}>
                                                    Xem hồ sơ →
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}

            {/* ====================== TAB: PACKAGES ====================== */}
            {subTab === 'PACKAGES' && (
                <>
                    <div className="ui-filter-bar">
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
                        <button type="button" className={`btn btn-sm ${filterExpiring ? 'btn-warning' : 'btn-outline'}`}
                            onClick={() => setFilterExpiring(!filterExpiring)}>
                            ⚠️ Sắp hết hạn
                        </button>
                        {isAdmin && (
                            <button type="button" className={`btn btn-sm ${bulkMode ? 'btn-primary' : 'btn-outline'}`}
                                onClick={() => { setBulkMode(!bulkMode); setBulkSelected(new Set()); }}>
                                {bulkMode ? '✕ Thoát chọn' : '☑️ Sửa hàng loạt'}
                            </button>
                        )}
                        <button type="button" className="btn btn-outline btn-sm" style={{ marginLeft: 'auto' }}
                            onClick={() => exportPackagesExcel(filteredPackages)}>
                            ⬇️ Xuất Excel
                        </button>
                    </div>

                    <div className="stats-grid">
                        <StatCard label="Tổng gói" value={filteredPackages.length} tone="purple" />
                        <StatCard label="Đang dùng" value={filteredPackages.filter(p => p.status === 'IN_USE' || p.status === 'UNUSED').length} tone="green" />
                        <StatCard label="Doanh thu" value={fmt(filteredPackages.reduce((s, p) => s + p.price_paid, 0))} tone="blue" />
                    </div>

                    {bulkMode && (
                        <div className="ui-callout ui-callout-blue" style={{ display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap' }}>
                            <input type="checkbox"
                                checked={filteredPackages.length > 0 && bulkSelected.size === filteredPackages.length}
                                onChange={e => {
                                    if (e.target.checked) setBulkSelected(new Set(filteredPackages.map(p => p.id)));
                                    else setBulkSelected(new Set());
                                }}
                                style={{ width: '17px', height: '17px', cursor: 'pointer' }} />
                            <span style={{ fontSize: '13px', fontWeight: 600 }}>
                                Đã chọn <strong className="tabular-nums">{bulkSelected.size}</strong> / {filteredPackages.length} gói
                            </span>
                            <div style={{ flex: 1 }} />
                            <button type="button" className="btn btn-primary btn-sm" disabled={bulkSelected.size === 0}
                                onClick={() => { setBulkTargetTypeId(''); setShowBulkModal(true); }}>
                                ✏️ Đổi loại gói ({bulkSelected.size})
                            </button>
                            <button type="button" className="btn btn-danger btn-sm"
                                disabled={bulkSelected.size === 0}
                                onClick={async () => {
                                    if (!confirm(`⚠️ CẢNH BÁO: Bạn sắp XÓA VĨNH VIỄN ${bulkSelected.size} gói thẻ đã chọn cùng toàn bộ lịch sử quẹt thẻ liên quan.\n\nHành động này KHÔNG THỂ hoàn tác. Bạn có chắc chắn?`)) return;
                                    if (!confirm('Hỏi lại lần cuối: Bạn thực sự muốn XÓA VĨNH VIỄN các gói đã chọn?')) return;
                                    const ids = Array.from(bulkSelected);
                                    await supabase.from('checkin_logs').update({ source_ticket_id: null }).in('source_ticket_id', ids);
                                    await supabase.from('promotion_usage').update({ ticket_id: null }).in('ticket_id', ids);
                                    await supabase.from('scan_logs').delete().in('ticket_id', ids);
                                    const { error } = await supabase.from('tickets').delete().in('id', ids);
                                    if (error) { alert('Lỗi xóa: ' + error.message); return; }
                                    alert(`✅ Đã xóa ${ids.length} gói thành công!`);
                                    setBulkSelected(new Set());
                                    fetchAllPackages();
                                }}>
                                🗑️ Xóa ({bulkSelected.size})
                            </button>
                        </div>
                    )}

                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    {bulkMode && <th style={{ width: '40px', textAlign: 'center' }}></th>}
                                    <th>Mã gói</th>
                                    <th>Khách hàng</th>
                                    <th>SĐT</th>
                                    {isAdmin && <th>Mã thẻ</th>}
                                    <th>Loại</th>
                                    <th>Trạng thái</th>
                                    <th>Lượt còn</th>
                                    <th>Hiệu lực</th>
                                    <th style={{ textAlign: 'right' }}>Giá</th>
                                    <th>Ngày mua</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPackages.length === 0 ? (
                                    <tr><td colSpan={isAdmin ? (bulkMode ? 11 : 10) : (bulkMode ? 10 : 9)} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Không có gói thẻ nào trong khoảng thời gian này.</td></tr>
                                ) : filteredPackages.map(t => {
                                    const st = getStatusBadge(t.status);
                                    const isChecked = bulkSelected.has(t.id);
                                    return (
                                        <tr key={t.id}
                                            style={{ background: isChecked ? 'var(--accent-blue-soft)' : undefined, cursor: 'pointer' }}
                                            onClick={() => {
                                                if (bulkMode) {
                                                    const next = new Set(bulkSelected);
                                                    if (next.has(t.id)) next.delete(t.id); else next.add(t.id);
                                                    setBulkSelected(next);
                                                } else {
                                                    setSelectedPkg(t);
                                                }
                                            }}>
                                            {bulkMode && (
                                                <td style={{ textAlign: 'center' }}>
                                                    <input type="checkbox" checked={isChecked} readOnly style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                                                </td>
                                            )}
                                            <td style={{ fontWeight: 700, minWidth: '80px' }}>{t.package_code || '—'}</td>
                                            <td style={{ fontWeight: 600 }}>{t.customer_name || '—'}</td>
                                            <td className="tabular-nums">{t.customer_phone || '—'}</td>
                                            {isAdmin && <td><code style={{ fontSize: '12px' }}>{t.card_code || '—'}</code></td>}
                                            <td>
                                                <Badge variant={t.category === 'MONTHLY' ? 'blue' : t.category === 'LESSON' ? 'green' : 'amber'}>{t.type_name}</Badge>
                                                {t.extension_logs && t.extension_logs.length > 0 && (
                                                    <div style={{ marginTop: '4px' }}>
                                                        <Badge variant="green">
                                                            🔄 +{t.extension_logs.reduce((acc, log) => acc + (log.bulk_extensions?.days_extended || 0), 0)} ngày
                                                        </Badge>
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <span className="ui-badge" style={{ background: st.bg, color: st.color }}>{st.text}</span>
                                            </td>
                                            <td className="tabular-nums" style={{ fontWeight: 700, color: t.remaining_sessions !== null && t.remaining_sessions <= 3 ? 'var(--accent-red)' : undefined }}>
                                                {t.remaining_sessions !== null ? `${t.remaining_sessions}/${t.total_sessions ?? t.remaining_sessions}` : '∞'}
                                            </td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.valid_from)} → {fmtDate(t.valid_until)}</td>
                                            <td className="tabular-nums" style={{ fontWeight: 700, textAlign: 'right' }}>{fmt(t.price_paid)}</td>
                                            <td style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.sold_at)}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </>
            )}

            {/* SLIDE-OVER CUSTOMER PROFILE DRAWER */}
            <Drawer
                open={Boolean(activeCustomerDrawer)}
                onClose={() => { setExpandedId(null); setEditingCardPkgId(null); setNewCardCode(''); }}
                title={activeCustomerDrawer?.name || 'Hồ sơ khách hàng'}
                subtitle={activeCustomerDrawer ? `Thẻ: ${maskCardCode(activeCustomerDrawer.card_code)} · SĐT: ${activeCustomerDrawer.phone || '—'}` : undefined}
                width={520}
                footer={
                    activeCustomerDrawer ? (
                        <>
                            {canEditCustomer && (
                                <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => openEditCustomer(activeCustomerDrawer)}>
                                    ✏️ Sửa thông tin
                                </button>
                            )}
                            {canDeleteCustomer && (
                                <button type="button" className="btn btn-danger" onClick={() => handleDeleteCustomer(activeCustomerDrawer)}>
                                    🗑️ Xóa KH
                                </button>
                            )}
                        </>
                    ) : undefined
                }
            >
                {activeCustomerDrawer && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <div className="ui-callout">
                            <div className="ui-detail-list">
                                <div className="ui-detail-row"><span className="ui-detail-label">Họ tên</span><strong>{activeCustomerDrawer.name}</strong></div>
                                <div className="ui-detail-row"><span className="ui-detail-label">Số điện thoại</span><strong className="tabular-nums">{activeCustomerDrawer.phone || '—'}</strong></div>
                                <div className="ui-detail-row"><span className="ui-detail-label">Mã thẻ</span><code>{maskCardCode(activeCustomerDrawer.card_code)}</code></div>
                                <div className="ui-detail-row"><span className="ui-detail-label">Gói đang dùng</span><strong>{activeCustomerDrawer.activePackages} / {activeCustomerDrawer.totalPackages}</strong></div>
                            </div>
                        </div>

                        <div>
                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '10px' }}>
                                📦 Danh sách gói thẻ ({activeCustomerDrawer.totalPackages})
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {activeCustomerDrawer.packages.map(p => {
                                    const pst = getStatusBadge(p.status);
                                    return (
                                        <div key={p.id} className="ui-card" style={{ padding: '14px', cursor: 'pointer' }} onClick={() => setSelectedPkg(p)}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                <strong style={{ fontSize: '14px' }}>{p.type_name}</strong>
                                                <span className="ui-badge" style={{ background: pst.bg, color: pst.color }}>{pst.text}</span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: 'var(--text-secondary)', flexWrap: 'wrap', gap: '6px' }}>
                                                <span>{fmtDate(p.valid_from)} → {fmtDate(p.valid_until)}</span>
                                                <span className="tabular-nums" style={{ fontWeight: 700, color: p.remaining_sessions !== null && p.remaining_sessions <= 3 ? 'var(--accent-red)' : 'var(--text-primary)' }}>
                                                    {p.remaining_sessions !== null ? `${p.remaining_sessions}/${p.total_sessions ?? p.remaining_sessions} lượt` : '∞ lượt'}
                                                </span>
                                            </div>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '12px' }}>
                                                <span className="tabular-nums" style={{ fontWeight: 700 }}>{fmt(p.price_paid)}</span>
                                                <span style={{ color: 'var(--accent-blue)', fontWeight: 600 }}>Chi tiết →</span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {isAdmin && (
                            <div className="ui-callout">
                                {editingCardPkgId && activeCustomerDrawer.packages.some(p => p.id === editingCardPkgId) ? (
                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                        <input type="text" className="input" value={newCardCode} onChange={e => setNewCardCode(normalizeScannerInput(e.target.value))}
                                            placeholder="Quét hoặc nhập mã thẻ mới" autoFocus style={{ flex: 1, minWidth: '160px', fontWeight: 700 }} />
                                        <button type="button" className="btn btn-primary btn-sm" onClick={() => handleUpdateCardCode(editingCardPkgId)}>Lưu</button>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditingCardPkgId(null); setNewCardCode(''); }}>Hủy</button>
                                    </div>
                                ) : (
                                    <button type="button" className="btn btn-outline btn-sm btn-full"
                                        onClick={() => { setEditingCardPkgId(activeCustomerDrawer.packages[0]?.id || null); setNewCardCode(activeCustomerDrawer.packages[0]?.card_code || ''); }}>
                                        ✏️ Đổi mã thẻ (mất thẻ)
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </Drawer>

            {/* Detail Modal */}
            {selectedPkg && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => { setSelectedPkg(null); setIsEditingPkg(false); setShowPkgHistory(false); setPkgCheckinHistory([]); }}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '28px', maxWidth: '500px', width: '95%', boxShadow: 'var(--shadow-lg)', maxHeight: '85vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>{isEditingPkg ? '✏️ Chỉnh sửa Gói' : '📋 Chi tiết Gói Bơi'}</h2>
                            <button onClick={() => { setSelectedPkg(null); setIsEditingPkg(false); setShowPkgHistory(false); setPkgCheckinHistory([]); }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>✕</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {[
                                { label: 'Mã gói', value: selectedPkg.package_code || '—' },
                                ...(() => {
                                    if (selectedPkg.category !== 'LESSON') return [{ label: 'Họ tên', value: selectedPkg.customer_name || '—' }];
                                    const names = (selectedPkg.customer_name || '').split(' + ');
                                    if (names.length <= 1) {
                                        return [
                                            { label: 'Học viên 1', value: selectedPkg.customer_name || '—' },
                                            ...(selectedPkg.customer_name_2 ? [{ label: 'Học viên 2', value: `${selectedPkg.customer_name_2} - NS: ${selectedPkg.customer_birth_year_2 || 'N/A'}` }] : [])
                                        ];
                                    }
                                    return names.map((n: string, idx: number) => {
                                        let val = n;
                                        if (idx === 1 && selectedPkg.customer_name_2 && selectedPkg.customer_birth_year_2) val = `${n} - NS: ${selectedPkg.customer_birth_year_2}`;
                                        return { label: `Học viên ${idx + 1}`, value: val };
                                    });
                                })(),
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
                                ...(selectedPkg.category === 'LESSON' ? [{ label: '🏊 HLV phụ trách', value: selectedPkg.coach_name || 'Chưa gán' }] : []),
                            ].map(row => (
                                <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border-color)', fontSize: '14px' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>{row.label}</span>
                                    {typeof row.value === 'string' || typeof row.value === 'number' ? <strong>{row.value}</strong> : row.value}
                                </div>
                            ))}
                        </div>

                        {/* Promotion breakdown */}
                        <div className="ui-callout" style={{ marginTop: '16px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--text-secondary)' }}>🎁 Thông tin gói &amp; KM</div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    <span style={{ color: 'var(--text-secondary)' }}>Gói gốc</span>
                                    <span>{selectedPkg.type_name} — {fmt(selectedPkg.original_price)}{selectedPkg.original_sessions ? ` (${selectedPkg.original_sessions} lượt)` : ''}</span>
                                </div>
                                {selectedPkg.promo_name ? (
                                    <>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>Khuyến mãi</span>
                                            <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>
                                                🎉 {selectedPkg.promo_name}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                            <span style={{ color: 'var(--text-secondary)' }}>Ưu đãi</span>
                                            <span style={{ color: 'var(--accent-green)', fontWeight: 700 }}>
                                                {selectedPkg.promo_type === 'AMOUNT' && `−${fmt(selectedPkg.promo_value!)}`}
                                                {selectedPkg.promo_type === 'PERCENT' && `−${selectedPkg.promo_value}%`}
                                                {selectedPkg.promo_type === 'BONUS_SESSION' && `+${selectedPkg.promo_value} lượt`}
                                            </span>
                                        </div>
                                        <div style={{ borderTop: '1px dashed var(--border-color)', paddingTop: '6px', display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                            <span>Sau KM</span>
                                            <span>
                                                {fmt(selectedPkg.price_paid)}
                                                {selectedPkg.total_sessions !== null && ` (${selectedPkg.total_sessions} lượt)`}
                                            </span>
                                        </div>
                                    </>
                                ) : (
                                    <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Không áp dụng khuyến mãi</div>
                                )}
                            </div>
                        </div>

                        {/* Tra cứu lịch sử check-in */}
                        <div style={{ marginTop: '16px' }}>
                            {!showPkgHistory ? (
                                <button
                                    type="button"
                                    className="btn btn-secondary btn-full"
                                    onClick={() => fetchPkgCheckinHistory(selectedPkg.id)}
                                    disabled={loadingPkgHistory}
                                >
                                    📋 {loadingPkgHistory ? 'Đang tải...' : 'Tra cứu lịch sử Check-in'}
                                </button>
                            ) : (
                                <div className="ui-callout ui-callout-blue">
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                        <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--accent-blue)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            📋 Lịch sử Check-in
                                            <Badge variant="blue">{pkgCheckinHistory.filter(h => h.status !== 'CANCELLED').length} lượt</Badge>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => { setShowPkgHistory(false); setPkgCheckinHistory([]); }}
                                            style={{ background: 'none', border: 'none', fontSize: '14px', cursor: 'pointer', color: 'var(--text-muted)', padding: '2px 6px' }}
                                        >✕</button>
                                    </div>
                                    {loadingPkgHistory ? (
                                        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '13px' }}>⏳ Đang tải...</div>
                                    ) : pkgCheckinHistory.length === 0 ? (
                                        <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--text-muted)', fontSize: '13px' }}>
                                            <div style={{ fontSize: '24px', marginBottom: '6px' }}>📭</div>
                                            Chưa có lượt check-in nào cho gói thẻ này.
                                        </div>
                                    ) : (
                                        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                                            <table>
                                                <thead>
                                                    <tr>
                                                        <th>#</th>
                                                        <th>Thời gian</th>
                                                        <th style={{ textAlign: 'center' }}>Trạng thái</th>
                                                        <th>NV</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {pkgCheckinHistory.map((h, idx) => {
                                                        const t = new Date(h.checked_in_at);
                                                        const isCancelled = h.status === 'CANCELLED';
                                                        const staffName = (h.profiles as any)?.full_name || '—';
                                                        const displayIdx = pkgCheckinHistory.filter((x, i) => i >= idx && x.status !== 'CANCELLED').length;
                                                        return (
                                                            <tr key={h.id} style={{ opacity: isCancelled ? 0.7 : 1 }}>
                                                                <td style={{ fontWeight: 600 }}>{isCancelled ? '—' : displayIdx}</td>
                                                                <td style={{ whiteSpace: 'nowrap' }} className="tabular-nums">
                                                                    <strong>{t.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</strong>
                                                                    <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontSize: '11px' }}>
                                                                        {t.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: '2-digit' })}
                                                                    </span>
                                                                </td>
                                                                <td style={{ textAlign: 'center' }}>
                                                                    {isCancelled ? <Badge variant="red">🔄 Đã hủy</Badge> : <Badge variant="green">✅</Badge>}
                                                                </td>
                                                                <td style={{ color: 'var(--text-secondary)', fontSize: '11.5px' }}>{staffName}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Cập nhật HLV */}
                        {selectedPkg.category === 'LESSON' && (
                            <div className="ui-callout ui-callout-blue" style={{ marginTop: '16px' }}>
                                <div style={{ fontSize: '13px', fontWeight: 700, marginBottom: '10px', color: 'var(--accent-blue)' }}>🏊 Cập nhật Huấn luyện viên</div>
                                <select
                                    className="input"
                                    value={selectedPkg.coach_id || ''}
                                    onChange={async (e) => {
                                        const newCoachId = e.target.value || null;
                                        const { error } = await supabase.from('tickets').update({ coach_id: newCoachId }).eq('id', selectedPkg.id);
                                        if (error) {
                                            alert('Lỗi cập nhật HLV: ' + error.message);
                                        } else {
                                            const coachObj = coaches.find(c => c.id === newCoachId);
                                            setSelectedPkg({ ...selectedPkg, coach_id: newCoachId, coach_name: coachObj?.full_name || null });
                                            fetchAllPackages();
                                            alert('✅ Đã cập nhật HLV thành công!');
                                        }
                                    }}
                                >
                                    <option value="">-- Chưa gán HLV --</option>
                                    {coaches
                                        .filter(c => !c.specialty || (selectedPkg.sport_type === 'BASKETBALL' ? c.specialty === 'Bóng rổ' : c.specialty === 'Bơi lội'))
                                        .map(c => (
                                        <option key={c.id} value={c.id}>{c.full_name}{c.specialty ? ` - ${c.specialty}` : ''}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Action Buttons theo ma trận phân quyền */}
                        {!isEditingPkg && (
                            <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                                <button type="button" className="btn btn-outline" style={{ flex: 1 }}
                                    onClick={() => setPrintTicket(selectedPkg as any)}>
                                    🖨️ In thẻ QR
                                </button>
                                {canEditPackage && (
                                    <button type="button" className="btn btn-secondary" style={{ flex: 1 }}
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
                                )}
                                {canDeletePackage && (
                                    <button type="button" className="btn btn-danger" style={{ flex: 1 }} onClick={handleDeletePackage}>
                                        🗑️ Xóa gói
                                    </button>
                                )}
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
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '800px' }}>
                        <h2 style={{ fontSize: '19px', marginBottom: '16px' }}>📥 Import Khách Hàng Cũ</h2>

                        {!importResult ? (
                            <>
                                {/* === CÓ LỖI NGHIÊM TRỌNG — CHẶN IMPORT === */}
                                {importErrors.length > 0 ? (
                                    <>
                                        <div style={{ padding: '16px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', marginBottom: '16px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                                <span style={{ fontSize: '22px' }}>🚫</span>
                                                <div>
                                                    <div style={{ fontWeight: 700, color: '#991b1b', fontSize: '15px' }}>File có {importErrors.length} lỗi — không thể import</div>
                                                    <div style={{ fontSize: '12px', color: '#b91c1c' }}>Vui lòng sửa các lỗi bên dưới trong file Excel rồi tải lại.</div>
                                                </div>
                                            </div>
                                            <div style={{ maxHeight: '200px', overflowY: 'auto', background: '#fff', borderRadius: '8px', border: '1px solid #fecaca' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                    <thead>
                                                        <tr style={{ background: '#fef2f2' }}>
                                                            <th style={{ ...thS, color: '#991b1b', fontSize: '11px' }}>Dòng</th>
                                                            <th style={{ ...thS, color: '#991b1b', fontSize: '11px' }}>Cột</th>
                                                            <th style={{ ...thS, color: '#991b1b', fontSize: '11px' }}>Mô tả lỗi</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {importErrors.map((err, i) => (
                                                            <tr key={i} style={{ borderBottom: '1px solid #fecaca' }}>
                                                                <td style={{ ...tdS, fontSize: '12px', color: '#991b1b', fontWeight: 700 }}>{err.row > 0 ? `Dòng ${err.row}` : 'Toàn file'}</td>
                                                                <td style={{ ...tdS, fontSize: '12px', color: '#991b1b' }}>{err.field}</td>
                                                                <td style={{ ...tdS, fontSize: '12px', color: '#991b1b' }}>{err.message}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>

                                        {importWarnings.length > 0 && (
                                            <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '12px' }}>
                                                <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>⚠️ Cảnh báo thêm ({importWarnings.length}):</div>
                                                <ul style={{ fontSize: '12px', color: '#92400e', paddingLeft: '20px', margin: 0, maxHeight: '80px', overflowY: 'auto' }}>
                                                    {importWarnings.map((w, i) => (
                                                        <li key={i}>{w.row > 0 ? `Dòng ${w.row}` : 'File'} — <b>{w.field}</b>: {w.message}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button className="btn btn-outline" onClick={() => fileInputRef.current?.click()} style={{ flex: 1, borderColor: '#3b82f6', color: '#2563eb' }}>
                                                📂 Tải lại file đã sửa
                                            </button>
                                            <button className="btn btn-ghost" onClick={downloadImportTemplate} style={{ padding: '8px 16px', fontSize: '13px' }}>
                                                📋 Tải Template mẫu
                                            </button>
                                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowImportModal(false); setImportData([]); setImportWarnings([]); setImportErrors([]); }}>
                                                Đóng
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    /* === KHÔNG CÓ LỖI — CHO PHÉP IMPORT === */
                                    <>
                                        <div style={{ padding: '14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '10px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ fontSize: '22px' }}>✅</span>
                                            <div>
                                                <div style={{ fontWeight: 700, color: '#166534', fontSize: '15px' }}>File hợp lệ — Sẵn sàng import</div>
                                                <div style={{ fontSize: '12px', color: '#15803d' }}>Tìm thấy <b>{importData.length}</b> khách hàng hợp lệ. Xem lại trước khi xác nhận.</div>
                                            </div>
                                        </div>

                                        {importWarnings.length > 0 && (
                                            <div style={{ padding: '12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', marginBottom: '12px' }}>
                                                <div style={{ fontWeight: 700, color: '#92400e', fontSize: '13px', marginBottom: '6px' }}>⚠️ Lưu ý ({importWarnings.length}):</div>
                                                <ul style={{ fontSize: '12px', color: '#92400e', paddingLeft: '20px', margin: 0, maxHeight: '100px', overflowY: 'auto' }}>
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
                                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => { setShowImportModal(false); setImportData([]); setImportWarnings([]); setImportErrors([]); }} disabled={importing}>
                                                Hủy
                                            </button>
                                        </div>
                                    </>
                                )}
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
                                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { setShowImportModal(false); setImportData([]); setImportResult(null); setImportErrors([]); }}>
                                    Đóng
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* ===== BULK EDIT MODAL ===== */}
            {showBulkModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '580px' }}>
                        <h2 style={{ fontSize: '19px', marginBottom: '16px' }}>✏️ Đổi loại gói hàng loạt</h2>

                        <div className="ui-callout ui-callout-blue" style={{ marginBottom: '16px' }}>
                            Đang chọn <b>{bulkSelected.size}</b> gói thẻ để đổi loại gói.
                        </div>

                        {/* Hiển thị danh sách gói đã chọn (tóm tắt) */}
                        <div style={{ marginBottom: '16px' }}>
                            <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '8px' }}>Gói hiện tại của các thẻ đã chọn:</div>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {(() => {
                                    const typeCounts = new Map<string, number>();
                                    allPackages.filter(p => bulkSelected.has(p.id)).forEach(p => {
                                        typeCounts.set(p.type_name, (typeCounts.get(p.type_name) || 0) + 1);
                                    });
                                    return Array.from(typeCounts.entries()).map(([name, count]) => (
                                        <span key={name} style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 10px', borderRadius: '16px', fontSize: '12px', fontWeight: 600 }}>
                                            {name} × {count}
                                        </span>
                                    ));
                                })()}
                            </div>
                        </div>

                        {/* Chọn loại gói mới */}
                        <div style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: 'var(--text-primary)' }}>Chọn loại gói MỚI:</label>
                            <select value={bulkTargetTypeId} onChange={e => setBulkTargetTypeId(e.target.value)}
                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border-color)', fontSize: '14px', background: 'var(--bg-card)' }}>
                                <option value="">— Chọn loại gói —</option>
                                {ticketTypesForImport.map(t => (
                                    <option key={t.id} value={t.id}>{t.name} ({t.category === 'LESSON' ? 'Học bơi' : t.category === 'MULTI' ? 'Nhiều buổi' : t.category})</option>
                                ))}
                            </select>
                        </div>

                        {/* Preview */}
                        {bulkTargetTypeId && (
                            <div style={{ padding: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', marginBottom: '16px' }}>
                                <div style={{ fontSize: '13px', color: '#166534' }}>
                                    ✅ Sẽ đổi <b>{bulkSelected.size}</b> gói sang: <b style={{ color: '#15803d' }}>{ticketTypesForImport.find(t => t.id === bulkTargetTypeId)?.name}</b>
                                </div>
                            </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn btn-primary" style={{ flex: 1 }}
                                disabled={!bulkTargetTypeId || bulkProcessing}
                                onClick={async () => {
                                    if (!bulkTargetTypeId) return;
                                    const targetType = ticketTypesForImport.find(t => t.id === bulkTargetTypeId);
                                    if (!targetType) return;
                                    if (!confirm(`Xác nhận đổi ${bulkSelected.size} gói sang "${targetType.name}"?`)) return;

                                    setBulkProcessing(true);
                                    const ids = Array.from(bulkSelected);
                                    const { error } = await supabase.from('tickets').update({ ticket_type_id: bulkTargetTypeId, updated_at: new Date().toISOString() }).in('id', ids);

                                    if (error) {
                                        alert('❌ Lỗi cập nhật: ' + error.message);
                                    } else {
                                        alert(`✅ Đã đổi ${ids.length} gói sang "${targetType.name}" thành công!`);
                                        setShowBulkModal(false);
                                        setBulkSelected(new Set());
                                        setBulkMode(false);
                                        fetchAllPackages();
                                    }
                                    setBulkProcessing(false);
                                }}>
                                {bulkProcessing ? '⏳ Đang xử lý...' : `✅ Xác nhận đổi ${bulkSelected.size} gói`}
                            </button>
                            <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowBulkModal(false)} disabled={bulkProcessing}>
                                Hủy
                            </button>
                        </div>
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
