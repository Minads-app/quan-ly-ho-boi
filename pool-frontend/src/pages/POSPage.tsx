/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/exhaustive-deps, prefer-const */
import { useEffect, useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { normalizeScannerInput } from '../utils/scannerUtils';
import { ToastProvider, toast, showConfirm } from '../components/Toast';
import { Badge, PageHeader, SegmentedTabs } from '../components/ui';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { TicketType, Ticket, RetailProduct, Customer, Promotion, ValidatedVoucher, BusinessInfo } from '../types';
import {
    maskCardCode as maskCardCodeUtil,
    fetchBusinessSettings,
    getTodayLocalVN,
    sanitizePostgrestTerm
} from '../utils/helpers';

export interface CartItem {
    cart_id: string;
    type: 'TICKET' | 'PRODUCT';
    item: any;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    promoId?: string;
    autoPromoId?: string;
    voucherId?: string;
    privateSessions?: number;
    privateBirthYear?: number;
    privateBirthYear2?: number;
    customerName2?: string;
    extraStudents?: { name: string; birthYear: number | '' }[];
    privateDurationVal?: number;
    privateDurationUnit?: 'months' | 'days';
    privateUnlimited?: boolean;
    customerName?: string;
    customerPhone?: string;
    cardCode?: string;
    guardianName?: string;
    guardianPhone?: string;
    coachId?: string;
}

interface SoldTicket extends Ticket {
    type_name: string;
    pool_close_time: string;
    remaining_sessions?: number | null;
    customer_phone: string | null;
    sold_by: string | null;
    payment_method: 'CASH' | 'TRANSFER' | 'CARD' | 'TRANSFER_COMPANY';
    pass_category?: string | null;
    pass_remaining_sessions?: number | null;
}

export default function POSPage() {
    const { profile } = useAuth();
    const maskCardCode = (code: string | null | undefined) => maskCardCodeUtil(code, profile?.role);

    // Synchronous locks to prevent double-submit on fast clicks / scanner bursts
    const isCheckingOutRef = useRef(false);
    const isCheckingInRef = useRef(false);
    const checkoutIdempotencyKeyRef = useRef<string | null>(null);

    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
    const [loading, setLoading] = useState(true);
    const [selling, setSelling] = useState(false);
    const [soldTickets, setSoldTickets] = useState<SoldTicket[]>([]); // Array of sold tickets
    const [pendingTickets, setPendingTickets] = useState<any[]>([]); // Tickets to be shown after the invoice
    const [checkoutReceipt, setCheckoutReceipt] = useState<any | null>(null);

    // Cart & Products state
    const [cart, setCart] = useState<CartItem[]>([]);
    const [products, setProducts] = useState<RetailProduct[]>([]);
    const [coaches, setCoaches] = useState<any[]>([]);
    const [selectedCoachId, setSelectedCoachId] = useState('');

    // Daily tickets quantity mapping
    const [dailyQuantities, setDailyQuantities] = useState<Record<string, number>>({});

    // Modal states for Advanced Tickets (MULTI / MONTHLY)
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [cardCode, setCardCode] = useState('');
    const [selectedAdvancedType, setSelectedAdvancedType] = useState<TicketType | null>(null);

    // New/Existing customer toggle

    const [custSearchTerm, setCustSearchTerm] = useState('');
    const [custSearchResults, setCustSearchResults] = useState<Customer[]>([]);
    const [searchingCust, setSearchingCust] = useState(false);
    const [showNewCustomerModal, setShowNewCustomerModal] = useState(false);
    const customerSearchRef = useRef<HTMLInputElement>(null);
    // New Customer Modal form fields
    const [newCustCardCode, setNewCustCardCode] = useState('');
    const [newCustName, setNewCustName] = useState('');
    const [newCustPhone, setNewCustPhone] = useState('');
    const [newCustEmail, setNewCustEmail] = useState('');
    const [newCustBirthDate, setNewCustBirthDate] = useState('');
    const [newCustGender, setNewCustGender] = useState('');
    const [newCustNote, setNewCustNote] = useState('');
    const [newCustAddress, setNewCustAddress] = useState('');
    const [savingCustomer, setSavingCustomer] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
    const [hotkeyCustomers, setHotkeyCustomers] = useState<Customer[]>([]);
    const [newCustHotkey, setNewCustHotkey] = useState('');
    const [duplicatePhoneCustomer, setDuplicatePhoneCustomer] = useState<any>(null);
    const checkPhoneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Promotions & Voucher
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [selectedPromoId, setSelectedPromoId] = useState<string>('');
    const [autoAppliedPromo, setAutoAppliedPromo] = useState<Promotion | null>(null);
    const [voucherCode, setVoucherCode] = useState('');
    const [validatedVoucher, setValidatedVoucher] = useState<ValidatedVoucher | null>(null);
    const [voucherError, setVoucherError] = useState('');
    const [validatingVoucher, setValidatingVoucher] = useState(false);
    const printRef = useRef<HTMLDivElement>(null);

    // Business Info & Payment Options
    const [bizInfo, setBizInfo] = useState<BusinessInfo>({});
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CARD' | 'TRANSFER_COMPANY'>('CASH');

    // Active Tab (Bán Vé | Check-in Thẻ)
    const [activeTab, setActiveTab] = useState<'SELL' | 'CHECKIN'>('SELL');
    // Check-in State
    const [checkinCode, setCheckinCode] = useState('');
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkinError, setCheckinError] = useState('');
    const scannerInputRef = useRef<HTMLInputElement>(null);

    // Private lesson (1 kèm N) registration fields
    const [privateSessions, setPrivateSessions] = useState<number | ''>(10);
    const [privateDurationVal, setPrivateDurationVal] = useState<number | ''>('');
    const [privateDurationUnit, setPrivateDurationUnit] = useState<'months' | 'days'>('months');
    const [privateUnlimited, setPrivateUnlimited] = useState(true);
    const [privateBirthYear, setPrivateBirthYear] = useState<number | ''>('');
    // Mảng học viên bổ sung (từ HV2 trở đi) — dùng cho gói 1 kèm N (N>=2)
    const [extraStudents, setExtraStudents] = useState<{ name: string; birthYear: number | '' }[]>([]);
    const [guardianName, setGuardianName] = useState('');
    const [guardianPhone, setGuardianPhone] = useState('');
    const [selectedCustomerBirthDate, setSelectedCustomerBirthDate] = useState<string | null>(null);

    // Helper: kiểm tra gói private (tương thích ngược)
    function isPrivateLesson(t: any): boolean {
        return t?.category === 'LESSON' && (t?.lesson_class_type === 'PRIVATE' || t?.lesson_class_type === 'ONE_ON_ONE' || t?.lesson_class_type === 'ONE_ON_TWO');
    }
    // Helper: lấy student_count thực tế
    function getStudentCount(t: any): number {
        if (t?.student_count != null && t.student_count > 0) return t.student_count;
        if (t?.lesson_class_type === 'ONE_ON_ONE') return 1;
        if (t?.lesson_class_type === 'ONE_ON_TWO') return 2;
        return 0;
    }
    // Helper: nhãn loại lớp
    function getClassLabel(t: any): string {
        if (t?.lesson_class_type === 'GROUP') return '👥 Nhóm';
        const sc = getStudentCount(t);
        if (sc > 0) return `1:${sc}`;
        return '🧑‍🏫 Riêng';
    }

    // Product Variants selection in POS
    const [selectingVariantFor, setSelectingVariantFor] = useState<RetailProduct | null>(null);

    // Multi-package selection state
    const [showPackageSelectModal, setShowPackageSelectModal] = useState(false);
    const [availablePackages, setAvailablePackages] = useState<any[]>([]);
    const [pendingCheckinCode, setPendingCheckinCode] = useState('');

    // PREVIEW CHECKIN STATE
    const [previewTicket, setPreviewTicket] = useState<any | null>(null);

    // CHECK-IN HISTORY STATE
    const [checkinHistory, setCheckinHistory] = useState<any[]>([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [historySearchTerm, setHistorySearchTerm] = useState('');
    const [historyMode, setHistoryMode] = useState<'TODAY' | 'SEARCH'>('TODAY');

    // POS Search & Filter
    const [searchTerm, setSearchTerm] = useState('');
    const [activeCategory, setActiveCategory] = useState<'ALL' | 'DAILY' | 'ADVANCED' | 'LESSON' | 'PRODUCT'>('ALL');

    // Modal printing keyboard shortcuts (Esc to close, Enter to print)
    useEffect(() => {
        function handlePrintKeyDown(e: KeyboardEvent) {
            if (checkoutReceipt) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setCheckoutReceipt(null);
                    setPendingTickets([]);
                    setSoldTickets([]);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    document.getElementById('btn-print-receipt')?.click();
                }
            } else if (soldTickets.length > 0) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    setSoldTickets([]);
                } else if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    handlePrint();
                }
            }
        }
        window.addEventListener('keydown', handlePrintKeyDown, true);
        return () => window.removeEventListener('keydown', handlePrintKeyDown, true);
    }, [soldTickets, checkoutReceipt]);

    // Keyboard shortcuts: F2=CHECKIN tab, F3=customer search, F4=SELL tab, F6-F10=customer hotkey
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            // Skip shortcuts when modals are open
            if (showNewCustomerModal || selectedAdvancedType || showPaymentModal || showPackageSelectModal) return;

            if (e.key === 'F2') {
                e.preventDefault();
                setActiveTab('CHECKIN');
            } else if (e.key === 'F3') {
                e.preventDefault();
                customerSearchRef.current?.focus();
            } else if (e.key === 'F4') {
                e.preventDefault();
                setActiveTab('SELL');
            } else if (['F6', 'F7', 'F8', 'F9', 'F10'].includes(e.key)) {
                e.preventDefault();
                const cust = hotkeyCustomers.find(c => c.hotkey === e.key);
                if (cust) {
                    setCustomerName(cust.full_name);
                    setCustomerPhone(cust.phone);
                    setCardCode(cust.card_code);
                    setSelectedCustomerId(cust.id);
                    setSelectedCustomerBirthDate(cust.birth_date || null);
                    setCustSearchResults([]);
                    setCustSearchTerm('');
                    toast.info(`Phím tắt ${e.key}`, `Đã chọn khách hàng: ${cust.full_name}`);
                } else {
                    toast.info(`Phím tắt ${e.key}`, `Chưa có khách hàng nào được gán phím tắt ${e.key}.`);
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hotkeyCustomers, showNewCustomerModal, selectedAdvancedType, showPaymentModal, showPackageSelectModal]);

    useEffect(() => {
        checkoutIdempotencyKeyRef.current = cart.length > 0 ? crypto.randomUUID() : null;
    }, [cart]);

    useEffect(() => {
        fetchTicketTypes();
        fetchPromotions();
        fetchProducts();
        fetchBusinessInfo();
        fetchHotkeyCustomers();
        fetchCoaches();

        async function fetchCoaches() {
            const { data, error } = await supabase.from('coaches').select('*').eq('is_active', true).order('full_name');
            if (error) console.error('Lỗi tải danh sách HLV:', error);
            if (data) setCoaches(data);
        }

        async function fetchBusinessInfo() {
            const info = await fetchBusinessSettings();
            setBizInfo({
                business_name: info.business_name || 'Hệ Thống Vé Bơi',
                business_address: info.business_address || '',
                business_phone: info.business_phone || '',
                business_logo: info.business_logo || '',
                bank_name: info.bank_name || '',
                bank_account_number: info.bank_account_number || '',
                bank_account_name: info.bank_account_name || '',
                print_format: (info.print_format as 'K80' | 'A5') || 'K80'
            });
        }
    }, []);

    async function fetchProducts() {
        const { data, error } = await supabase.from('products').select('*').eq('is_active', true).order('name');
        if (error) {
            toast.error('Lỗi tải sản phẩm', error.message);
        } else if (data) {
            setProducts(data);
        }
    }

    async function fetchTicketTypes() {
        const { data, error } = await supabase
            .from('ticket_types')
            .select('*')
            .eq('is_active', true)
            .order('category')
            .order('name');

        if (error) {
            toast.error('Lỗi tải danh mục vé', error.message);
        } else if (data) {
            setTicketTypes(data);
            const initialQuantities: Record<string, number> = {};
            data.filter(t => t.category === 'DAILY').forEach(t => {
                initialQuantities[t.id] = 1;
            });
            setDailyQuantities(initialQuantities);
        }
        setLoading(false);
    }

    async function fetchPromotions() {
        const now = new Date();
        const { data, error } = await supabase
            .from('promotions')
            .select('*')
            .eq('is_active', true);

        if (error) {
            toast.error('Lỗi tải khuyến mãi', error.message);
            return;
        }
        if (data) {
            const validPromos = data.filter((p: Promotion) => {
                if (p.valid_from && now < new Date(p.valid_from)) return false;
                if (p.valid_until && now > new Date(p.valid_until)) return false;
                return true;
            });
            setPromotions(validPromos);
        }
    }

    async function handleApplyVoucher() {
        if (!voucherCode.trim()) return;
        setVoucherError('');
        setValidatedVoucher(null);
        setValidatingVoucher(true);

        const { data, error } = await supabase.rpc('validate_voucher', {
            p_code: voucherCode.trim(),
            p_customer_id: selectedCustomerId || null,
            p_ticket_type_id: selectedAdvancedType?.id || null
        });

        if (error) {
            setVoucherError('Lỗi hệ thống: ' + error.message);
        } else if (data && !data.valid) {
            setVoucherError(data.error || 'Mã không hợp lệ.');
        } else if (data && data.valid) {
            if (cart.some(c => c.voucherId === data.voucher_id)) {
                setVoucherError('Mã Voucher này đã được áp dụng cho một gói khác trong giỏ hàng hiện tại.');
                setValidatingVoucher(false);
                return;
            }
            setValidatedVoucher({
                voucher_id: data.voucher_id,
                promotion_id: data.promotion_id,
                promo_name: data.promo_name,
                promo_type: data.promo_type,
                promo_value: data.promo_value
            });
            // Check combinable: if auto-applied promo or voucher's promo is NOT combinable → replace
            const voucherPromo = promotions.find(p => p.id === data.promotion_id);
            if (autoAppliedPromo && (!autoAppliedPromo.combinable || (voucherPromo && !voucherPromo.combinable))) {
                // Cannot combine → voucher wins (user explicitly entered it)
                setSelectedPromoId(data.promotion_id);
                setAutoAppliedPromo(null); // Remove auto-applied
            } else {
                // Can combine → keep both (voucher takes selectedPromoId for cart)
                setSelectedPromoId(data.promotion_id);
            }
        }
        setValidatingVoucher(false);
    }

    function clearVoucher() {
        setVoucherCode('');
        setValidatedVoucher(null);
        setVoucherError('');
        // Restore auto-applied promo if it was removed
        if (selectedAdvancedType) {
            const now = new Date();
            const autoPromo = promotions.find(p => {
                if (!p.auto_apply || !p.is_active) return false;
                if (p.valid_from && now < new Date(p.valid_from)) return false;
                if (p.valid_until && now > new Date(p.valid_until)) return false;
                if (p.applicable_ticket_types !== null && !p.applicable_ticket_types.includes(selectedAdvancedType.id)) {
                    if (p.applicable_lesson_types !== null && !p.applicable_lesson_types.includes(selectedAdvancedType.id)) return false;
                    if (p.applicable_lesson_types === null) return false;
                }
                return true;
            });
            if (autoPromo) {
                setSelectedPromoId(autoPromo.id);
                setAutoAppliedPromo(autoPromo);
            } else {
                setSelectedPromoId('');
                setAutoAppliedPromo(null);
            }
        } else {
            setSelectedPromoId('');
        }
    }

    async function fetchHotkeyCustomers() {
        const { data } = await supabase
            .from('customers')
            .select('*')
            .not('hotkey', 'is', null);
        if (data) setHotkeyCustomers(data as Customer[]);
    }

    async function getPoolCloseTime(): Promise<string> {
        const { data } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'pool_weekly_schedule')
            .single();

        if (data?.value) {
            try {
                const schedule = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
                const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
                const today = days[new Date().getDay()];
                if (schedule[today] && schedule[today].close) {
                    return schedule[today].close;
                }
            } catch (e) {
                // Ignore parse error
            }
        }

        // Fallback
        const fallback = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'pool_close_time')
            .single();
        let val = fallback.data?.value ? String(fallback.data.value) : '20:00';
        return val.replace(/"/g, '');
    }

    async function sellTicket(ticketType: TicketType) {
        if (selling) return;

        setSelectedAdvancedType(ticketType);
        // DO NOT reset customerName/Phone/cardCode — they are managed by cart search bar
        setSelectedPromoId('');
        setVoucherCode('');
        setValidatedVoucher(null);
        setVoucherError('');
        setCustSearchTerm('');
        setCustSearchResults([]);
        // Reset private lesson fields
        setPrivateSessions(10);
        setPrivateDurationVal('');
        setPrivateDurationUnit('months');
        setPrivateUnlimited(true);
        setGuardianName('');
        setGuardianPhone('');
        // Khởi tạo mảng extra students dựa trên student_count
        const sc = getStudentCount(ticketType);
        if (sc > 1) {
            setExtraStudents(Array.from({ length: sc - 1 }, () => ({ name: '', birthYear: '' })));
        } else {
            setExtraStudents([]);
        }
        // Auto-fill birth year from selected customer for private lessons
        const isPriv = isPrivateLesson(ticketType);
        if (isPriv && selectedCustomerBirthDate) {
            setPrivateBirthYear(new Date(selectedCustomerBirthDate).getFullYear());
        } else {
            setPrivateBirthYear('');
        }

        // Auto-apply promotion detection
        const now = new Date();
        const autoPromo = promotions.find(p => {
            if (!p.auto_apply || !p.is_active) return false;
            // Check validity dates
            if (p.valid_from && now < new Date(p.valid_from)) return false;
            if (p.valid_until && now > new Date(p.valid_until)) return false;
            // Check applicable ticket types
            if (p.applicable_ticket_types !== null && !p.applicable_ticket_types.includes(ticketType.id)) {
                // Also check lesson types
                if (p.applicable_lesson_types !== null && !p.applicable_lesson_types.includes(ticketType.id)) {
                    return false;
                }
                if (p.applicable_lesson_types === null) return false;
            }
            return true;
        });

        if (autoPromo) {
            setSelectedPromoId(autoPromo.id);
            setAutoAppliedPromo(autoPromo);
        } else {
            setAutoAppliedPromo(null);
        }
    }

    // --- Save new customer to customers table ---
    async function handleNewCustPhoneChange(phone: string) {
        setNewCustPhone(phone);
        setDuplicatePhoneCustomer(null);
        if (checkPhoneTimer.current) clearTimeout(checkPhoneTimer.current);
        const trimmed = phone.trim();
        if (trimmed.length >= 9) {
            checkPhoneTimer.current = setTimeout(async () => {
                const { data } = await supabase.from('customers').select('*').eq('phone', trimmed).maybeSingle();
                if (data) {
                    setDuplicatePhoneCustomer(data);
                    // Auto-fill thông tin khách cũ
                    setNewCustName(data.full_name || '');
                    setNewCustCardCode(data.card_code || '');
                    setNewCustEmail(data.email || '');
                    setNewCustBirthDate(data.birth_date || '');
                    setNewCustGender(data.gender || '');
                    setNewCustAddress(data.address || '');
                    setNewCustNote(data.note || '');
                    setSelectedCustomerId(data.id);
                    toast.info('Khách hàng đã tồn tại', `SĐT ${trimmed} đã đăng ký cho "${data.full_name}". Thông tin đã được tải lại.`);
                }
            }, 400);
        }
    }

    async function handleSaveNewCustomer() {
        if (!newCustCardCode.trim() || !newCustName.trim() || !newCustPhone.trim()) {
            toast.warning('Thông tin thiếu', 'Vui lòng nhập đầy đủ: Mã thẻ, Họ tên, Số điện thoại!');
            return;
        }

        // Nếu KH đã tồn tại (trùng SĐT) → chỉ cần load thông tin, không tạo mới
        if (duplicatePhoneCustomer) {
            setCustomerName(duplicatePhoneCustomer.full_name);
            setCustomerPhone(duplicatePhoneCustomer.phone);
            setCardCode(duplicatePhoneCustomer.card_code);
            setSelectedCustomerId(duplicatePhoneCustomer.id);
            setSelectedCustomerBirthDate(duplicatePhoneCustomer.birth_date || null);
            setShowNewCustomerModal(false);
            setDuplicatePhoneCustomer(null);
            setNewCustCardCode(''); setNewCustName(''); setNewCustPhone('');
            setNewCustEmail(''); setNewCustBirthDate(''); setNewCustGender('');
            setNewCustNote(''); setNewCustAddress(''); setNewCustHotkey('');
            toast.success('Đã chọn KH', `Đã chọn khách hàng "${duplicatePhoneCustomer.full_name}" từ hệ thống.`);
            return;
        }
        setSavingCustomer(true);

        const inputCardCode = newCustCardCode.trim();

        // 1. Check card_bank (case-insensitive)
        const { data: cardRes, error: cardErr } = await supabase
            .from('card_bank')
            .select('*')
            .ilike('card_code', inputCardCode)
            .single();

        // Use exact card_code from DB (preserve original case)
        const finalCardCode = cardRes?.card_code ?? inputCardCode.toUpperCase();

        let shouldInsertCard = false;
        let shouldUpdateCardId = null;

        if (cardErr || !cardRes) {
            if (profile?.role === 'ADMIN') {
                const confirmCreate = await showConfirm({ title: 'Thẻ chưa có trong kho', message: `Mã thẻ "${inputCardCode}" không có trong ngân hàng thẻ. Bạn có muốn tự động tạo và gán cho khách không?`, type: 'warning', confirmText: 'Tạo & Gán', icon: '🆕' });
                if (!confirmCreate) {
                    setSavingCustomer(false);
                    return;
                }
                shouldInsertCard = true;
            } else {
                toast.error('Thẻ không hợp lệ', 'Mã thẻ chưa được khởi tạo trong kho thẻ. Vui lòng liên hệ Admin.');
                setSavingCustomer(false);
                return;
            }
        } else {
            if (cardRes.status !== 'UNUSED') {
            if (profile?.role === 'ADMIN') {
                    const confirmUse = await showConfirm({ title: 'Thẻ đã sử dụng', message: `Mã thẻ "${inputCardCode}" đang có trạng thái: ${cardRes.status}. Bạn có chắc chắn muốn ép dùng mã này không?`, type: 'danger', confirmText: 'Ép dùng', icon: '⚠️' });
                    if (!confirmUse) {
                        setSavingCustomer(false);
                        return;
                    }
                    shouldUpdateCardId = cardRes.id;
                } else {
                    toast.error('Thẻ đã được sử dụng', `Mã thẻ có trạng thái: ${cardRes.status}. Vui lòng lấy thẻ khác.`);
                    setSavingCustomer(false);
                    return;
                }
            } else {
                shouldUpdateCardId = cardRes.id;
            }
        }

        // 2. Insert customer
        const { data, error } = await supabase.from('customers').insert({
            card_code: finalCardCode,
            full_name: newCustName.trim(),
            phone: newCustPhone.trim(),
            email: newCustEmail.trim() || null,
            birth_date: newCustBirthDate || null,
            gender: newCustGender || null,
            note: newCustNote.trim() || null,
            address: newCustAddress.trim() || null,
            hotkey: newCustHotkey || null,
        }).select().single();

        if (error) {
            if (error.message.includes('duplicate') || error.message.includes('unique')) {
                toast.error('Trùng mã thẻ', `Mã thẻ "${inputCardCode}" đã tồn tại trong danh sách khách hàng!`);
            } else {
                toast.error('Lỗi lưu khách hàng', error.message);
            }
            setSavingCustomer(false);
            return;
        }

        // 3. Update/Insert card bank status
        if (shouldInsertCard) {
            const now = new Date();
            const monthYear = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(2)}`;
            await supabase.from('card_bank').insert({
                card_code: finalCardCode,
                prefix: 'MANUAL',
                month_year: monthYear,
                sequence_number: 0,
                random_string: 'MANUAL',
                status: 'USED',
                created_by: profile?.id
            });
        } else if (shouldUpdateCardId) {
            await supabase.from('card_bank').update({ status: 'USED' }).eq('id', shouldUpdateCardId);
        }

        // Auto-fill cart customer info
        setCustomerName(data.full_name);
        setCustomerPhone(data.phone);
        setCardCode(data.card_code);
        setSelectedCustomerId(data.id);
        setSelectedCustomerBirthDate(data.birth_date || null);
        setShowNewCustomerModal(false);
        setSavingCustomer(false);
        if (data.hotkey) fetchHotkeyCustomers();
        // Reset modal form
        setNewCustCardCode(''); setNewCustName(''); setNewCustPhone('');
        setNewCustEmail(''); setNewCustBirthDate(''); setNewCustGender('');
        setNewCustNote(''); setNewCustAddress(''); setNewCustHotkey('');
    }

    function addToCart(type: 'TICKET' | 'PRODUCT', item: any, quantity: number = 1) {
        if (type === 'PRODUCT') {
            const existing = cart.find(c => c.type === 'PRODUCT' && c.item.id === item.id);
            const currentQty = existing ? existing.quantity : 0;
            if (currentQty + quantity > item.stock_quantity) {
                toast.warning('Hết hàng', `Sản phẩm "${item.name}" chỉ còn ${item.stock_quantity} trong kho!`);
                return;
            }
        }

        setCart(prev => {
            const existing = prev.find(c => c.type === type && c.item.id === item.id);
            if (type === 'PRODUCT') {
                const prevQty = existing ? existing.quantity : 0;
                if (prevQty + quantity > item.stock_quantity) {
                    return prev;
                }
            }

            if (existing && type === 'PRODUCT') {
                return prev.map(c => c.cart_id === existing.cart_id ? { ...c, quantity: c.quantity + quantity, subtotal: (c.quantity + quantity) * c.unitPrice } : c);
            }
            if (existing && type === 'TICKET' && item.category === 'DAILY') {
                return prev.map(c => c.cart_id === existing.cart_id ? { ...c, quantity: c.quantity + quantity, subtotal: (c.quantity + quantity) * c.unitPrice } : c);
            }
            return [...prev, {
                cart_id: crypto.randomUUID(),
                type, item, quantity, unitPrice: item.price, subtotal: item.price * quantity
            }];
        });
    }

    async function doCheckoutOrder() {
        if (cart.length === 0 || isCheckingOutRef.current) return;
        isCheckingOutRef.current = true;
        setSelling(true);

        try {
            const todayStr = getTodayLocalVN();

            const p_items = cart.map(c => {
                if (c.type === 'PRODUCT') {
                    return { type: 'PRODUCT', id: c.item.id, quantity: c.quantity, unit_price: c.unitPrice, subtotal: c.subtotal };
                }

                let validFrom = null;
                let validUntil = null;
                let customDurationMonths = null;
                let customValidityDays = null;

                if (c.item.category === 'DAILY') {
                    validFrom = todayStr;
                    const daysToAdd = Math.max(0, (c.item.validity_days || 1) - 1);
                    const expDate = new Date(`${todayStr}T00:00:00+07:00`);
                    expDate.setDate(expDate.getDate() + daysToAdd);
                    validUntil = `${expDate.getFullYear()}-${String(expDate.getMonth() + 1).padStart(2, '0')}-${String(expDate.getDate()).padStart(2, '0')}`;
                } else {
                    if (!c.privateUnlimited && c.privateDurationVal) {
                        if (c.privateDurationUnit === 'months') {
                            customDurationMonths = Number(c.privateDurationVal);
                        } else {
                            customValidityDays = Number(c.privateDurationVal);
                        }
                    }
                }

                const finalPrice = c.unitPrice;
                let finalSessions = c.item.session_count || null;
                if (c.privateSessions) finalSessions = c.privateSessions;

                if (c.promoId) {
                    const promo = promotions.find(p => p.id === c.promoId);
                    if (promo && promo.type === 'BONUS_SESSION' && finalSessions !== null) {
                        finalSessions += promo.value;
                    }
                }
                // Auto-applied promo (if different from promoId, to avoid double-counting)
                if (c.autoPromoId && c.autoPromoId !== c.promoId) {
                    const autoPromo = promotions.find(p => p.id === c.autoPromoId);
                    if (autoPromo && autoPromo.type === 'BONUS_SESSION' && finalSessions !== null) {
                        finalSessions += autoPromo.value;
                    }
                }

                const cleanExtraStudents = (c.extraStudents || [])
                    .filter(s => s.name && s.name.trim())
                    .map(s => ({ name: s.name.trim(), birthYear: Number(s.birthYear) || null }));

                return {
                    type: 'TICKET', id: c.item.id, quantity: c.quantity, unit_price: c.quantity > 1 ? c.unitPrice : finalPrice, subtotal: c.subtotal,
                    ticket_metadata: {
                        customer_id: selectedCustomerId || null,
                        customer_name: c.customerName || customerName || null,
                        customer_phone: c.customerPhone || customerPhone || null,
                        valid_from: validFrom,
                        valid_until: validUntil,
                        remaining_sessions: finalSessions,
                        total_sessions: finalSessions,
                        promotion_id: c.promoId || c.autoPromoId || null,
                        voucher_id: c.voucherId || null,
                        coach_id: c.coachId || null,
                        card_code: c.cardCode || cardCode || null,
                        customer_birth_year: c.privateBirthYear || null,
                        customer_name_2: c.customerName2 || null,
                        customer_birth_year_2: c.privateBirthYear2 || null,
                        extra_students: cleanExtraStudents,
                        custom_duration_months: customDurationMonths,
                        custom_validity_days: customValidityDays,
                        guardian_name: c.guardianName || null,
                        guardian_phone: c.guardianPhone || null
                    }
                };
            });

            const total_amount_raw = p_items.reduce((sum, item) => sum + item.subtotal, 0);
            const basePayload = {
                p_total_amount: total_amount_raw,
                p_payment_method: selectedPaymentMethod,
                p_customer_name: customerName || null,
                p_customer_phone: customerPhone || null,
                p_note: '',
                p_user_id: profile?.id,
                p_items: p_items
            };

            let { data, error } = await supabase.rpc('create_checkout_order', {
                ...basePayload,
                p_idempotency_key: checkoutIdempotencyKeyRef.current
            });

            // Backward-compatible fallback if migration 058 hasn't been applied on DB yet
            if (error && (error.code === 'PGRST202' || error.message?.includes('p_idempotency_key'))) {
                const retryRes = await supabase.rpc('create_checkout_order', basePayload);
                data = retryRes.data;
                error = retryRes.error;
            }

            if (error || !data?.success) {
                toast.error('Lỗi bán hàng', error?.message || data?.error);
                return;
            }

            // Fallback ghi nhận Voucher nếu DB chưa chạy migration 058 (chưa trả về voucher_processed = true)
            if (!data.voucher_processed) {
                for (const c of cart) {
                    if (c.voucherId) {
                        await supabase.rpc('use_voucher', {
                            p_voucher_id: c.voucherId,
                            p_customer_id: selectedCustomerId || null,
                            p_ticket_id: null,
                            p_used_by: profile?.id || null
                        });
                    }
                }
            }

            // Build receipt object before clearing cart
            const receipt = {
                order_id: data.order_id,
                items: cart.map(c => {
                    const promo = c.promoId
                        ? promotions.find(p => p.id === c.promoId)
                        : c.autoPromoId
                            ? promotions.find(p => p.id === c.autoPromoId)
                            : null;
                    return {
                        name: c.item.name,
                        quantity: c.quantity,
                        unitPrice: c.unitPrice,
                        subtotal: c.subtotal,
                        isLesson: c.type === 'TICKET' && c.item.category === 'LESSON',
                        promoName: promo ? promo.name : null,
                        promoLabel: promo ? (promo.type === 'AMOUNT' ? `−${promo.value.toLocaleString('vi-VN')}đ` : promo.type === 'PERCENT' ? `−${promo.value}%` : `+${promo.value} buổi`) : null
                    };
                }),
                totalPrice: total_amount_raw,
                customerName,
                customerPhone,
                paymentMethod: selectedPaymentMethod,
                createdAt: new Date().toISOString()
            };

            if (data.ticket_ids && data.ticket_ids.length > 0) {
                // Fallback gán HLV nếu DB chưa xử lý coach_id trong RPC
                if (!data.voucher_processed) {
                    for (const c of cart) {
                        if (c.type === 'TICKET' && c.item.category === 'LESSON' && c.coachId) {
                            await supabase.from('tickets')
                                .update({ coach_id: c.coachId })
                                .in('id', data.ticket_ids)
                                .eq('ticket_type_id', c.item.id);
                        }
                    }
                }

                const { data: generatedTickets } = await supabase.from('tickets').select('*').in('id', data.ticket_ids);
                if (generatedTickets) {
                    const dailyTickets = generatedTickets.filter(t => {
                        const c = cart.find(x => x.type === 'TICKET' && x.item.id === t.ticket_type_id);
                        return c && c.item.category === 'DAILY';
                    });
                    if (dailyTickets.length > 0) {
                        const closeTime = await getPoolCloseTime();
                        const mapped = dailyTickets.map(t => {
                            const c = cart.find(x => x.type === 'TICKET' && x.item.id === t.ticket_type_id);
                            return {
                                ...t,
                                type_name: c!.item.name,
                                pool_close_time: closeTime,
                                remaining_sessions: t.remaining_sessions,
                                payment_method: selectedPaymentMethod
                            };
                        });
                        setPendingTickets(mapped as any);
                    }

                    setCheckoutReceipt(receipt);
                }
            } else {
                setCheckoutReceipt(receipt);
            }

            setCart([]);
            setCustomerName('');
            setCustomerPhone('');
            setCardCode('');
            setSelectedCustomerId(null);
            setSelectedCustomerBirthDate(null);
            setSelectedPaymentMethod('CASH');
            setShowPaymentModal(false);
            fetchProducts();
        } finally {
            isCheckingOutRef.current = false;
            setSelling(false);
        }
    }

    function handleAdvancedSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedAdvancedType) return;

        // Validation for private lessons
        const isPriv = isPrivateLesson(selectedAdvancedType);
        const sc = getStudentCount(selectedAdvancedType);

        if (isPriv) {
            if (!privateBirthYear) {
                toast.warning('Thiếu thông tin', `Vui lòng nhập năm sinh học viên${sc > 1 ? ' 1' : ''}!`);
                return;
            }

            // Validate extra students (HV2, HV3, ...)
            for (let i = 0; i < extraStudents.length; i++) {
                if (!extraStudents[i].name.trim()) {
                    toast.warning('Thiếu thông tin', `Vui lòng nhập tên học viên ${i + 2}!`);
                    return;
                }
                if (!extraStudents[i].birthYear) {
                    toast.warning('Thiếu thông tin', `Vui lòng nhập năm sinh học viên ${i + 2}!`);
                    return;
                }
            }

            // Guardian info required for under-18 students
            const currentYearGuardian = new Date().getFullYear();
            const age1Guardian = currentYearGuardian - Number(privateBirthYear);
            let needsGuardian = age1Guardian < 18;
            for (const s of extraStudents) {
                if (s.birthYear && (currentYearGuardian - Number(s.birthYear)) < 18) {
                    needsGuardian = true;
                }
            }
            if (needsGuardian) {
                if (!guardianName.trim() || !guardianPhone.trim()) {
                    toast.warning('Cần giám hộ', 'Học viên dưới 18 tuổi bắt buộc phải có thông tin người giám hộ (Họ tên, SĐT)!');
                    return;
                }
            }

            if (!selectedCoachId) {
                toast.warning('Thiếu HLV', 'Vui lòng chọn Huấn Luyện Viên cho khóa kèm riêng!');
                return;
            }

            if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                const currentYear = new Date().getFullYear();
                // Validate HV1
                const age1 = currentYear - Number(privateBirthYear);
                const isAge1Valid = selectedAdvancedType.age_price_tiers.some(tier => age1 >= tier.minAge && (tier.maxAge === null ? true : age1 <= tier.maxAge));
                if (!isAge1Valid) {
                    toast.error('Độ tuổi không phù hợp', 'Độ tuổi học viên 1 không phù hợp với khóa học này.');
                    return;
                }
                // Validate extra students
                for (let i = 0; i < extraStudents.length; i++) {
                    if (extraStudents[i].birthYear) {
                        const ageX = currentYear - Number(extraStudents[i].birthYear);
                        const isAgeXValid = selectedAdvancedType.age_price_tiers.some(tier => ageX >= tier.minAge && (tier.maxAge === null ? true : ageX <= tier.maxAge));
                        if (!isAgeXValid) {
                            toast.error('Độ tuổi không phù hợp', `Độ tuổi học viên ${i + 2} không phù hợp với khóa học này.`);
                            return;
                        }
                    }
                }
            }
        } else if (selectedAdvancedType.category === 'LESSON' && (selectedAdvancedType as any).lesson_class_type === 'GROUP') {
            if (!customerName || !customerName.trim()) {
                toast.warning('Thiếu khách hàng', 'Vui lòng tìm và chọn khách hàng trước khi mua Gói Bơi Nhóm!\nBấm F3 để tìm hoặc bấm "+" để thêm mới.');
                return;
            }
        }

        const { finalSubtotal } = computeAdvancedFinalPrice(selectedAdvancedType);
        const privateSessionsVal = isPriv ? (Number(privateSessions) || undefined) : undefined;

        // ADD TO CART 
        setCart(prev => [...prev, {
            cart_id: crypto.randomUUID(),
            type: 'TICKET',
            item: selectedAdvancedType,
            quantity: 1, // advanced ticket always qty=1
            unitPrice: finalSubtotal,
            subtotal: finalSubtotal,
            promoId: selectedPromoId || undefined,
            autoPromoId: autoAppliedPromo?.id || undefined,
            voucherId: validatedVoucher?.voucher_id || undefined,
            privateSessions: privateSessionsVal,
            privateBirthYear: Number(privateBirthYear) || undefined,
            privateBirthYear2: extraStudents.length > 0 ? (Number(extraStudents[0]?.birthYear) || undefined) : undefined,
            customerName2: extraStudents.length > 0 ? (extraStudents[0]?.name || undefined) : undefined,
            extraStudents: extraStudents.length > 0 ? extraStudents : undefined,
            privateDurationVal: privateDurationVal ? Number(privateDurationVal) : undefined,
            privateDurationUnit: privateDurationUnit,
            privateUnlimited: privateUnlimited,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            cardCode: cardCode.trim() || undefined,
            guardianName: guardianName.trim() || undefined,
            guardianPhone: guardianPhone.trim() || undefined,
            coachId: selectedCoachId || undefined
        }]);

        setSelectedAdvancedType(null);
    }

    function computeAdvancedFinalPrice(ticketType: TicketType): { baseSubtotal: number; finalSubtotal: number } {
        const isPriv = isPrivateLesson(ticketType);
        const sc = getStudentCount(ticketType);
        let baseSubtotal = ticketType.price;

        if (isPriv) {
            const currentYear = new Date().getFullYear();
            const allBirthYears = [Number(privateBirthYear), ...extraStudents.map(s => Number(s.birthYear || 0))].filter(y => y > 0);
            let totalUnitPrice = 0;

            for (const by of allBirthYears) {
                let unitP = ticketType.price;
                if (ticketType.age_price_tiers && ticketType.age_price_tiers.length > 0) {
                    const age = currentYear - by;
                    const tier = ticketType.age_price_tiers.find(t => age >= t.minAge && (t.maxAge === null ? true : age <= t.maxAge));
                    if (tier) unitP = Math.round(tier.price);
                }
                totalUnitPrice += unitP;
            }

            if (allBirthYears.length === 0) {
                totalUnitPrice = ticketType.price * sc;
            } else if (allBirthYears.length < sc) {
                totalUnitPrice += ticketType.price * (sc - allBirthYears.length);
            }

            baseSubtotal = Math.round(totalUnitPrice * Number(privateSessions || 0));
        }

        let subtotal = baseSubtotal;

        // 1. Áp dụng Khuyến mãi tự động hoặc thủ công (AMOUNT / PERCENT)
        if (autoAppliedPromo && autoAppliedPromo.id !== validatedVoucher?.promotion_id) {
            if (autoAppliedPromo.type === 'AMOUNT') subtotal = Math.max(0, subtotal - autoAppliedPromo.value);
            if (autoAppliedPromo.type === 'PERCENT') subtotal = Math.max(0, Math.round(subtotal * (1 - autoAppliedPromo.value / 100)));
        } else if (selectedPromoId && !validatedVoucher) {
            const manualPromo = promotions.find(p => p.id === selectedPromoId);
            if (manualPromo?.type === 'AMOUNT') subtotal = Math.max(0, subtotal - manualPromo.value);
            if (manualPromo?.type === 'PERCENT') subtotal = Math.max(0, Math.round(subtotal * (1 - manualPromo.value / 100)));
        }

        // 2. Áp dụng giảm giá từ Voucher (nếu có)
        if (validatedVoucher) {
            if (validatedVoucher.promo_type === 'AMOUNT') subtotal = Math.max(0, subtotal - validatedVoucher.promo_value);
            if (validatedVoucher.promo_type === 'PERCENT') subtotal = Math.max(0, Math.round(subtotal * (1 - validatedVoucher.promo_value / 100)));
        }

        return { baseSubtotal, finalSubtotal: subtotal };
    }

    function handleDailySaleClick(ticketType: TicketType) {
        const qty = dailyQuantities[ticketType.id] || 1;
        addToCart('TICKET', ticketType, qty);
    }

    function handleProductSaleClick(product: RetailProduct) {
        addToCart('PRODUCT', product, 1);
    }

    function handlePrint() {
        if (!printRef.current) return;
        const printContent = printRef.current.innerHTML;
        const isA5 = bizInfo.print_format === 'A5';

        const iframe = document.createElement('iframe');
        iframe.style.position = 'fixed';
        iframe.style.right = '0';
        iframe.style.bottom = '0';
        iframe.style.width = '0';
        iframe.style.height = '0';
        iframe.style.border = 'none';

        // Add iframe to body so it gets a contentWindow
        document.body.appendChild(iframe);
        const win = iframe.contentWindow;
        if (!win) {
            document.body.removeChild(iframe);
            toast.error('Lỗi in', 'Không thể khởi tạo trình in bộ nhớ tạm.');
            return;
        }

        win.document.open();
        win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>In Vé</title>
        <style>
          @media print {
            @page { 
                size: ${isA5 ? 'A5 portrait' : 'auto'}; 
                margin: 0; 
            }
            body { 
              width: 100% !important; 
              margin: 0 !important; 
              padding: ${isA5 ? '10mm' : '4mm'} !important;
            }
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Times New Roman', Times, serif;
            width: 100%;
            max-width: ${isA5 ? '148mm' : '320px'};
            margin: 0 auto;
            padding: ${isA5 ? '20px' : '16px'};
            font-size: ${isA5 ? '18px' : '15px'};
            color: #000;
            background: #fff;
          }
          .ticket-print {
            text-align: center;
            page-break-after: ${isA5 ? 'auto' : 'always'};
            border-bottom: 2px dashed #000;
            padding-bottom: ${isA5 ? '32px' : '24px'};
            margin-bottom: ${isA5 ? '32px' : '24px'};
            width: 100%;
          }
          .ticket-print:last-child {
            page-break-after: auto;
            border-bottom: none;
            padding-bottom: 0;
            margin-bottom: 0;
          }
          .ticket-print h2 { font-size: ${isA5 ? '28px' : '22px'}; margin-bottom: 8px; text-transform: uppercase; }
          .ticket-print .subtitle { color: #444; font-size: ${isA5 ? '14px' : '12px'}; margin-bottom: 16px; font-weight: bold; }
          .ticket-print .qr-wrapper { margin: ${isA5 ? '24px' : '16px'} 0; text-align: center; }
          .ticket-print .qr-wrapper svg { width: ${isA5 ? '240px' : '180px'}; height: ${isA5 ? '240px' : '180px'}; margin: 0 auto; display: block; }
          .ticket-print .info-row {
            display: flex;
            justify-content: space-between;
            padding: ${isA5 ? '6px 0' : '4px 0'};
            border-bottom: 1px dotted #ccc;
            font-size: ${isA5 ? '15px' : '12px'};
          }
          .ticket-print .info-row .label { color: #666; }
          .ticket-print .info-row .value { font-weight: 700; }
          .ticket-print .footer {
            margin-top: ${isA5 ? '16px' : '10px'};
            font-size: ${isA5 ? '13px' : '10px'};
            color: #999;
          }
          @media print { 
            * { color: #000 !important; background: transparent !important; }
            body { font-weight: bold !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        </style>
      </head>
      <body>
        ${printContent}
      </body>
      </html>
    `);
        win.document.close();

        // Wait for fonts/styles to load and print
        setTimeout(() => {
            win.focus();
            win.print();
            // Cleanup iframe after printing dialog closes
            setTimeout(() => {
                document.body.removeChild(iframe);
            }, 500);
        }, 300);
    }


    function formatPrice(price: number) {
        return new Intl.NumberFormat('vi-VN').format(price) + 'đ';
    }

    function formatTime(isoStr: string) {
        const d = new Date(isoStr);
        return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    }

    // --- CHECK IN LOGIC ---
    async function doCheckin(passId: string, confirmNewPackage: boolean = false, selectedTicketId?: string) {
        if (isCheckingInRef.current) return;
        isCheckingInRef.current = true;

        try {
            const payload: any = {
                p_pass_id: passId,
                p_staff_id: profile?.id,
                p_confirm_new_package: confirmNewPackage,
                p_selected_ticket_id: selectedTicketId || null
            };

            const { data, error } = await supabase.rpc('checkin_pass_and_issue_ticket', payload);

            if (error) {
                setCheckinError(error.message);
                return;
            }

            // --- Handle Multi-Package Selection ---
            if (!data.success && data.needs_package_selection) {
                setAvailablePackages(data.available_packages || []);
                setPendingCheckinCode(passId);
                setShowPackageSelectModal(true);
                return;
            }

            // --- Cảnh báo kích hoạt gói mới ---
            if (!data.success && data.needs_confirmation) {
                const info = data.new_package_info;
                const catLabel = info.category === 'LESSON' ? 'Gói học bơi' : 'Gói bơi';
                const headerMsg = data.message || 'Xác nhận kích hoạt gói';

                // Nhả khóa trước khi mở popup confirm để lần gọi đệ quy không bị chặn
                isCheckingInRef.current = false;

                const confirmed = await showConfirm({
                    title: 'Kích hoạt gói mới',
                    message: headerMsg,
                    icon: '📦',
                    type: 'warning',
                    confirmText: '⚡ Kích hoạt & Trừ 1 buổi',
                    cancelText: 'Không kích hoạt',
                    details: [
                        { label: 'Khách hàng', value: info.customer_name || 'N/A' },
                        { label: 'Loại gói', value: `${catLabel} — ${info.type_name}` },
                        { label: 'Số buổi', value: `${info.total_sessions || info.remaining_sessions || 'Không giới hạn'}` },
                    ],
                });

                if (confirmed) {
                    await doCheckin(passId, true, data.selected_ticket_id || undefined);
                }
                return;
            }

            if (!data.success) {
                setCheckinError(data.message);
                return;
            }

            // --- Success ---
            const passCategory = data.pass_status.category || '';
            const passTypeName = data.pass_status.type_name || '';
            toast.success(
                data.is_new_package ? '🆕 Kích hoạt gói mới thành công' : '✅ Check-in thành công',
                `📦 Gói: ${passTypeName}\n` +
                (data.pass_status.remaining_sessions !== null ? `Còn lại: ${data.pass_status.remaining_sessions} buổi.` : 'Không giới hạn lượt.') +
                (data.requires_gate_ticket === false ? '\n📋 Chỉ điểm danh (không in vé cổng).' : '')
            );

            // --- Cập nhật giao diện in vé con (hỗ trợ cả tickets_issued từ migration 054/058 và new_tickets cũ) ---
            if (data.requires_gate_ticket !== false) {
                const todayLocal = getTodayLocalVN();
                let newTix: any[] = [];
                if (Array.isArray(data.tickets_issued) && data.tickets_issued.length > 0) {
                    newTix = data.tickets_issued;
                } else if (Array.isArray(data.new_tickets) && data.new_tickets.length > 0) {
                    newTix = data.new_tickets;
                } else if (data.ticket_issued) {
                    newTix = [data.ticket_issued];
                } else if (data.new_ticket) {
                    newTix = [data.new_ticket];
                }

                if (newTix.length > 0) {
                    setSoldTickets(newTix.map((t: any) => ({
                        id: t.id,
                        ticket_type_id: '',
                        status: 'UNUSED',
                        customer_birth_year: null,
                        price_paid: t.price_paid,
                        sold_at: t.sold_at,
                        valid_from: todayLocal,
                        valid_until: todayLocal,
                        type_name: t.type_name,
                        pool_close_time: t.pool_close_time,
                        remaining_sessions: 1,
                        customer_name: t.customer_name,
                        customer_phone: null,
                        sold_by: profile?.id || null,
                        last_scan_direction: null,
                        last_scan_at: null,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                        payment_method: 'CASH',
                        pass_category: passCategory,
                        pass_remaining_sessions: data.pass_status.remaining_sessions
                    })));
                }
            }

            setCheckinCode('');
            if (historyMode === 'TODAY') fetchCheckinHistory();
        } finally {
            isCheckingInRef.current = false;
        }
    }

    async function handleCheckinSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCheckinError('');
        if (!checkinCode.trim() || checkingIn || isCheckingInRef.current) return;

        setCheckingIn(true);
        const code = sanitizePostgrestTerm(checkinCode.trim().toUpperCase());

        // Pre-fetch ticket information for preview popup
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const isUuid = uuidRegex.test(code);

        // Find matching customer by card code to also search tickets by customer_id
        const { data: customerData } = await supabase.from('customers').select('id').ilike('card_code', `%${code}%`);
        const customerIds = customerData?.map(c => c.id) || [];

        let orFilter = isUuid ? `id.eq.${code},card_code.ilike.%${code}%` : `card_code.ilike.%${code}%`;
        if (customerIds.length > 0) {
            orFilter += `,customer_id.in.(${customerIds.join(',')})`;
        }

        const { data: tickets, error } = await supabase
            .from('tickets')
            .select(`
                *,
                ticket_types!inner (name, category, session_count, sport_type)
            `)
            .or(orFilter)
            .neq('status', 'CANCELLED')
            .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
            .order('sold_at', { ascending: false });

        if (error || !tickets || tickets.length === 0) {
            await doCheckin(code);
            setCheckingIn(false);
            return;
        }

        const validTickets = tickets.filter(t => t.status !== 'EXPIRED');

        if (validTickets.length === 0) {
            await doCheckin(code);
            setCheckingIn(false);
            return;
        }

        const uniqueTypes = new Set(validTickets.map(t => t.ticket_type_id));
        if (uniqueTypes.size > 1) {
            await doCheckin(code);
            setCheckingIn(false);
            return;
        }

        setPreviewTicket(validTickets[0]);
        setCheckingIn(false);
    }

    async function handleSelectPackage(ticketId: string) {
        setShowPackageSelectModal(false);
        setCheckingIn(true);
        await doCheckin(pendingCheckinCode.trim().toUpperCase(), false, ticketId);
        setCheckingIn(false);
    }

    async function handleCancelCheckinHistoryItem(h: any) {
        if (profile?.role !== 'ADMIN') return;
        const reason = window.prompt(`Nhập lý do hủy lượt check-in của "${h.customer_name || 'Khách'}":`, 'Check-in nhầm');
        if (!reason || !reason.trim()) return;

        // Ưu tiên gọi RPC cancel_checkin_log (hỗ trợ cả vé không qua cổng), fallback sang cancel_ticket
        if (h.isFromCheckinLogs) {
            const { data, error } = await supabase.rpc('cancel_checkin_log', {
                p_log_id: h.id,
                p_reason: reason.trim(),
                p_cancelled_by: profile.id
            });
            if (error && (error.code === 'PGRST202' || error.message?.includes('cancel_checkin_log'))) {
                if (h.gate_ticket_id) {
                    const fallbackRes = await supabase.rpc('cancel_ticket', {
                        p_ticket_id: h.gate_ticket_id,
                        p_reason: reason.trim(),
                        p_cancelled_by: profile.id
                    });
                    if (fallbackRes.error || !fallbackRes.data?.success) {
                        toast.error('Lỗi hủy check-in', fallbackRes.error?.message || fallbackRes.data?.message);
                        return;
                    }
                    await supabase.from('checkin_logs').update({ status: 'CANCELLED' }).eq('id', h.id);
                    toast.success('Đã hủy check-in', fallbackRes.data.message);
                    fetchCheckinHistory(historyMode === 'SEARCH' ? historySearchTerm : undefined);
                    return;
                }
                toast.error('Cần cập nhật DB', 'Vui lòng chạy file migration 058 trên Supabase để hủy lượt điểm danh không in vé cổng.');
                return;
            }
            if (error || !data?.success) {
                toast.error('Lỗi hủy check-in', error?.message || data?.message);
                return;
            }
            toast.success('Đã hủy check-in', data.message);
            fetchCheckinHistory(historyMode === 'SEARCH' ? historySearchTerm : undefined);
        } else {
            const { data, error } = await supabase.rpc('cancel_ticket', {
                p_ticket_id: h.id,
                p_reason: reason.trim(),
                p_cancelled_by: profile.id
            });
            if (error || !data?.success) {
                toast.error('Lỗi hủy vé', error?.message || data?.message);
                return;
            }
            toast.success('Đã hủy check-in', data.message);
            fetchCheckinHistory(historyMode === 'SEARCH' ? historySearchTerm : undefined);
        }
    }

    // Auto focus scanner if tab changes to CHECKIN
    useEffect(() => {
        if (activeTab === 'CHECKIN' && scannerInputRef.current) {
            scannerInputRef.current.focus();
        }
        if (activeTab === 'CHECKIN') {
            fetchCheckinHistory();
        }
    }, [activeTab]);

    async function fetchCheckinHistory(searchQuery?: string) {
        setLoadingHistory(true);
        try {
            const todayStr = getTodayLocalVN();

            // --- TRY 1: Query from checkin_logs (new table, correct package names) ---
            let logQuery = supabase
                .from('checkin_logs')
                .select(`
                    id, source_ticket_id, gate_ticket_id, customer_id, customer_name, card_code,
                    ticket_type_name, ticket_category, sport_type, remaining_sessions,
                    is_new_activation, requires_gate_ticket, checked_in_at, checked_in_by, status,
                    profiles:checked_in_by (full_name)
                `);

            if (searchQuery && searchQuery.trim().length >= 2) {
                const term = sanitizePostgrestTerm(searchQuery);
                const { data: mc } = await supabase.from('customers').select('id')
                    .or(`card_code.ilike.%${term}%,full_name.ilike.%${term}%,phone.ilike.%${term}%`);
                const cids = (mc || []).map((c: any) => c.id);
                let orP = `card_code.ilike.%${term}%,customer_name.ilike.%${term}%`;
                if (cids.length > 0) orP += `,customer_id.in.(${cids.join(',')})`;
                logQuery = logQuery.or(orP).order('checked_in_at', { ascending: false }).limit(100);
            } else {
                logQuery = logQuery.gte('checked_in_at', `${todayStr}T00:00:00+07:00`)
                    .lte('checked_in_at', `${todayStr}T23:59:59.999+07:00`)
                    .order('checked_in_at', { ascending: false });
            }

            const { data: logs, error: logError } = await logQuery;

            if (!logError && logs && logs.length > 0) {
                const mapped = logs.map((log: any) => ({
                    id: log.id, customer_name: log.customer_name, card_code: log.card_code,
                    customer_id: log.customer_id,
                    status: log.status === 'CANCELLED' ? 'CANCELLED' : 'UNUSED',
                    sold_at: log.checked_in_at, sold_by: log.checked_in_by,
                    ticket_type_name: log.ticket_type_name, ticket_category: log.ticket_category,
                    sport_type: log.sport_type, remaining_sessions: log.remaining_sessions,
                    is_new_activation: log.is_new_activation, requires_gate_ticket: log.requires_gate_ticket,
                    profiles: log.profiles, isCancelled: log.status === 'CANCELLED', cancellation: null,
                    gate_ticket_id: log.gate_ticket_id, source_ticket_id: log.source_ticket_id,
                    isFromCheckinLogs: true,
                }));
                setCheckinHistory(mapped);
                setLoadingHistory(false);
                return;
            }

            // --- FALLBACK: Query from tickets table (old system, backward compatible) ---
            let oldQuery = supabase.from('tickets')
                .select(`id, customer_name, customer_phone, card_code, customer_id, status,
                    sold_at, sold_by, ticket_type_id,
                    ticket_types!inner (name, category, sport_type),
                    profiles:sold_by (full_name)`)
                .eq('price_paid', 0).eq('total_sessions', 1);

            if (searchQuery && searchQuery.trim().length >= 2) {
                const term = sanitizePostgrestTerm(searchQuery);
                const { data: mc } = await supabase.from('customers').select('id')
                    .or(`card_code.ilike.%${term}%,full_name.ilike.%${term}%,phone.ilike.%${term}%`);
                const cids = (mc || []).map((c: any) => c.id);
                let orP = `card_code.ilike.%${term}%,customer_name.ilike.%${term}%,customer_phone.ilike.%${term}%`;
                if (cids.length > 0) orP += `,customer_id.in.(${cids.join(',')})`;
                oldQuery = oldQuery.or(orP).order('sold_at', { ascending: false }).limit(100);
            } else {
                oldQuery = oldQuery.gte('sold_at', `${todayStr}T00:00:00+07:00`)
                    .lte('sold_at', `${todayStr}T23:59:59.999+07:00`)
                    .order('sold_at', { ascending: false });
            }

            const { data: oldTickets, error: oldErr } = await oldQuery;
            if (oldErr) { console.error('Fallback error:', oldErr); setCheckinHistory([]); setLoadingHistory(false); return; }

            const oldMapped = (oldTickets || []).map((t: any) => ({
                ...t,
                ticket_type_name: (t.ticket_types as any)?.name || 'N/A',
                ticket_category: (t.ticket_types as any)?.category || '',
                sport_type: (t.ticket_types as any)?.sport_type || 'SWIMMING',
                profiles: t.profiles, isCancelled: t.status === 'CANCELLED', cancellation: null,
            }));
            setCheckinHistory(oldMapped);
        } catch (err) {
            console.error('Error fetching check-in history:', err);
            setCheckinHistory([]);
        }
        setLoadingHistory(false);
    }

    const dailyTypes = ticketTypes.filter(t => t.category === 'DAILY');
    const advancedTypes = ticketTypes.filter(t => t.category === 'MONTHLY' || t.category === 'MULTI');
    const lessonTypes = ticketTypes.filter(t => t.category === 'LESSON');

    if (loading) return <div className="page-loading">Đang tải...</div>;

    // --- Compact tile renderer (Theme-aware) ---
    const getSoftToneBg = (borderColor: string) => {
        if (borderColor === '#3b82f6') return 'var(--accent-blue-soft)';
        if (borderColor === '#8b5cf6') return 'var(--accent-purple-soft)';
        if (borderColor === '#10b981') return 'var(--accent-green-soft)';
        return 'var(--accent-orange-soft)';
    };

    const renderTile = (item: { id: string; name: string; icon: string; price: number; borderColor: string; badge?: string; badge2?: string; badgeColor?: string; disabled?: boolean; onClick: () => void }) => (
        <button
            key={item.id}
            type="button"
            onClick={item.onClick}
            disabled={selling || item.disabled}
            className="pos-tile"
        >
            <div className="pos-tile-top">
                <span className="pos-tile-icon" style={{ background: getSoftToneBg(item.borderColor) }}>
                    {item.icon}
                </span>
                {item.badge && (
                    <span className="pos-tile-badge" title={item.badge}>
                        {item.badge}
                    </span>
                )}
            </div>
            <div>
                <div className="pos-tile-name">{item.name}</div>
                <div className="pos-tile-price" style={{ color: item.borderColor }}>
                    {item.price.toLocaleString('vi-VN')}đ
                </div>
                {item.badge2 && (
                    <div className="pos-tile-badges" style={{ marginTop: '6px' }}>
                        <span className="pos-tile-badge">{item.badge2}</span>
                    </div>
                )}
            </div>
        </button>
    );

    // Build a unified "all items" list for the grid
    type PosItem = { id: string; name: string; description?: string; icon: string; price: number; borderColor: string; badge?: string; badge2?: string; badgeColor?: string; disabled?: boolean; onClick: () => void; filterCat: 'DAILY' | 'ADVANCED' | 'LESSON' | 'PRODUCT' };
    const allPosItems: PosItem[] = [
        ...dailyTypes.map((t): PosItem => ({
            id: t.id, name: t.name, description: t.description || '', icon: '🎫', price: t.price,
            borderColor: '#3b82f6', badge: t.validity_days ? `⏱ ${t.validity_days}d` : '⏱ Ngày', badge2: t.session_count ? `🏊 ${t.session_count}` : '🏊 ∞',
            badgeColor: '#dbeafe', disabled: false, onClick: () => handleDailySaleClick(t), filterCat: 'DAILY'
        })),
        ...advancedTypes.map((t): PosItem => ({
            id: t.id, name: t.name, description: t.description || '', icon: t.category === 'MONTHLY' ? '📅' : '🔢', price: t.price,
            borderColor: '#8b5cf6', badge: t.validity_days ? `⏱ ${t.validity_days}d` : undefined, badge2: t.session_count ? `🏊 ${t.session_count}` : '🏊 ∞',
            badgeColor: '#ede9fe', disabled: false, onClick: () => sellTicket(t), filterCat: 'ADVANCED'
        })),
        ...lessonTypes.map((t): PosItem => {
            const label = getClassLabel(t);
            return {
                id: t.id, name: t.name, description: t.description || '', icon: '📚', price: t.price,
                borderColor: '#10b981', badge: label, badge2: isPrivateLesson(t) ? '🧑‍🏫 Riêng' : `🏊 ${t.session_count || '?'}`,
                badgeColor: '#d1fae5', disabled: false, onClick: () => sellTicket(t), filterCat: 'LESSON'
            };
        }),
        ...products.filter(p => p.parent_id === null).map((p): PosItem => {
            const variants = products.filter(v => v.parent_id === p.id && v.is_active);
            const hasVariants = variants.length > 0;
            const totalStock = hasVariants
                ? variants.reduce((sum, v) => sum + v.stock_quantity, 0)
                : p.stock_quantity;

            return {
                id: p.id, name: p.name, description: p.sku ? `${p.sku}` : '', icon: '🥤', price: p.price,
                borderColor: '#f59e0b',
                badge: hasVariants ? `${variants.length} Lựa chọn` : totalStock <= 0 ? '❌ Hết hàng' : `Kho: ${totalStock} ${p.unit || ''}`,
                badgeColor: hasVariants ? '#fef3c7' : totalStock <= 0 ? '#fee2e2' : '#fef3c7',
                disabled: !hasVariants && totalStock <= 0,
                onClick: () => {
                    if (hasVariants) {
                        setSelectingVariantFor(p);
                    } else {
                        handleProductSaleClick(p);
                    }
                }, filterCat: 'PRODUCT'
            };
        }),
    ];

    // Filter items
    const filteredItems = allPosItems.filter(item => {
        if (activeCategory !== 'ALL' && item.filterCat !== activeCategory) return false;
        if (searchTerm.trim()) {
            const q = searchTerm.toLowerCase();
            return item.name.toLowerCase().includes(q) || (item.description || '').toLowerCase().includes(q);
        }
        return true;
    });

    const categoryTabs: { key: typeof activeCategory; label: string; icon: string; count: number }[] = [
        { key: 'ALL', label: 'Tất cả', icon: '📋', count: allPosItems.length },
        { key: 'DAILY', label: 'Vé Lượt', icon: '🎫', count: dailyTypes.length },
        { key: 'ADVANCED', label: 'Vé Gói', icon: '🔢', count: advancedTypes.length },
        { key: 'LESSON', label: 'Khóa Học', icon: '📚', count: lessonTypes.length },
        { key: 'PRODUCT', label: 'Sản Phẩm', icon: '🥽', count: products.length },
    ];

    // Show Master Receipt 
    if (checkoutReceipt) {
        const isA5 = bizInfo.print_format === 'A5';
        const printReceipt = () => {
            const content = document.querySelector('.checkout-receipt-card')?.innerHTML || '';
            const htmlParts = [
                '<!DOCTYPE html>',
                '<html>',
                '<head>',
                '<meta charset="utf-8">',
                '<title>In Hóa Đơn</title>',
                '<style>',
                '@page { size: ' + (isA5 ? 'A5 relative' : '80mm auto') + '; margin: 0; }',
                '@media screen { body { width: ' + (isA5 ? '100%' : '80mm') + '; aspect-ratio: 4/3; margin: 0 auto; overflow: hidden; } }',
                '@media print { * { color: #000 !important; background: transparent !important; } body { font-weight: bold !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; } }',
                '* { margin: 0; padding: 0; box-sizing: border-box; }',
                '.text-center { text-align: center; }',
                '.mb-2 { margin-bottom: 8px; }',
                '.mb-4 { margin-bottom: 16px; }',
                'h1 { font-size: ' + (isA5 ? '24px' : '18px') + '; text-transform: uppercase; margin-bottom: 4px; }',
                'h2 { font-size: ' + (isA5 ? '20px' : '16px') + '; text-transform: uppercase; margin-bottom: 16px; border-bottom: 2px dashed #000; padding-bottom: 8px; }',
                '.row { display: flex; justify-content: space-between; margin-bottom: 4px; }',
                '.bold { font-weight: bold; }',
                '.items-table { width: 100%; border-collapse: collapse; margin-top: 12px; margin-bottom: 12px; }',
                '.items-table th, .items-table td { border-bottom: 1px dashed #ccc; padding: 6px 0; text-align: right; }',
                '.items-table th:first-child, .items-table td:first-child { text-align: left; }',
                '.total-row { font-size: ' + (isA5 ? '20px' : '16px') + '; font-weight: bold; margin-top: 12px; padding-top: 12px; border-top: 2px dashed #000; }',
                '</style>',
                '</head>',
                '<body>',
                content,
                '</body>',
                '</html>'
            ];

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
                toast.error('Lỗi in', 'Không thể khởi tạo trình in bộ nhớ tạm.');
                return;
            }

            win.document.open();
            win.document.write(htmlParts.join('\n'));
            win.document.close();

            // Transition to ticket popups after invoice
            setTimeout(() => {
                win.focus();
                win.print();
                setTimeout(() => {
                    document.body.removeChild(iframe);
                    setCheckoutReceipt(null);
                    if (pendingTickets.length > 0) {
                        setSoldTickets(pendingTickets);
                        setPendingTickets([]);
                    }
                }, 500);
            }, 300);
        };

        return (
            <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
                <div style={{ background: '#fff', padding: '24px', borderRadius: '16px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)', maxWidth: '400px', width: '100%' }}>
                    <div className="checkout-receipt-card" style={{ color: '#000' }}>
                        <div className="text-center mb-4">
                            {bizInfo.business_logo && <img src={bizInfo.business_logo} alt="Logo" style={{ maxHeight: '50px', marginBottom: '8px' }} />}
                            <h1>{bizInfo.business_name || 'Hệ Thống Vé Bơi'}</h1>
                            {bizInfo.business_address && <div style={{ fontSize: '12px' }}>{bizInfo.business_address}</div>}
                            {bizInfo.business_phone && <div style={{ fontSize: '12px' }}>ĐT: {bizInfo.business_phone}</div>}
                        </div>

                        <h2 className="text-center">HÓA ĐƠN BÁN HÀNG</h2>

                        <div className="row" style={{ fontSize: '12px' }}><span>Ngày:</span> <span>{new Date(checkoutReceipt.createdAt).toLocaleString('vi-VN')}</span></div>
                        <div className="row" style={{ fontSize: '12px' }}><span>Mã HĐ:</span> <span>{checkoutReceipt.order_id.substring(0, 8).toUpperCase()}</span></div>
                        <div className="row" style={{ fontSize: '12px' }}><span>Thu ngân:</span> <span>{profile?.full_name || 'Admin'}</span></div>
                        {(checkoutReceipt.customerName || checkoutReceipt.customerPhone) && (
                            <div className="row" style={{ fontSize: '12px' }}>
                                <span>Khách:</span>
                                <span>{checkoutReceipt.customerName || ''} {checkoutReceipt.customerPhone ? `- ${checkoutReceipt.customerPhone}` : ''}</span>
                            </div>
                        )}

                        <table className="items-table" style={{ fontSize: '13px' }}>
                            <thead>
                                <tr>
                                    <th>Tên Hàng</th>
                                    <th>SL</th>
                                    <th>Đ.Giá</th>
                                    <th>T.Tiền</th>
                                </tr>
                            </thead>
                            <tbody>
                                {checkoutReceipt.items.map((it: any, i: number) => (
                                    <tr key={i}>
                                        <td>
                                            {it.name}
                                            {it.promoName && (
                                                <div style={{ fontSize: '10px', color: '#059669', fontWeight: 600, marginTop: '2px' }}>
                                                    🎁 {it.promoName} ({it.promoLabel})
                                                </div>
                                            )}
                                        </td>
                                        <td>{it.quantity}</td>
                                        <td>{it.unitPrice.toLocaleString('vi-VN')}</td>
                                        <td>{it.subtotal.toLocaleString('vi-VN')}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>

                        <div className="row total-row">
                            <span>TỔNG CỘNG:</span>
                            <span>{checkoutReceipt.totalPrice.toLocaleString('vi-VN')}đ</span>
                        </div>
                        <div className="row" style={{ fontSize: '13px', marginTop: '8px' }}>
                            <span>Thanh toán:</span>
                            <span>{checkoutReceipt.paymentMethod === 'CASH' ? 'Tiền mặt' : checkoutReceipt.paymentMethod === 'TRANSFER' ? 'Chuyển khoản' : checkoutReceipt.paymentMethod === 'TRANSFER_COMPANY' ? 'Chuyển khoản công ty' : 'Thẻ POS'}</span>
                        </div>

                        <div className="text-center" style={{ marginTop: '24px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 'bold' }}>Cảm ơn quý khách - hẹn gặp lại</div>
                            <div style={{ marginTop: '8px', fontSize: '11px', color: '#555', fontStyle: 'italic' }}>phần mềm quản lý vé bơi Min.ads Soff - 0932798996</div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '12px', marginTop: '24px' }}>
                        <button id="btn-print-receipt" className="btn btn-primary" style={{ flex: 1, padding: '12px' }} onClick={printReceipt}>
                            🖨️ In Hóa Đơn <span style={{ fontSize: '11px', opacity: 0.8, marginLeft: '4px' }}>(Enter)</span>
                        </button>
                        <button className="btn btn-secondary" style={{ flex: 1, padding: '12px' }} onClick={() => { setCheckoutReceipt(null); setPendingTickets([]); setSoldTickets([]); }}>
                            ← Bán vé tiếp <span style={{ fontSize: '11px', opacity: 0.8, marginLeft: '4px' }}>(ESC)</span>
                        </button>
                    </div>
                </div>

                {/* TỰ ĐỘNG IN VÉ (ẨN) */}
                {soldTickets.length > 0 && (
                    <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', visibility: 'hidden' }}>
                        <div className="sold-ticket-card" ref={printRef}>
                            {soldTickets.map((ticket, index) => (
                                <div className="ticket-print" key={ticket.id}>
                                    <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                                        {bizInfo.business_logo && <img src={bizInfo.business_logo} alt="Logo" style={{ maxHeight: '40px', marginBottom: '4px' }} />}
                                        <div className="subtitle" style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>{bizInfo.business_name || 'Hệ Thống Vé Bơi'}</div>
                                    </div>
                                    {/* Tiêu đề vé phân biệt theo loại */}
                                    <h2>{ticket.pass_category === 'LESSON' ? '📚 VÉ HỌC BƠI' : ticket.pass_category ? '🏊 VÉ BƠI TRẢ TRƯỚC' : '🏊 VÉ BƠI'}</h2>

                                    {ticket.pass_category !== 'LESSON' ? (
                                        <div><strong>Khách hàng:</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                    ) : (() => {
                                        const names = (ticket.customer_name || 'Khách Vãng Lai').split(' + ');
                                        if (names.length <= 1) {
                                            return (
                                                <>
                                                    <div><strong>Học viên 1:</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                                    {(ticket as any).customer_name_2 && (
                                                        <div><strong>Học viên 2:</strong> {(ticket as any).customer_name_2} - NS: {(ticket as any).customer_birth_year_2 || 'N/A'}</div>
                                                    )}
                                                </>
                                            );
                                        }
                                        return names.map((n, idx) => {
                                            let val = n;
                                            if (idx === 1 && (ticket as any).customer_name_2 && (ticket as any).customer_birth_year_2) val = `${n} - NS: ${(ticket as any).customer_birth_year_2}`;
                                            return <div key={idx}><strong>Học viên {idx + 1}:</strong> {val}</div>;
                                        });
                                    })()}
                                    {(ticket as any).guardian_name && (
                                        <div style={{ fontSize: '11px', marginTop: '2px' }}><strong>Giám hộ:</strong> {(ticket as any).guardian_name} - {(ticket as any).guardian_phone}</div>
                                    )}
                                    <div><strong>Hiệu lực:</strong> {ticket.valid_from === ticket.valid_until ? 'Trong ngày' : `${ticket.valid_from} → ${ticket.valid_until} `}</div>

                                    {/* Số buổi còn lại (từ gói gốc) cho vé trả trước / học bơi */}
                                    {ticket.pass_category && ticket.pass_remaining_sessions !== undefined && ticket.pass_remaining_sessions !== null && (
                                        <div style={{ marginTop: '6px', fontWeight: 'bold', borderTop: '1px dashed #ccc', paddingTop: '6px', fontSize: '14px' }}>
                                            {ticket.pass_category === 'LESSON' ? 'Số buổi học còn lại' : 'Số buổi bơi còn lại'}: {ticket.pass_remaining_sessions} buổi
                                        </div>
                                    )}

                                    {/* Chỉ hiển thị giá cho vé bơi thường (không phải check-in trả trước) */}
                                    {!ticket.pass_category && (
                                        <div className="info-row">
                                            <span className="label">Giá</span>
                                            <span className="value">{formatPrice(ticket.price_paid)}</span>
                                        </div>
                                    )}
                                    <div className="info-row">
                                        <span className="label">{ticket.pass_category ? 'Check-in lúc' : 'Bán lúc'}</span>
                                        <span className="value">{formatTime(ticket.sold_at)}</span>
                                    </div>
                                    <div className="info-row">
                                        <span className="label">Hết hạn</span>
                                        <span className="value">Hôm nay, {bizInfo.pool_close_time || '20:00'}</span>
                                    </div>

                                    <div className="qr-wrapper">
                                        <QRCodeSVG
                                            value={ticket.id}
                                            size={180}
                                            level="H"
                                            includeMargin
                                        />
                                    </div>

                                    <p className="footer">
                                        Vui lòng xuất trình mã QR tại cổng kiểm soát.<br />
                                        Mã vé: {ticket.id.substring(0, 8).toUpperCase()}
                                        {soldTickets.length > 1 && <span style={{ display: 'block', marginTop: '4px', fontWeight: 'bold' }}>{`(${index + 1}/${soldTickets.length})`}</span>}
                                        <span style={{ display: 'block', marginTop: '16px', fontSize: '10px', color: '#555', fontStyle: 'italic' }}>phần mềm quản lý vé bơi Min.ads Soff - 0932798996</span>
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    // Show sold ticket with QR
    if (soldTickets.length > 0) {
        return (
            <div className="page-container">
                <div className="sold-ticket-view">
                    <div className="sold-ticket-card" ref={printRef}>
                        {soldTickets.map((ticket, index) => (
                            <div className="ticket-print" key={ticket.id}>
                                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                                    {bizInfo.business_logo && <img src={bizInfo.business_logo} alt="Logo" style={{ maxHeight: '40px', marginBottom: '4px' }} />}
                                    <div className="subtitle" style={{ fontSize: '10px', textTransform: 'uppercase', fontWeight: 600 }}>{bizInfo.business_name || 'Hệ Thống Vé Bơi'}</div>
                                </div>
                                {/* Tiêu đề vé phân biệt theo loại */}
                                <h2>{ticket.pass_category === 'LESSON' ? '📚 VÉ HỌC BƠI' : ticket.pass_category ? '🏊 VÉ BƠI TRẢ TRƯỚC' : '🏊 VÉ BƠI'}</h2>

                                {ticket.pass_category !== 'LESSON' ? (
                                    <div><strong>Khách hàng:</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                ) : (() => {
                                    const names = (ticket.customer_name || 'Khách Vãng Lai').split(' + ');
                                    if (names.length <= 1) {
                                        return (
                                            <>
                                                <div><strong>Học viên 1:</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                                {(ticket as any).customer_name_2 && (
                                                    <div><strong>Học viên 2:</strong> {(ticket as any).customer_name_2} - NS: {(ticket as any).customer_birth_year_2 || 'N/A'}</div>
                                                )}
                                            </>
                                        );
                                    }
                                    return names.map((n, idx) => {
                                        let val = n;
                                        if (idx === 1 && (ticket as any).customer_name_2 && (ticket as any).customer_birth_year_2) val = `${n} - NS: ${(ticket as any).customer_birth_year_2}`;
                                        return <div key={idx}><strong>Học viên {idx + 1}:</strong> {val}</div>;
                                    });
                                })()}
                                {(ticket as any).guardian_name && (
                                    <div style={{ fontSize: '11px', marginTop: '2px' }}><strong>Giám hộ:</strong> {(ticket as any).guardian_name} - {(ticket as any).guardian_phone}</div>
                                )}
                                <div><strong>Hiệu lực:</strong> {ticket.valid_from === ticket.valid_until ? 'Trong ngày' : `${ticket.valid_from} → ${ticket.valid_until} `}</div>

                                {/* Số buổi còn lại (từ gói gốc) cho vé trả trước / học bơi */}
                                {ticket.pass_category && ticket.pass_remaining_sessions !== undefined && ticket.pass_remaining_sessions !== null && (
                                    <div style={{ marginTop: '6px', fontWeight: 'bold', borderTop: '1px dashed #ccc', paddingTop: '6px', fontSize: '14px' }}>
                                        {ticket.pass_category === 'LESSON' ? 'Số buổi học còn lại' : 'Số buổi bơi còn lại'}: {ticket.pass_remaining_sessions} buổi
                                    </div>
                                )}

                                {/* Chỉ hiển thị giá cho vé bơi thường (không phải check-in trả trước) */}
                                {!ticket.pass_category && (
                                    <div className="info-row">
                                        <span className="label">Giá</span>
                                        <span className="value">{formatPrice(ticket.price_paid)}</span>
                                    </div>
                                )}
                                <div className="info-row">
                                    <span className="label">{ticket.pass_category ? 'Check-in lúc' : 'Bán lúc'}</span>
                                    <span className="value">{formatTime(ticket.sold_at)}</span>
                                </div>
                                <div className="info-row">
                                    <span className="label">Hết hạn</span>
                                    <span className="value">Hôm nay, {bizInfo.pool_close_time || '20:00'}</span>
                                </div>

                                <div className="qr-wrapper">
                                    <QRCodeSVG
                                        value={ticket.id}
                                        size={180}
                                        level="H"
                                        includeMargin
                                    />
                                </div>

                                <p className="footer">
                                    Vui lòng xuất trình mã QR tại cổng kiểm soát.<br />
                                    Mã vé: {ticket.id.substring(0, 8).toUpperCase()}
                                    {soldTickets.length > 1 && <span style={{ display: 'block', marginTop: '4px', fontWeight: 'bold' }}>{`(${index + 1}/${soldTickets.length})`}</span>}
                                    <span style={{ display: 'block', marginTop: '16px', fontSize: '10px', color: '#555', fontStyle: 'italic' }}>phần mềm quản lý vé bơi Min.ads Soff - 0932798996</span>
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="sold-ticket-actions">
                        <button className="btn btn-primary" onClick={() => handlePrint()}>
                            🖨️ In Vé <span style={{ fontSize: '11px', opacity: 0.8, marginLeft: '4px' }}>(Enter)</span>
                        </button>
                        <button className="btn btn-secondary" onClick={() => setSoldTickets([])}>
                            ← Bán vé tiếp <span style={{ fontSize: '11px', opacity: 0.8, marginLeft: '4px' }}>(ESC)</span>
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <PageHeader
                title={activeTab === 'SELL' ? '🏪 Bán Vé & Bán Hàng' : '💳 Quẹt Thẻ Gói (Check-in)'}
                subtitle={activeTab === 'SELL' ? 'Chọn vé, gói bơi hoặc sản phẩm bán lẻ · Phím tắt F2 / F3 / F4' : 'Quét mã thẻ khách hàng để xác nhận và in vé lượt qua cổng'}
                actions={
                    <SegmentedTabs
                        tabs={[
                            { key: 'SELL', label: 'Bán Hàng (F4)', icon: '🏪' },
                            { key: 'CHECKIN', label: 'Quẹt Thẻ Gói (F2)', icon: '💳' },
                        ]}
                        activeKey={activeTab}
                        onChange={(k) => setActiveTab(k as 'SELL' | 'CHECKIN')}
                    />
                }
            />

            {activeTab === 'SELL' && (
                <div className="pos-layout">

                    {/* LEFT COLUMN: Search + Hotkeys + Filter Tabs + Product Grid */}
                    <div className="pos-catalog-col">
                        <div className="pos-search-bar">
                            <span className="pos-search-icon">🔍</span>
                            <input
                                type="text"
                                className="pos-search-input"
                                placeholder="Tìm sản phẩm, vé lượt, vé tháng, khóa học..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                            {searchTerm && (
                                <button type="button" className="pos-search-clear" onClick={() => setSearchTerm('')}>✕</button>
                            )}
                        </div>

                        {hotkeyCustomers.length > 0 && (
                            <div className="pos-hotkey-strip">
                                <span className="pos-hotkey-label">Khách nhanh:</span>
                                {hotkeyCustomers.map(hc => (
                                    <button
                                        key={hc.id}
                                        type="button"
                                        className={`pos-hotkey-chip ${selectedCustomerId === hc.id ? 'active' : ''}`}
                                        onClick={() => {
                                            setCustomerName(hc.full_name);
                                            setCustomerPhone(hc.phone);
                                            setCardCode(hc.card_code);
                                            setSelectedCustomerId(hc.id);
                                            setSelectedCustomerBirthDate(hc.birth_date || null);
                                        }}
                                    >
                                        <span className="pos-hotkey-kbd">{hc.hotkey}</span>
                                        <span>{hc.full_name}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <SegmentedTabs
                            size="sm"
                            tabs={categoryTabs.map(t => ({ key: t.key, label: t.label, icon: t.icon, count: t.count }))}
                            activeKey={activeCategory}
                            onChange={(k) => setActiveCategory(k)}
                        />

                        {/* Product Grid */}
                        <div className="pos-grid">
                            {filteredItems.length > 0 ? filteredItems.map(item => renderTile(item)) : (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '44px 0', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '38px', marginBottom: '8px' }}>🔍</div>
                                    <p>Không tìm thấy sản phẩm "{searchTerm}"</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: CART */}
                    <div className="pos-cart">
                        <div className="pos-cart-header">
                            <div className="pos-cart-title-row">
                                <h2>🛒 Giỏ hàng</h2>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Badge variant="blue" className="tabular-nums">{cart.length} món</Badge>
                                    {cart.length > 0 && (
                                        <button
                                            type="button"
                                            className="btn btn-ghost btn-sm"
                                            style={{ padding: '3px 8px', color: 'var(--accent-red)' }}
                                            onClick={() => setCart([])}
                                        >
                                            Xóa
                                        </button>
                                    )}
                                </div>
                            </div>

                            {/* ALWAYS-VISIBLE CUSTOMER SEARCH BAR */}
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <div style={{ flex: 1, position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '13px', color: 'var(--text-muted)' }}>🔍</span>
                                    <input
                                        ref={customerSearchRef}
                                        type="text"
                                        className="input"
                                        placeholder="Tìm tên, SĐT, mã thẻ..."
                                        value={custSearchTerm}
                                        onChange={async (e) => {
                                            const term = e.target.value;
                                            setCustSearchTerm(term);
                                            if (term.length < 2) { setCustSearchResults([]); return; }
                                            setSearchingCust(true);
                                            const { data } = await supabase
                                                .from('customers')
                                                .select('*')
                                                .or(`card_code.ilike.%${term}%,phone.ilike.%${term}%,full_name.ilike.%${term}%`)
                                                .order('full_name')
                                                .limit(15);
                                            setCustSearchResults((data || []) as Customer[]);
                                            setSearchingCust(false);
                                        }}
                                        style={{ padding: '7px 36px 7px 30px', fontSize: '12.5px' }}
                                    />
                                    <span style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: 'var(--text-muted)', background: 'var(--bg-subtle)', padding: '1px 5px', borderRadius: '4px', fontWeight: 700 }}>F3</span>
                                </div>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => {
                                        setShowNewCustomerModal(true);
                                        setNewCustCardCode(''); setNewCustName(''); setNewCustPhone('');
                                        setNewCustEmail(''); setNewCustBirthDate(''); setNewCustGender('');
                                        setNewCustNote(''); setNewCustAddress(''); setNewCustHotkey('');
                                    }}
                                    style={{ width: '34px', height: '34px', padding: 0, fontSize: '16px', flexShrink: 0 }}
                                    title="Thêm khách hàng mới"
                                >+</button>
                            </div>

                            {/* Search results dropdown */}
                            {custSearchResults.length > 0 && (
                                <div className="pos-cust-dropdown">
                                    {custSearchResults.map((c, i) => (
                                        <div key={c.id || i} className="pos-cust-option" onClick={() => {
                                            setCustomerName(c.full_name);
                                            setCustomerPhone(c.phone);
                                            setCardCode(c.card_code);
                                            setSelectedCustomerId(c.id);
                                            setSelectedCustomerBirthDate(c.birth_date || null);
                                            setCustSearchResults([]);
                                            setCustSearchTerm('');
                                        }}>
                                            <strong>{c.full_name || 'N/A'}</strong>
                                            <span style={{ marginLeft: '8px', color: 'var(--text-secondary)' }}>📞 {c.phone || '—'}</span>
                                            <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>🏷️ {maskCardCode(c.card_code) || '—'}</span>
                                            {c.hotkey && <Badge variant="blue" className="ml-1">⌨ {c.hotkey}</Badge>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {searchingCust && <span style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px', display: 'block' }}>Đang tìm...</span>}

                            {/* Selected customer info display */}
                            {(cardCode || customerName || customerPhone) && (
                                <div className="pos-cust-selected">
                                    <div style={{ fontSize: '12px', minWidth: 0 }}>
                                        <div style={{ fontWeight: 700, color: 'var(--accent-green)' }}>👤 {customerName || 'Chưa có tên'}</div>
                                        <div style={{ color: 'var(--text-secondary)', marginTop: '2px' }}>
                                            {cardCode && <span>🏷️ {maskCardCode(cardCode)}</span>}
                                            {customerPhone && <span style={{ marginLeft: '8px' }}>📞 {customerPhone}</span>}
                                            {(() => { const hk = hotkeyCustomers.find(c => c.id === selectedCustomerId); return hk?.hotkey ? <Badge variant="blue">⌨ {hk.hotkey}</Badge> : null; })()}
                                        </div>
                                    </div>
                                    <button type="button" onClick={() => {
                                        setCustomerName(''); setCustomerPhone(''); setCardCode('');
                                        setSelectedCustomerId(null); setSelectedCustomerBirthDate(null); setCustSearchTerm('');
                                    }} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>&times;</button>
                                </div>
                            )}
                        </div>

                        <div className="pos-cart-items">
                            {cart.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '36px 0' }}>
                                    <div style={{ fontSize: '36px', marginBottom: '10px' }}>🛍️</div>
                                    <p style={{ fontSize: '13px' }}>Chưa có sản phẩm trong giỏ</p>
                                </div>
                            ) : (
                                cart.map(c => (
                                    <div key={c.cart_id} className="pos-cart-row">
                                        <div style={{ fontWeight: 600, fontSize: '13.5px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                                            <span>{c.item.name} {c.type === 'TICKET' && c.item.category === 'LESSON' ? (c.privateSessions ? `(${c.privateSessions} buổi)` : '') : ''}</span>
                                            <button type="button" onClick={() => setCart(prev => prev.filter(x => x.cart_id !== c.cart_id))} style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', padding: '0 4px', fontSize: '16px', lineHeight: 1 }}>&times;</button>
                                        </div>
                                        {(c.customerName || c.customerName2 || (c as any).extraStudents?.length) && (
                                            <div style={{ fontSize: '11.5px', color: 'var(--text-secondary)' }}>
                                                👤 {c.customerName}{(c as any).extraStudents?.length ? ` & ${(c as any).extraStudents.map((s: any) => s.name).filter(Boolean).join(', ')}` : c.customerName2 ? ` & ${c.customerName2}` : ''}
                                            </div>
                                        )}
                                        {c.promoId && (() => {
                                            const promo = promotions.find(p => p.id === c.promoId);
                                            if (!promo) return null;
                                            const label = promo.type === 'AMOUNT' ? `−${promo.value.toLocaleString('vi-VN')}đ` : promo.type === 'PERCENT' ? `−${promo.value}%` : `+${promo.value} buổi`;
                                            return (
                                                <div style={{ fontSize: '11.5px', color: 'var(--accent-green)', fontWeight: 600 }}>
                                                    🎁 {promo.name} ({label})
                                                </div>
                                            );
                                        })()}
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                            <div className="tabular-nums" style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: '13.5px' }}>{c.unitPrice.toLocaleString('vi-VN')}đ</div>
                                            <div className="pos-qty-stepper">
                                                <button type="button" className="pos-qty-btn" onClick={() => setCart(prev => prev.map(x => x.cart_id === c.cart_id ? { ...x, quantity: Math.max(1, x.quantity - 1), subtotal: Math.max(1, x.quantity - 1) * x.unitPrice } : x))}>−</button>
                                                <span className="tabular-nums" style={{ fontSize: '12.5px', fontWeight: 700, minWidth: '20px', textAlign: 'center' }}>{c.quantity}</span>
                                                <button type="button" className="pos-qty-btn" onClick={() => {
                                                    if (c.type === 'PRODUCT' && c.quantity + 1 > c.item.stock_quantity) {
                                                        toast.warning('Hết hàng', `Sản phẩm chỉ còn ${c.item.stock_quantity} trong kho!`);
                                                        return;
                                                    }
                                                    setCart(prev => prev.map(x => x.cart_id === c.cart_id ? { ...x, quantity: x.quantity + 1, subtotal: (x.quantity + 1) * x.unitPrice } : x));
                                                }}>+</button>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div className="pos-cart-footer">
                            <div className="pos-pay-pills">
                                {([
                                    ['CASH', '💵 Tiền mặt'],
                                    ['TRANSFER', '🏦 Chuyển khoản'],
                                    ['CARD', '💳 Thẻ POS'],
                                    ['TRANSFER_COMPANY', '🏢 CK Công ty'],
                                ] as const).map(([key, label]) => (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`pos-pay-pill ${selectedPaymentMethod === key ? 'active' : ''}`}
                                        onClick={() => setSelectedPaymentMethod(key)}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: '16px', fontWeight: 800 }}>
                                <span>Tổng cộng</span>
                                <span className="tabular-nums" style={{ color: 'var(--accent-green)', fontSize: '20px' }}>{cart.reduce((s, c) => s + c.subtotal, 0).toLocaleString('vi-VN')}đ</span>
                            </div>

                            <button type="button" className="btn btn-primary btn-full" style={{ padding: '12px', fontSize: '14.5px' }} disabled={cart.length === 0 || selling}
                                onClick={() => {
                                    const hasAdvanced = cart.some(c => c.type === 'TICKET' && c.item.category !== 'DAILY');
                                    if (hasAdvanced && (!cardCode.trim() || !customerPhone.trim())) {
                                        toast.warning('Thiếu khách hàng', 'Vui lòng nhập thông tin khách hàng trước khi thanh toán vé gói/thẻ tháng.');
                                        customerSearchRef.current?.focus();
                                        return;
                                    }
                                    setShowPaymentModal(true);
                                }}>
                                Thanh Toán &amp; In Vé
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'CHECKIN' && (
                <div className="pos-checkin-grid">
                    {/* LEFT: SCAN FORM */}
                    <section className="ui-card" style={{ textAlign: 'center', padding: '28px 22px' }}>
                        <div style={{ fontSize: '42px', marginBottom: '12px' }}>💳</div>
                        <h2 style={{ fontSize: '17px', fontWeight: 700, marginBottom: '6px' }}>Quét Thẻ Tháng / Thẻ Nhiều Buổi</h2>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '13px', marginBottom: '20px' }}>
                            Dùng máy quét hoặc nhập mã thẻ để xem trước thông tin gói và in vé lượt qua cổng.
                        </p>

                        <form onSubmit={handleCheckinSubmit}>
                            {checkinError && <div className="alert alert-error">{checkinError}</div>}
                            <input
                                ref={scannerInputRef}
                                type="text"
                                className="input"
                                placeholder="Quét mã QR Thẻ vào đây..."
                                value={checkinCode}
                                onChange={e => setCheckinCode(normalizeScannerInput(e.target.value))}
                                style={{ textAlign: 'center', fontSize: '17px', padding: '14px', marginBottom: '12px', fontWeight: 600 }}
                                autoFocus
                            />
                            <button type="submit" className="btn btn-primary btn-full" style={{ padding: '12px' }} disabled={checkingIn}>
                                {checkingIn ? 'Đang xử lý...' : 'Xác nhận (Enter)'}
                            </button>
                        </form>
                    </section>

                    {/* RIGHT: CHECK-IN HISTORY */}
                    <section className="ui-card ui-card-flush">
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 700 }}>
                                📋 Lịch Sử Check-in Thẻ Gói
                            </h3>
                            <SegmentedTabs
                                size="sm"
                                tabs={[
                                    { key: 'TODAY', label: 'Hôm nay', icon: '📅' },
                                    { key: 'SEARCH', label: 'Tra cứu KH', icon: '🔍' },
                                ]}
                                activeKey={historyMode}
                                onChange={(k) => {
                                    if (k === 'TODAY') {
                                        setHistoryMode('TODAY');
                                        setHistorySearchTerm('');
                                        fetchCheckinHistory();
                                    } else {
                                        setHistoryMode('SEARCH');
                                    }
                                }}
                            />
                        </div>

                        {historyMode === 'SEARCH' && (
                            <div style={{ padding: '14px 20px 0', display: 'flex', gap: '8px' }}>
                                <input
                                    type="text"
                                    className="input"
                                    placeholder="Nhập mã thẻ, tên KH hoặc SĐT..."
                                    value={historySearchTerm}
                                    onChange={e => setHistorySearchTerm(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); fetchCheckinHistory(historySearchTerm); } }}
                                />
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => fetchCheckinHistory(historySearchTerm)}
                                    disabled={loadingHistory || historySearchTerm.trim().length < 2}
                                >
                                    {loadingHistory ? '...' : 'Tìm kiếm'}
                                </button>
                            </div>
                        )}

                        {!loadingHistory && checkinHistory.length > 0 && (
                            <div style={{ padding: '12px 20px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                <Badge variant="green">{checkinHistory.filter(h => !h.isCancelled).length} Thành công</Badge>
                                {checkinHistory.filter(h => h.isCancelled).length > 0 && (
                                    <Badge variant="red">{checkinHistory.filter(h => h.isCancelled).length} Đã hủy</Badge>
                                )}
                                <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Tổng: {checkinHistory.length} lượt</span>
                            </div>
                        )}

                        <div style={{ padding: '0 20px 18px', overflowX: 'auto' }}>
                            {loadingHistory ? (
                                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                                    ⏳ Đang tải...
                                </div>
                            ) : checkinHistory.length === 0 ? (
                                <div style={{ textAlign: 'center', padding: '36px 0', color: 'var(--text-muted)' }}>
                                    <div style={{ fontSize: '30px', marginBottom: '6px' }}>📭</div>
                                    <p style={{ margin: 0, fontSize: '13px' }}>
                                        {historyMode === 'TODAY'
                                            ? 'Chưa có lượt check-in nào hôm nay.'
                                            : 'Không tìm thấy lịch sử check-in cho từ khóa này.'}
                                    </p>
                                </div>
                            ) : (
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Thời gian</th>
                                            <th>Khách hàng</th>
                                            <th>Loại gói</th>
                                            <th style={{ textAlign: 'center' }}>Trạng thái</th>
                                            <th>Nhân viên</th>
                                            {profile?.role === 'ADMIN' && <th style={{ textAlign: 'center' }}>Thao tác</th>}
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {checkinHistory.map((h, idx) => {
                                            const time = new Date(h.sold_at);
                                            const timeStr = time.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
                                            const dateStr = historyMode === 'SEARCH'
                                                ? time.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
                                                : '';
                                            const ticketTypeName = h.ticket_type_name || 'N/A';
                                            const staffName = (h.profiles as any)?.full_name || '—';
                                            const sportIcon = h.sport_type === 'BASKETBALL' ? '🏀' : '🏊';

                                            return (
                                                <tr key={h.id || idx} style={{ opacity: h.isCancelled ? 0.75 : 1 }}>
                                                    <td style={{ whiteSpace: 'nowrap' }} className="tabular-nums">
                                                        <strong>{timeStr}</strong>
                                                        {dateStr && <span style={{ color: 'var(--text-muted)', marginLeft: '4px', fontSize: '11px' }}>{dateStr}</span>}
                                                    </td>
                                                    <td>
                                                        <div style={{ fontWeight: 600 }}>{h.customer_name || 'Khách vãng lai'}</div>
                                                        {h.card_code && (
                                                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                                🏷️ {maskCardCode(h.card_code)}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td>
                                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                            {sportIcon} {ticketTypeName}
                                                        </span>
                                                    </td>
                                                    <td style={{ textAlign: 'center' }}>
                                                        {h.isCancelled ? (
                                                            <div>
                                                                <Badge variant="red">🔄 Đã hủy</Badge>
                                                                {h.cancellation?.sessions_restored > 0 && (
                                                                    <div style={{ fontSize: '10px', color: 'var(--accent-green)', marginTop: '3px', fontWeight: 600 }}>
                                                                        +{h.cancellation.sessions_restored} buổi hoàn trả
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <Badge variant="green">✅ Thành công</Badge>
                                                        )}
                                                    </td>
                                                    <td style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>
                                                        {staffName}
                                                    </td>
                                                    {profile?.role === 'ADMIN' && (
                                                        <td style={{ textAlign: 'center' }}>
                                                            {!h.isCancelled && (
                                                                <button
                                                                    type="button"
                                                                    className="btn btn-sm"
                                                                    style={{ background: '#fee2e2', color: '#dc2626', border: '1px solid #fecaca', padding: '3px 8px', fontSize: '11px' }}
                                                                    onClick={() => handleCancelCheckinHistoryItem(h)}
                                                                >
                                                                    ✕ Hủy
                                                                </button>
                                                            )}
                                                        </td>
                                                    )}
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </section>
                </div>
            )}

            {/* Modal Preview Checkin */}
            {previewTicket && (
                <div className="modal-overlay" onClick={() => setPreviewTicket(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', padding: '28px 24px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '20px' }}>
                            <div style={{ fontSize: '48px', marginBottom: '10px', lineHeight: 1 }}>👤</div>
                            <h2 style={{ fontSize: '20px', marginBottom: '6px' }}>Xác Nhận Check-in</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Kiểm tra thông tin khách hàng trước khi xác nhận</p>
                        </div>

                        <div className="pos-summary-box" style={{ marginBottom: '22px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--border-color)' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Khách hàng</span>
                                <strong style={{ fontSize: '15px', color: 'var(--text-primary)' }}>{previewTicket.customer_name || 'Khách vãng lai'}</strong>
                            </div>

                            {previewTicket.customer_phone && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Số điện thoại</span>
                                    <strong style={{ fontSize: '14px' }}>{previewTicket.customer_phone}</strong>
                                </div>
                            )}

                            {previewTicket.customer_name_2 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--border-color)' }}>
                                    <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Học viên 2</span>
                                    <strong style={{ fontSize: '14px' }}>{previewTicket.customer_name_2}</strong>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--border-color)' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Gói thẻ</span>
                                <span style={{ fontWeight: 700, color: 'var(--accent-blue)', textAlign: 'right', fontSize: '14px' }}>
                                    {previewTicket.ticket_types?.sport_type === 'BASKETBALL'
                                        ? '🏀 ' + previewTicket.ticket_types?.name
                                        : previewTicket.ticket_types?.category === 'LESSON'
                                            ? '📚 Học Bơi'
                                            : '🏊 ' + previewTicket.ticket_types?.name}
                                </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px dashed var(--border-color)' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Số buổi còn lại</span>
                                <strong className="tabular-nums" style={{ fontSize: '15px', color: previewTicket.remaining_sessions !== null && previewTicket.remaining_sessions <= 3 ? 'var(--accent-red)' : 'var(--accent-green)' }}>
                                    {previewTicket.remaining_sessions !== null ? `${previewTicket.remaining_sessions} buổi` : 'Không giới hạn'}
                                </strong>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ color: 'var(--text-secondary)', fontSize: '13.5px' }}>Trạng thái</span>
                                {(() => {
                                    let finalStatus = previewTicket.status;
                                    if (finalStatus !== 'EXPIRED' && finalStatus !== 'CANCELLED') {
                                        const today = new Date().toLocaleDateString('en-CA');
                                        const todayMs = new Date(today).getTime();
                                        const validUntilMs = previewTicket.valid_until ? new Date(previewTicket.valid_until).getTime() : 0;
                                        const daysLeft = validUntilMs ? (validUntilMs - todayMs) / 86400000 : 999;

                                        if (previewTicket.valid_until && previewTicket.valid_until < today) finalStatus = 'EXPIRED';
                                        else if (previewTicket.remaining_sessions !== null && previewTicket.remaining_sessions <= 0) finalStatus = 'EXPIRED';
                                        else if (previewTicket.valid_until && daysLeft <= 7 && daysLeft > 0) finalStatus = 'EXPIRING';
                                        else if (previewTicket.remaining_sessions !== null && previewTicket.remaining_sessions <= 3 && previewTicket.remaining_sessions > 0) finalStatus = 'EXPIRING';
                                        else if (previewTicket.remaining_sessions !== null && previewTicket.total_sessions !== null && previewTicket.remaining_sessions < previewTicket.total_sessions) finalStatus = 'IN_USE';
                                        else if (['IN', 'OUT', 'IN_USE'].includes(finalStatus)) finalStatus = 'IN_USE';
                                        else finalStatus = 'UNUSED';
                                    }
                                    let variant: 'blue' | 'green' | 'amber' | 'red' = 'blue';
                                    let text = 'Chưa sử dụng';
                                    if (['IN_USE', 'ACTIVE'].includes(finalStatus)) { variant = 'green'; text = 'Đang sử dụng'; }
                                    else if (finalStatus === 'EXPIRING') { variant = 'amber'; text = 'Sắp hết hạn'; }
                                    else if (finalStatus === 'EXPIRED') { variant = 'red'; text = 'Hết hạn'; }
                                    return <Badge variant={variant}>{text}</Badge>;
                                })()}
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="button" className="btn btn-outline" style={{ flex: 1, padding: '12px' }} onClick={() => setPreviewTicket(null)}>
                                Hủy (ESC)
                            </button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                style={{ flex: 1, padding: '12px' }}
                                disabled={checkingIn}
                                onClick={async () => {
                                    setCheckingIn(true);
                                    await doCheckin(checkinCode.trim().toUpperCase());
                                    setPreviewTicket(null);
                                    setCheckingIn(false);
                                }}
                            >
                                {checkingIn ? 'Đang xử lý...' : 'Check-in (Enter)'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Bán Vé */}
            {selectedAdvancedType && (
                <div className="modal-overlay">
                    <div className="modal-card">
                        <h2>{selectedAdvancedType.category === 'DAILY' ? 'Xác nhận bán vé' : 'Thông tin khách thẻ'}</h2>

                        {/* Summary Block */}
                        <div className="pos-summary-box" style={{ marginBottom: '20px' }}>
                            <p style={{ margin: 0, fontWeight: 500 }}>{selectedAdvancedType.name}</p>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Tiền thu:</span>
                                <span>
                                    {validatedVoucher ? (() => {
                                        let curr = selectedAdvancedType.price;
                                        if (validatedVoucher.promo_type === 'AMOUNT') curr = Math.max(0, curr - validatedVoucher.promo_value);
                                        if (validatedVoucher.promo_type === 'PERCENT') curr = Math.round(curr * (1 - validatedVoucher.promo_value / 100));
                                        return (
                                            <>
                                                <span style={{ textDecoration: 'line-through', color: '#999', marginRight: '8px', fontSize: '13px' }}>
                                                    {selectedAdvancedType.price.toLocaleString('vi-VN')}đ
                                                </span>
                                                <strong style={{ color: 'var(--accent-green)', fontSize: '18px' }}>
                                                    {curr.toLocaleString('vi-VN')}đ
                                                </strong>
                                            </>
                                        )
                                    })() : (
                                        <strong style={{ color: 'var(--accent-green)', fontSize: '18px' }}>
                                            {selectedAdvancedType.price.toLocaleString('vi-VN')}đ
                                        </strong>
                                    )}
                                </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Số lượt bơi:</span>
                                <span>
                                    {(() => {
                                        let sess = selectedAdvancedType.session_count;
                                        let bonusSessions = 0;
                                        // Auto-applied promo bonus
                                        if (autoAppliedPromo && autoAppliedPromo.type === 'BONUS_SESSION' && sess) {
                                            bonusSessions += autoAppliedPromo.value;
                                        }
                                        // Voucher bonus (only if combinable or no auto-apply)
                                        if (validatedVoucher && validatedVoucher.promo_type === 'BONUS_SESSION' && sess) {
                                            bonusSessions += validatedVoucher.promo_value;
                                        }
                                        if (bonusSessions > 0 && sess) {
                                            return (
                                                <>
                                                    <span style={{ textDecoration: 'line-through', color: '#999', marginRight: '8px', fontSize: '13px' }}>{sess}</span>
                                                    <strong style={{ color: 'var(--accent-blue)' }}>{sess + bonusSessions} lượt</strong>
                                                </>
                                            );
                                        }
                                        return <strong>{sess || 'Không giới hạn'}</strong>;
                                    })()}
                                </span>
                            </div>
                        </div>

                        {/* Auto-applied promotion banner */}
                        {autoAppliedPromo && (
                            <div style={{
                                background: 'linear-gradient(135deg, #dbeafe, #ede9fe)',
                                border: '1px solid #93c5fd',
                                borderRadius: '10px',
                                padding: '12px 16px',
                                marginBottom: '16px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: '8px',
                            }}>
                                <div>
                                    <div style={{ fontSize: '12px', color: '#4338ca', fontWeight: 700, marginBottom: '2px' }}>🎯 Khuyến mãi tự động</div>
                                    <div style={{ fontSize: '14px', fontWeight: 600, color: '#1e40af' }}>
                                        {autoAppliedPromo.name}
                                        <span style={{ marginLeft: '8px', fontWeight: 700, color: '#059669' }}>
                                            {autoAppliedPromo.type === 'AMOUNT' && `-${autoAppliedPromo.value.toLocaleString('vi-VN')}đ`}
                                            {autoAppliedPromo.type === 'PERCENT' && `-${autoAppliedPromo.value}%`}
                                            {autoAppliedPromo.type === 'BONUS_SESSION' && `+${autoAppliedPromo.value} buổi`}
                                        </span>
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => { setAutoAppliedPromo(null); setSelectedPromoId(''); }}
                                    style={{ background: 'rgba(0,0,0,0.08)', border: 'none', borderRadius: '6px', padding: '4px 10px', fontSize: '11px', cursor: 'pointer', color: '#64748b', fontWeight: 600 }}
                                >✕ Bỏ KM</button>
                            </div>
                        )}

                        {/* PRIVATE LESSON (1:1 / 1:2) — Staff enters sessions & duration */}
                        <form onSubmit={handleAdvancedSubmit}>
                            {selectedAdvancedType.category !== 'DAILY' && (
                                <>
                                    {/* Khách hàng thông tin đã được chuyển qua Modal Thanh Toán (Checkout Form) */}
                                </>
                            )}

                            {/* HLV cho Lớp nhóm (GROUP) */}
                            {selectedAdvancedType.category === 'LESSON' && !isPrivateLesson(selectedAdvancedType) && (
                                <div style={{ background: '#eff6ff', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bfdbfe' }}>
                                    <div className="form-group" style={{ marginBottom: '0' }}>
                                        <label>🏊 Huấn luyện viên (HLV)</label>
                                        <select
                                            value={selectedCoachId}
                                            onChange={e => setSelectedCoachId(e.target.value)}
                                            style={{ fontSize: '15px', width: '100%' }}
                                        >
                                            <option value="">-- Chọn HLV --</option>
                                            {coaches
                                                .filter(c => !c.specialty || (selectedAdvancedType.sport_type === 'SWIMMING' ? c.specialty === 'Bơi lội' : selectedAdvancedType.sport_type === 'BASKETBALL' ? c.specialty === 'Bóng rổ' : true))
                                                .map(c => (
                                                    <option key={c.id} value={c.id}>{c.full_name}{c.specialty ? ` - ${c.specialty}` : ''}</option>
                                                ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {isPrivateLesson(selectedAdvancedType) && (() => {
                                const sc = getStudentCount(selectedAdvancedType);
                                return (
                                    <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bbf7d0' }}>
                                        <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: '#166534' }}>
                                            🧑‍🏫 Thông tin đăng ký lớp 1:{sc}
                                        </div>

                                        {/* Chọn Huấn Luyện Viên */}
                                        <div className="form-group" style={{ marginBottom: '12px' }}>
                                            <label>🏊 Huấn luyện viên (HLV) <span style={{ color: 'red' }}>*</span></label>
                                            <select
                                                required
                                                value={selectedCoachId}
                                                onChange={e => setSelectedCoachId(e.target.value)}
                                                style={{ fontSize: '15px', width: '100%' }}
                                            >
                                                <option value="">-- Chọn HLV --</option>
                                                {coaches
                                                    .filter(c => !c.specialty || (selectedAdvancedType.sport_type === 'SWIMMING' ? c.specialty === 'Bơi lội' : selectedAdvancedType.sport_type === 'BASKETBALL' ? c.specialty === 'Bóng rổ' : true))
                                                    .map(c => (
                                                        <option key={c.id} value={c.id}>{c.full_name}{c.specialty ? ` - ${c.specialty}` : ''}</option>
                                                    ))}
                                            </select>
                                        </div>

                                        {/* Học viên 1 (chính) */}
                                        <div className="form-group" style={{ marginBottom: '12px' }}>
                                            <label>Năm sinh học viên{sc > 1 ? ' 1' : ''} <span style={{ color: 'red' }}>*</span></label>
                                            <input type="number" min="1900" max={new Date().getFullYear()} required
                                                value={privateBirthYear}
                                                onChange={e => setPrivateBirthYear(e.target.value ? Number(e.target.value) : '')}
                                                placeholder="Nhập năm sinh (VD: 2010)"
                                                style={{ fontSize: '15px' }}
                                            />
                                            {privateBirthYear && (
                                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                    Độ tuổi: <strong>{new Date().getFullYear() - Number(privateBirthYear)} tuổi</strong>
                                                </div>
                                            )}
                                        </div>

                                        {/* Học viên bổ sung (HV2, HV3, ... HV-N) */}
                                        {extraStudents.map((student, idx) => (
                                            <div key={idx} style={{ background: '#ecfdf5', padding: '12px', borderRadius: '8px', marginBottom: '12px', border: '1px dashed #86efac' }}>
                                                <div style={{ fontSize: '12px', fontWeight: 600, color: '#166534', marginBottom: '8px' }}>
                                                    Học viên {idx + 2}
                                                </div>
                                                <div className="form-group" style={{ marginBottom: '8px' }}>
                                                    <label>Họ và Tên <span style={{ color: 'red' }}>*</span></label>
                                                    <input type="text" required
                                                        value={student.name}
                                                        onChange={e => {
                                                            const updated = [...extraStudents];
                                                            updated[idx] = { ...updated[idx], name: e.target.value };
                                                            setExtraStudents(updated);
                                                        }}
                                                        placeholder={`Nhập tên học viên ${idx + 2}`}
                                                        style={{ fontSize: '15px' }}
                                                    />
                                                </div>
                                                <div className="form-group">
                                                    <label>Năm sinh <span style={{ color: 'red' }}>*</span></label>
                                                    <input type="number" min="1900" max={new Date().getFullYear()} required
                                                        value={student.birthYear}
                                                        onChange={e => {
                                                            const updated = [...extraStudents];
                                                            updated[idx] = { ...updated[idx], birthYear: e.target.value ? Number(e.target.value) : '' };
                                                            setExtraStudents(updated);
                                                        }}
                                                        placeholder="Nhập năm sinh (VD: 2010)"
                                                        style={{ fontSize: '15px' }}
                                                    />
                                                    {student.birthYear && (
                                                        <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                            Độ tuổi: <strong>{new Date().getFullYear() - Number(student.birthYear)} tuổi</strong>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}

                                        {/* Thông tin người giám hộ — bắt buộc nếu học viên dưới 18 */}
                                        {(() => {
                                            const curYear = new Date().getFullYear();
                                            const a1 = privateBirthYear ? curYear - Number(privateBirthYear) : null;
                                            let needsG = a1 !== null && a1 < 18;
                                            for (const s of extraStudents) {
                                                if (s.birthYear && (curYear - Number(s.birthYear)) < 18) needsG = true;
                                            }
                                            const s1Adult = a1 !== null && a1 >= 18;
                                            if (!needsG) return null;
                                            return (
                                                <div style={{ background: '#fef3c7', padding: '16px', borderRadius: '8px', marginTop: '12px', marginBottom: '12px', border: '1px solid #fcd34d' }}>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '10px', color: '#92400e', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '6px' }}>
                                                        <span>👨‍👩‍👧 Thông tin người giám hộ <span style={{ color: 'red' }}>*</span></span>
                                                        {sc > 1 && s1Adult && (
                                                            <button type="button" onClick={() => { setGuardianName(customerName); setGuardianPhone(customerPhone); }}
                                                                style={{ fontSize: '11px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #3b82f6', background: '#eff6ff', color: '#1d4ed8', cursor: 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                                📋 Người giám hộ là học viên 1
                                                            </button>
                                                        )}
                                                    </div>
                                                    <div style={{ fontSize: '11px', color: '#b45309', marginBottom: '10px' }}>
                                                        ⚠️ Học viên dưới 18 tuổi bắt buộc phải có thông tin người giám hộ
                                                    </div>
                                                    <div className="form-group" style={{ marginBottom: '10px' }}>
                                                        <label>Họ tên giám hộ <span style={{ color: 'red' }}>*</span></label>
                                                        <input type="text" value={guardianName}
                                                            onChange={e => setGuardianName(e.target.value)}
                                                            placeholder="Nhập họ tên người giám hộ"
                                                            style={{ fontSize: '15px' }}
                                                        />
                                                    </div>
                                                    <div className="form-group">
                                                        <label>SĐT giám hộ <span style={{ color: 'red' }}>*</span></label>
                                                        <input type="tel" value={guardianPhone}
                                                            onChange={e => setGuardianPhone(e.target.value)}
                                                            placeholder="Nhập số điện thoại giám hộ"
                                                            style={{ fontSize: '15px' }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        <div className="form-group" style={{ marginBottom: '12px' }}>
                                            <label>Số buổi học <span style={{ color: 'red' }}>*</span></label>
                                            <input type="number" min="1" required
                                                value={privateSessions}
                                                onChange={e => setPrivateSessions(e.target.value ? Number(e.target.value) : '')}
                                                style={{ fontSize: '16px', fontWeight: 'bold' }}
                                            />
                                            {(() => {
                                                const currentYear = new Date().getFullYear();
                                                const allBirthYears = [Number(privateBirthYear), ...extraStudents.map(s => Number(s.birthYear || 0))].filter(y => y > 0);
                                                let totalUnitPrice = 0;

                                                for (const by of allBirthYears) {
                                                    let unitP = selectedAdvancedType.price;
                                                    if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                                                        const age = currentYear - by;
                                                        const tier = selectedAdvancedType.age_price_tiers.find(t => age >= t.minAge && age <= t.maxAge);
                                                        if (tier) unitP = tier.price;
                                                    }
                                                    totalUnitPrice += unitP;
                                                }

                                                if (allBirthYears.length === 0) {
                                                    totalUnitPrice = selectedAdvancedType.price * sc;
                                                }

                                                const totalPrice = Math.round(Number(privateSessions || 0) * totalUnitPrice);

                                                return (
                                                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                        Tổng tiền: <strong style={{ color: 'var(--accent-green)' }}>{totalPrice.toLocaleString('vi-VN')}đ</strong> ({privateSessions || 0} buổi × {Math.round(totalUnitPrice).toLocaleString('vi-VN')}đ/buổi{sc > 1 ? ` × ${allBirthYears.length || sc} HV` : ''})
                                                        {selectedAdvancedType.age_price_tiers?.length ? ' (Giá theo độ tuổi)' : ''}
                                                    </div>
                                                );
                                            })()}
                                        </div>
                                        <div className="form-group">
                                            <label>Thời hạn học</label>
                                            <div style={{ display: 'flex', gap: '12px', marginBottom: '8px' }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'normal', margin: 0, fontSize: '13px' }}>
                                                    <input type="radio" checked={privateUnlimited} onChange={() => setPrivateUnlimited(true)} />
                                                    Không thời hạn
                                                </label>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontWeight: 'normal', margin: 0, fontSize: '13px' }}>
                                                    <input type="radio" checked={!privateUnlimited} onChange={() => setPrivateUnlimited(false)} />
                                                    Có thời hạn
                                                </label>
                                            </div>
                                            {!privateUnlimited && (
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <input type="number" min="1" step="1"
                                                        value={privateDurationVal}
                                                        onChange={e => setPrivateDurationVal(e.target.value ? Number(e.target.value) : '')}
                                                        placeholder="Nhập số..."
                                                        style={{ flex: 1 }}
                                                    />
                                                    <select value={privateDurationUnit} onChange={e => setPrivateDurationUnit(e.target.value as any)} style={{ width: '100px' }}>
                                                        <option value="months">Tháng</option>
                                                        <option value="days">Ngày</option>
                                                    </select>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}


                            <div className="form-group">
                                <label>🎟️ Mã Voucher Khuyến mãi (Tùy chọn)</label>
                                {validatedVoucher ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '10px 12px' }}>
                                        <span style={{ color: '#16a34a', fontWeight: 600, flex: 1, fontSize: '14px' }}>
                                            ✅ {validatedVoucher.promo_name}
                                            {validatedVoucher.promo_type === 'AMOUNT' && ` (−${validatedVoucher.promo_value.toLocaleString('vi-VN')}đ)`}
                                            {validatedVoucher.promo_type === 'PERCENT' && ` (−${validatedVoucher.promo_value}%)`}
                                            {validatedVoucher.promo_type === 'BONUS_SESSION' && ` (+${validatedVoucher.promo_value} buổi)`}
                                        </span>
                                        <button type="button" onClick={clearVoucher} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '16px', padding: '0 4px' }}>&times;</button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <input
                                            type="text"
                                            value={voucherCode}
                                            onChange={e => { setVoucherCode(e.target.value.toUpperCase()); setVoucherError(''); }}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleApplyVoucher(); } }}
                                            placeholder="Nhập mã Voucher..."
                                            style={{ flex: 1, textTransform: 'uppercase', fontWeight: 600, borderColor: voucherError ? '#ef4444' : '' }}
                                        />
                                        <button type="button" className="btn btn-primary btn-sm" onClick={handleApplyVoucher} disabled={validatingVoucher || !voucherCode.trim()} style={{ whiteSpace: 'nowrap' }}>
                                            {validatingVoucher ? '...' : 'Áp dụng'}
                                        </button>
                                    </div>
                                )}
                                {voucherError && <div style={{ color: '#ef4444', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>❌ {voucherError}</div>}
                            </div>

                            {(() => {
                                const { baseSubtotal, finalSubtotal } = computeAdvancedFinalPrice(selectedAdvancedType);
                                const hasDiscount = finalSubtotal < baseSubtotal;
                                return (
                                    <div style={{ background: '#f8fafc', border: '1px solid var(--border-color)', borderRadius: '10px', padding: '12px 14px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--text-secondary)' }}>Thành tiền tạm tính:</span>
                                        <div style={{ textAlign: 'right' }}>
                                            {hasDiscount && (
                                                <span style={{ textDecoration: 'line-through', color: '#94a3b8', fontSize: '12.5px', marginRight: '8px' }}>
                                                    {baseSubtotal.toLocaleString('vi-VN')}đ
                                                </span>
                                            )}
                                            <strong style={{ fontSize: '17px', color: 'var(--accent-green)' }} className="tabular-nums">
                                                {finalSubtotal.toLocaleString('vi-VN')}đ
                                            </strong>
                                        </div>
                                    </div>
                                );
                            })()}

                            <div className="modal-actions">
                                <button type="button" className="btn btn-ghost" disabled={selling} onClick={() => setSelectedAdvancedType(null)}>
                                    Hủy bỏ
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={selling}>
                                    {selling ? 'Đang xử lý...' : (selectedAdvancedType.category === 'DAILY' ? 'Thêm vào bill & In vé' : 'Thêm vào bill')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* MODAL THANH TOÁN (Giỏ Hàng) */}
            {showPaymentModal && cart.length > 0 && (
                <div className="modal-overlay" onClick={() => setShowPaymentModal(false)}>
                    <div className="modal-card" style={{ maxWidth: '420px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>💳 Thanh toán Đơn hàng</h2>
                            <button type="button" onClick={() => setShowPaymentModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>

                        {(() => {
                            const hasAdvanced = cart.some(c => c.type === 'TICKET' && c.item.category !== 'DAILY');
                            const actualPrice = cart.reduce((s, c) => s + c.subtotal, 0);
                            const isFreeTicket = actualPrice === 0;

                            return (
                                <form onSubmit={(e) => { e.preventDefault(); doCheckoutOrder(); }}>
                                    {hasAdvanced && (
                                        <div style={{ background: 'var(--accent-green-soft)', padding: '12px 14px', borderRadius: '10px', marginBottom: '16px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                            <div style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--accent-green)', marginBottom: '4px' }}>👤 Thông tin cấp thẻ</div>
                                            <div style={{ fontSize: '14px', fontWeight: 600 }}>{customerName || 'Chưa có tên'}</div>
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }}>
                                                {cardCode && <span>🏷️ {maskCardCode(cardCode)}</span>}
                                                {customerPhone && <span style={{ marginLeft: '8px' }}>📞 {customerPhone}</span>}
                                            </div>
                                        </div>
                                    )}

                                    {!isFreeTicket ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
                                            <div style={{ marginBottom: '6px', fontWeight: 700, fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Tổng tiền:</span>
                                                <span className="tabular-nums" style={{ color: 'var(--accent-green)' }}>{actualPrice.toLocaleString('vi-VN')}đ</span>
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 12px', border: `1px solid ${selectedPaymentMethod === 'CASH' ? 'var(--accent-blue)' : 'var(--border-color)'}`, borderRadius: '10px', cursor: 'pointer', background: selectedPaymentMethod === 'CASH' ? 'var(--accent-blue-soft)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="CASH" checked={selectedPaymentMethod === 'CASH'} onChange={() => setSelectedPaymentMethod('CASH')} />
                                                <span style={{ fontSize: '15px', fontWeight: 600 }}>💵 Tiền mặt</span>
                                            </label>

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 12px', border: `1px solid ${selectedPaymentMethod === 'TRANSFER' ? 'var(--accent-blue)' : 'var(--border-color)'}`, borderRadius: '10px', cursor: 'pointer', background: selectedPaymentMethod === 'TRANSFER' ? 'var(--accent-blue-soft)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="TRANSFER" checked={selectedPaymentMethod === 'TRANSFER'} onChange={() => setSelectedPaymentMethod('TRANSFER')} />
                                                <span style={{ fontSize: '15px', fontWeight: 600 }}>🏦 Chuyển khoản</span>
                                            </label>

                                            {selectedPaymentMethod === 'TRANSFER' && bizInfo.bank_account_number && (
                                                <div style={{ padding: '12px', background: 'var(--bg-subtle)', borderRadius: '10px', fontSize: '13px', marginLeft: '20px', border: '1px dashed var(--border-color)' }}>
                                                    <div>Ngân hàng: <strong>{bizInfo.bank_name}</strong></div>
                                                    <div>Số tài khoản: <strong style={{ color: 'var(--text-primary)', fontSize: '15px' }}>{bizInfo.bank_account_number}</strong></div>
                                                    <div>Chủ TK: <strong>{bizInfo.bank_account_name}</strong></div>
                                                </div>
                                            )}

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 12px', border: `1px solid ${selectedPaymentMethod === 'CARD' ? 'var(--accent-blue)' : 'var(--border-color)'}`, borderRadius: '10px', cursor: 'pointer', background: selectedPaymentMethod === 'CARD' ? 'var(--accent-blue-soft)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="CARD" checked={selectedPaymentMethod === 'CARD'} onChange={() => setSelectedPaymentMethod('CARD')} />
                                                <span style={{ fontSize: '15px', fontWeight: 600 }}>💳 Quẹt thẻ (POS)</span>
                                            </label>

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '11px 12px', border: `1px solid ${selectedPaymentMethod === 'TRANSFER_COMPANY' ? 'var(--accent-blue)' : 'var(--border-color)'}`, borderRadius: '10px', cursor: 'pointer', background: selectedPaymentMethod === 'TRANSFER_COMPANY' ? 'var(--accent-blue-soft)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="TRANSFER_COMPANY" checked={selectedPaymentMethod === 'TRANSFER_COMPANY'} onChange={() => setSelectedPaymentMethod('TRANSFER_COMPANY')} />
                                                <span style={{ fontSize: '15px', fontWeight: 600 }}>🏢 Chuyển khoản công ty</span>
                                            </label>
                                        </div>
                                    ) : (
                                        <div style={{ marginBottom: '20px', textAlign: 'center', color: 'var(--accent-green)' }}>
                                            <p style={{ fontSize: '16px', fontWeight: 600 }}>Miễn phí (0đ)</p>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowPaymentModal(false)}>Hủy</button>
                                        <button type="submit" className="btn btn-primary" style={{ flex: 2 }} disabled={selling}>
                                            {selling ? 'Đang xử lý...' : (isFreeTicket ? 'PHÁT HÀNH' : 'XÁC NHẬN THANH TOÁN')}
                                        </button>
                                    </div>
                                </form>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* MODAL LỰA CHỌN GÓI VÉ CHECK-IN (Grouped by Service) */}
            {showPackageSelectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => setShowPackageSelectModal(false)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', maxWidth: '520px', width: '90%', boxShadow: 'var(--shadow-lg)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
                        onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>🗂️ Chọn dịch vụ sử dụng</h2>
                            <button onClick={() => setShowPackageSelectModal(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>

                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
                            Khách có nhiều loại dịch vụ. Vui lòng hỏi khách hôm nay sử dụng dịch vụ nào:
                        </p>

                        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {(() => {
                                // Group packages by service type
                                const groups: Record<string, { label: string; icon: string; color: string; bg: string; border: string; hoverBorder: string; packages: any[] }> = {};
                                
                                for (const pkg of availablePackages) {
                                    const sport = pkg.sport_type || 'SWIMMING';
                                    const cat = pkg.category || 'MULTI';
                                    
                                    let groupKey: string;
                                    let groupConfig: { label: string; icon: string; color: string; bg: string; border: string; hoverBorder: string };
                                    
                                    if (sport === 'BASKETBALL') {
                                        groupKey = 'BASKETBALL';
                                        groupConfig = { label: 'Bóng Rổ', icon: '🏀', color: '#c2410c', bg: '#fff7ed', border: '#fed7aa', hoverBorder: '#f97316' };
                                    } else if (cat === 'LESSON') {
                                        groupKey = 'SWIM_LESSON';
                                        groupConfig = { label: 'Học Bơi', icon: '📚', color: '#166534', bg: '#f0fdf4', border: '#bbf7d0', hoverBorder: '#22c55e' };
                                    } else {
                                        groupKey = 'SWIM_PASS';
                                        groupConfig = { label: 'Bơi Lội', icon: '🏊', color: '#1d4ed8', bg: '#eff6ff', border: '#bfdbfe', hoverBorder: '#3b82f6' };
                                    }
                                    
                                    if (!groups[groupKey]) {
                                        groups[groupKey] = { ...groupConfig, packages: [] };
                                    }
                                    groups[groupKey].packages.push(pkg);
                                }

                                const groupOrder = ['SWIM_PASS', 'SWIM_LESSON', 'BASKETBALL'];
                                const sortedGroups = groupOrder.filter(k => groups[k]).map(k => ({ key: k, ...groups[k] }));

                                return sortedGroups.map(group => (
                                    <div key={group.key}>
                                        {/* Group header */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                                            <span style={{ fontSize: '22px' }}>{group.icon}</span>
                                            <span style={{ fontWeight: 700, fontSize: '15px', color: group.color }}>{group.label}</span>
                                            <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: 500 }}>({group.packages.length} gói)</span>
                                        </div>

                                        {/* Packages in this group */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {group.packages.map((pkg: any, idx: number) => {
                                                const isActive = pkg.is_active;
                                                return (
                                                    <button
                                                        key={idx}
                                                        onClick={() => handleSelectPackage(pkg.id)}
                                                        style={{
                                                            display: 'flex', flexDirection: 'column', gap: '6px',
                                                            padding: '14px 16px', borderRadius: '12px',
                                                            background: group.bg,
                                                            border: `2px solid ${group.border}`,
                                                            cursor: 'pointer', textAlign: 'left',
                                                            transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
                                                        }}
                                                        onMouseEnter={e => { e.currentTarget.style.borderColor = group.hoverBorder; e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; }}
                                                        onMouseLeave={e => { e.currentTarget.style.borderColor = group.border; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                                                    >
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                                            <strong style={{ fontSize: '15px', color: '#1e293b' }}>{pkg.type_name}</strong>
                                                            {!isActive ? (
                                                                <span style={{ fontSize: '11px', background: '#fef08a', color: '#854d0e', padding: '3px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                                                    Chưa kích hoạt
                                                                </span>
                                                            ) : (
                                                                <span style={{ fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                                                    🟢 Đang dùng
                                                                </span>
                                                            )}
                                                        </div>

                                                        <div style={{ fontSize: '13px', color: '#475569', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                                            <span>👤 {pkg.customer_name || 'Khách'}</span>
                                                            <span>
                                                                🎟️ Còn <strong style={{ color: '#0f172a' }}>{pkg.remaining_sessions !== null ? `${pkg.remaining_sessions}` : '∞'}</strong>/{pkg.total_sessions !== null ? pkg.total_sessions : '∞'} buổi
                                                            </span>
                                                        </div>
                                                        {(pkg.valid_from || pkg.valid_until) && (
                                                            <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                                📅 {pkg.valid_from ? new Date(pkg.valid_from).toLocaleDateString('vi-VN') : '---'} → {pkg.valid_until ? new Date(pkg.valid_until).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                                                            </div>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>
                    </div>
                </div>
            )}
            {/* ========== NEW CUSTOMER MODAL POPUP ========== */}
            {showNewCustomerModal && (
                <div className="modal-overlay" style={{ zIndex: 9999 }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setShowNewCustomerModal(false);
                        if (e.key === 'F8') { e.preventDefault(); handleSaveNewCustomer(); }
                    }}>
                    <div className="modal-card" style={{ width: '480px', maxWidth: '95vw', padding: 0 }}>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--border-color)' }}>
                            <h2 style={{ margin: 0, fontSize: '17px', fontWeight: 700 }}>Tạo khách hàng mới</h2>
                            <button type="button" onClick={() => setShowNewCustomerModal(false)} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px' }}>&times;</button>
                        </div>
                        {/* Form */}
                        <div style={{ padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Mã thẻ <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                                <input type="text" value={newCustCardCode} onChange={e => setNewCustCardCode(e.target.value)} placeholder="Mã thẻ nhựa" autoFocus />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Họ và tên <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                                <input type="text" value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="Họ và tên" />
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>Số điện thoại <span style={{ color: 'var(--accent-red)' }}>*</span></label>
                                    <input type="tel" value={newCustPhone} onChange={e => handleNewCustPhoneChange(e.target.value)} placeholder="Số điện thoại"
                                        style={{ borderColor: duplicatePhoneCustomer ? 'var(--accent-orange)' : undefined }} />
                                    {duplicatePhoneCustomer && (
                                        <div style={{ marginTop: '6px', padding: '8px 10px', background: 'var(--accent-orange-soft)', border: '1px solid rgba(245, 158, 11, 0.35)', borderRadius: '8px', fontSize: '11.5px', color: 'var(--text-primary)' }}>
                                            ⚠️ SĐT đã đăng ký cho: <strong>{duplicatePhoneCustomer.full_name}</strong> ({duplicatePhoneCustomer.card_code}). Bấm <strong>Lưu</strong> để chọn KH này.
                                        </div>
                                    )}
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>Email</label>
                                    <input type="email" value={newCustEmail} onChange={e => setNewCustEmail(e.target.value)} placeholder="Email" />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>Ngày sinh</label>
                                    <input type="date" value={newCustBirthDate} onChange={e => setNewCustBirthDate(e.target.value)} />
                                </div>
                                <div className="form-group" style={{ marginBottom: 0 }}>
                                    <label>Giới tính</label>
                                    <select value={newCustGender} onChange={e => setNewCustGender(e.target.value)}>
                                        <option value="">Chọn giới tính</option>
                                        <option value="Nam">Nam</option>
                                        <option value="Nữ">Nữ</option>
                                        <option value="Khác">Khác</option>
                                    </select>
                                </div>
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Ghi chú</label>
                                <input type="text" value={newCustNote} onChange={e => setNewCustNote(e.target.value)} placeholder="Ghi chú" />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>Địa chỉ</label>
                                <input type="text" value={newCustAddress} onChange={e => setNewCustAddress(e.target.value)} placeholder="Địa chỉ" />
                            </div>
                            <div className="form-group" style={{ marginBottom: 0 }}>
                                <label>⌨ Phím tắt <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(không bắt buộc)</span></label>
                                <select value={newCustHotkey} onChange={e => setNewCustHotkey(e.target.value)}>
                                    <option value="">-- Không gán phím tắt --</option>
                                    {['F6', 'F7', 'F8', 'F9', 'F10'].filter(k => !hotkeyCustomers.some(c => c.hotkey === k)).map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>Gán phím tắt để nhấn nhanh điền thông tin KH khi bán hàng</div>
                            </div>
                        </div>
                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '14px 22px', borderTop: '1px solid var(--border-color)', background: 'var(--bg-subtle)' }}>
                            <button type="button" className="btn btn-outline" onClick={() => setShowNewCustomerModal(false)}>
                                Hủy <span style={{ fontSize: '10px', opacity: 0.75 }}>ESC</span>
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSaveNewCustomer} disabled={savingCustomer}>
                                {savingCustomer ? 'Đang lưu...' : 'Lưu'} <span style={{ fontSize: '10px', opacity: 0.85 }}>F8</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRODUCT VARIANT SELECTION MODAL */}
            {selectingVariantFor && (
                <div className="modal-overlay" style={{ zIndex: 1100 }} onClick={() => setSelectingVariantFor(null)}>
                    <div className="modal-card" style={{ maxWidth: '450px' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '17px', margin: 0 }}>Chọn phân loại: {selectingVariantFor.name}</h2>
                            <button type="button" onClick={() => setSelectingVariantFor(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                            {products.filter(v => v.parent_id === selectingVariantFor.id && v.is_active).map(variant => (
                                <button
                                    key={variant.id}
                                    type="button"
                                    className="pos-variant-btn"
                                    disabled={variant.stock_quantity <= 0}
                                    onClick={() => {
                                        handleProductSaleClick(variant);
                                        setSelectingVariantFor(null);
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '14.5px', color: 'var(--text-primary)', marginBottom: '3px' }}>
                                            {variant.sku || variant.name.replace(selectingVariantFor.name + ' — ', '')}
                                        </div>
                                        <div className="tabular-nums" style={{ fontSize: '12.5px', color: 'var(--text-secondary)' }}>
                                            {variant.price.toLocaleString('vi-VN')}đ / {variant.unit}
                                        </div>
                                    </div>
                                    <Badge variant={variant.stock_quantity > 0 ? 'green' : 'red'}>
                                        {variant.stock_quantity > 0 ? `Còn ${variant.stock_quantity}` : 'Hết hàng'}
                                    </Badge>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            <ToastProvider />
        </div>
    );
}
