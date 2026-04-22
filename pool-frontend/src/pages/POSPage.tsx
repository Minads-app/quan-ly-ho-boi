/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars, react-hooks/immutability, react-hooks/exhaustive-deps, prefer-const */
import { useEffect, useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { normalizeScannerInput } from '../utils/scannerUtils';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { TicketType, Ticket, RetailProduct, Customer } from '../types';

export interface CartItem {
    cart_id: string;
    type: 'TICKET' | 'PRODUCT';
    item: any;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    promoId?: string;
    privateSessions?: number;
    privateBirthYear?: number;
    privateBirthYear2?: number;
    customerName2?: string;
    privateDurationVal?: number;
    privateDurationUnit?: 'months' | 'days';
    privateUnlimited?: boolean;
    customerName?: string;
    customerPhone?: string;
    cardCode?: string;
    guardianName?: string;
    guardianPhone?: string;
}

interface SoldTicket extends Ticket {
    type_name: string;
    pool_close_time: string;
    remaining_sessions?: number | null;
    customer_phone: string | null;
    sold_by: string | null;
    payment_method: 'CASH' | 'TRANSFER' | 'CARD';
    pass_category?: string | null;
    pass_remaining_sessions?: number | null;
}

interface Promotion {
    id: string;
    name: string;
    type: 'AMOUNT' | 'PERCENT' | 'BONUS_SESSION';
    value: number;
    valid_from: string | null;
    valid_until: string | null;
    is_active: boolean;
    applicable_ticket_types: string[] | null;
    applicable_lesson_types: string[] | null;
}

interface BusinessInfo {
    business_name?: string;
    business_address?: string;
    business_phone?: string;
    business_logo?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_name?: string;
    print_format?: 'K80' | 'A5';
    pool_close_time?: string;
}

export default function POSPage() {
    // Helper: Mask card code for non-admins
    function maskCardCode(code: string | null): string | null {
        if (!code) return null;
        if (profile?.role === 'ADMIN') return code;
        if (code.length <= 6) return '***';
        // Show first 5 and last 4, middle masked
        return `${code.substring(0, 5)}***${code.substring(code.length - 4)}`;
    }

    const { profile } = useAuth();
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
    const [loading, setLoading] = useState(true);
    const [selling, setSelling] = useState(false);
    const [soldTickets, setSoldTickets] = useState<SoldTicket[]>([]); // Array of sold tickets
    const [pendingTickets, setPendingTickets] = useState<any[]>([]); // Tickets to be shown after the invoice
    const [checkoutReceipt, setCheckoutReceipt] = useState<any | null>(null);

    // Cart & Products state
    const [cart, setCart] = useState<CartItem[]>([]);
    const [products, setProducts] = useState<RetailProduct[]>([]);

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

    // Promotions
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [selectedPromoId, setSelectedPromoId] = useState<string>('');
    const printRef = useRef<HTMLDivElement>(null);

    // Business Info & Payment Options
    const [bizInfo, setBizInfo] = useState<BusinessInfo>({});
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CARD'>('CASH');

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
                }
            }
        }
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [hotkeyCustomers, showNewCustomerModal, selectedAdvancedType, showPaymentModal, showPackageSelectModal]);

    useEffect(() => {
        fetchTicketTypes();
        fetchPromotions();
        fetchProducts();
        fetchBusinessInfo();
        fetchHotkeyCustomers();

        async function fetchProducts() {
            const { data } = await supabase.from('products').select('*').eq('is_active', true).order('name');
            if (data) {
                setProducts(data);
            }
        }

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
                    business_name: info.business_name || 'Hệ Thống Vé Bơi',
                    business_address: info.business_address || '',
                    business_phone: info.business_phone || '',
                    business_logo: info.business_logo || '',
                    bank_name: info.bank_name || '',
                    bank_account_number: info.bank_account_number || '',
                    bank_account_name: info.bank_account_name || '',
                    print_format: info.print_format || 'K80'
                });
            }
        }
    }, []);

    async function fetchTicketTypes() {
        const { data } = await supabase
            .from('ticket_types')
            .select('*')
            .eq('is_active', true)
            .order('category')
            .order('name');

        if (data) {
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
        // Fetch only active promos that are valid right now
        const now = new Date().toISOString();
        const { data } = await supabase
            .from('promotions')
            .select('*')
            .eq('is_active', true)
            .or(`valid_from.is.null,valid_from.lte.${now}`)
            .or(`valid_until.is.null,valid_until.gte.${now}`);

        if (data) setPromotions(data);
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
    }

    // --- Save new customer to customers table ---
    async function handleSaveNewCustomer() {
        if (!newCustCardCode.trim() || !newCustName.trim() || !newCustPhone.trim()) {
            alert('Vui lòng nhập đầy đủ: Mã thẻ, Họ tên, Số điện thoại!');
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
                const confirmCreate = window.confirm(`Mã thẻ "${inputCardCode}" không có trong ngân hàng thẻ. Bạn có muốn tự động tạo và gán cho khách không?`);
                if (!confirmCreate) {
                    setSavingCustomer(false);
                    return;
                }
                shouldInsertCard = true;
            } else {
                alert('Mã thẻ không hợp lệ hoặc chưa được khởi tạo trong kho thẻ. Vui lòng liên hệ Admin.');
                setSavingCustomer(false);
                return;
            }
        } else {
            if (cardRes.status !== 'UNUSED') {
                if (profile?.role === 'ADMIN') {
                    const confirmUse = window.confirm(`Mã thẻ "${inputCardCode}" đã được sử dụng hoặc bị hủy (Trạng thái: ${cardRes.status}). Bạn có chắc chắn muốn ép dùng mã này không?`);
                    if (!confirmUse) {
                        setSavingCustomer(false);
                        return;
                    }
                    shouldUpdateCardId = cardRes.id;
                } else {
                    alert(`Mã thẻ này đã được sử dụng hoặc hỏng (Trạng thái: ${cardRes.status}). Vui lòng lấy thẻ khác.`);
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
                alert('Mã thẻ "' + inputCardCode + '" đã tồn tại trong danh sách khách hàng!');
            } else {
                alert('Lỗi lưu khách hàng: ' + error.message);
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
                alert(`Sản phẩm "${item.name}" chỉ còn ${item.stock_quantity} trong kho!`);
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
                cart_id: Date.now() + Math.random().toString(),
                type, item, quantity, unitPrice: item.price, subtotal: item.price * quantity
            }];
        });
    }

    async function doCheckoutOrder() {
        if (cart.length === 0) return;
        setSelling(true);

        const p_items = cart.map(c => {
            if (c.type === 'PRODUCT') {
                return { type: 'PRODUCT', id: c.item.id, quantity: c.quantity, unit_price: c.unitPrice, subtotal: c.subtotal };
            }

            let validFrom = null;
            let validUntil = null;
            let customDurationMonths = null;
            let customValidityDays = null;

            if (c.item.category === 'DAILY') {
                if (c.item.validity_days) {
                    const today = new Date();
                    const tzOffset = today.getTimezoneOffset() * 60000;
                    const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, -1);
                    validFrom = localISOTime.split('T')[0];
                    const expDate = new Date(today);
                    const daysToAdd = c.item.validity_days > 0 ? c.item.validity_days - 1 : 0;
                    expDate.setDate(today.getDate() + daysToAdd);
                    const localISOExp = (new Date(expDate.getTime() - tzOffset)).toISOString().slice(0, -1);
                    validUntil = localISOExp.split('T')[0];
                }
            } else {
                if (!c.privateUnlimited && c.privateDurationVal) {
                    if (c.privateDurationUnit === 'months') {
                        customDurationMonths = Number(c.privateDurationVal);
                    } else {
                        customValidityDays = Number(c.privateDurationVal);
                    }
                }
            }

            let finalPrice = c.unitPrice;
            let finalSessions = c.item.session_count || null;
            if (c.privateSessions) finalSessions = c.privateSessions;

            if (c.promoId) {
                const promo = promotions.find(p => p.id === c.promoId);
                if (promo) {
                    if (promo.type === 'AMOUNT') {
                        finalPrice = Math.max(0, finalPrice - promo.value);
                    } else if (promo.type === 'PERCENT') {
                        finalPrice = Math.round(finalPrice * (1 - promo.value / 100));
                    } else if (promo.type === 'BONUS_SESSION' && finalSessions !== null) {
                        finalSessions += promo.value;
                    }
                }
            }

            return {
                type: 'TICKET', id: c.item.id, quantity: c.quantity, unit_price: c.quantity > 1 ? c.unitPrice : finalPrice, subtotal: c.subtotal,
                ticket_metadata: {
                    customer_name: c.customerName || customerName || null,
                    customer_phone: c.customerPhone || customerPhone || null,
                    valid_from: validFrom,
                    valid_until: validUntil,
                    remaining_sessions: finalSessions,
                    total_sessions: finalSessions,
                    promotion_id: c.promoId || null,
                    card_code: c.cardCode || cardCode || null,
                    customer_birth_year: c.privateBirthYear || null,
                    customer_name_2: c.customerName2 || null,
                    customer_birth_year_2: c.privateBirthYear2 || null,
                    custom_duration_months: customDurationMonths,
                    custom_validity_days: customValidityDays,
                    guardian_name: c.guardianName || null,
                    guardian_phone: c.guardianPhone || null
                }
            };
        });

        const total_amount_raw = p_items.reduce((sum, item) => sum + item.subtotal, 0);

        const { data, error } = await supabase.rpc('create_checkout_order', {
            p_total_amount: total_amount_raw,
            p_payment_method: selectedPaymentMethod,
            p_customer_name: customerName || null,
            p_customer_phone: customerPhone || null,
            p_note: '',
            p_user_id: profile?.id,
            p_items: p_items
        });

        if (error || !data?.success) {
            alert('Lỗi bán hàng: ' + (error?.message || data?.error));
            setSelling(false);
            return;
        }

        // Build receipt object before clearing cart
        const receipt = {
            order_id: data.order_id,
            items: cart.map(c => {
                const promo = c.promoId ? promotions.find(p => p.id === c.promoId) : null;
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
                    setPendingTickets(mapped as any); // Store single QR tickets
                }

                // ALWAYS generate Master Receipt
                setCheckoutReceipt(receipt);
            }
        } else {
            // Only retail products sold
            setCheckoutReceipt(receipt);
        }

        setSelling(false);
        setCart([]);
        setCustomerName('');
        setCustomerPhone('');
        setCardCode('');
        setSelectedCustomerBirthDate(null);
        setSelectedPaymentMethod('CASH');
        setShowPaymentModal(false);
    }

    function handleAdvancedSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedAdvancedType) return;

        // Validation for private lessons
        const isPriv = isPrivateLesson(selectedAdvancedType);
        const sc = getStudentCount(selectedAdvancedType);

        if (isPriv) {
            if (!privateBirthYear) {
                alert(`Vui lòng nhập năm sinh học viên${sc > 1 ? ' 1' : ''}!`);
                return;
            }

            // Validate extra students (HV2, HV3, ...)
            for (let i = 0; i < extraStudents.length; i++) {
                if (!extraStudents[i].name.trim()) {
                    alert(`Vui lòng nhập tên học viên ${i + 2}!`);
                    return;
                }
                if (!extraStudents[i].birthYear) {
                    alert(`Vui lòng nhập năm sinh học viên ${i + 2}!`);
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
                    alert('Học viên dưới 18 tuổi bắt buộc phải có thông tin người giám hộ (Họ tên, SĐT)!');
                    return;
                }
            }

            if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                const currentYear = new Date().getFullYear();
                // Validate HV1
                const age1 = currentYear - Number(privateBirthYear);
                const isAge1Valid = selectedAdvancedType.age_price_tiers.some(tier => age1 >= tier.minAge && (tier.maxAge === null ? true : age1 <= tier.maxAge));
                if (!isAge1Valid) {
                    alert('Độ tuổi học viên 1 không phù hợp với khóa học này.');
                    return;
                }
                // Validate extra students
                for (let i = 0; i < extraStudents.length; i++) {
                    if (extraStudents[i].birthYear) {
                        const ageX = currentYear - Number(extraStudents[i].birthYear);
                        const isAgeXValid = selectedAdvancedType.age_price_tiers.some(tier => ageX >= tier.minAge && (tier.maxAge === null ? true : ageX <= tier.maxAge));
                        if (!isAgeXValid) {
                            alert(`Độ tuổi học viên ${i + 2} không phù hợp với khóa học này.`);
                            return;
                        }
                    }
                }
            }
        } else if (selectedAdvancedType.category === 'LESSON' && (selectedAdvancedType as any).lesson_class_type === 'GROUP') {
            if (!customerName || !customerName.trim()) {
                alert('Vui lòng tìm và chọn khách hàng (hoặc nhập tên) trước khi mua Gói Bơi Nhóm!');
                return;
            }
        }

        const calculateAdvancedPrice = () => {
            let subtotal = selectedAdvancedType.price;
            if (isPriv && privateSessions) {
                const currentYear = new Date().getFullYear();
                // Tính giá từng học viên
                const allBirthYears = [Number(privateBirthYear), ...extraStudents.map(s => Number(s.birthYear || 0))].filter(y => y > 0);
                let totalUnitPrice = 0;

                for (const by of allBirthYears) {
                    let unitP = selectedAdvancedType.price;
                    if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                        const age = currentYear - by;
                        const tier = selectedAdvancedType.age_price_tiers.find(t => age >= t.minAge && (t.maxAge === null ? true : age <= t.maxAge));
                        if (tier) unitP = Math.round(tier.price);
                    }
                    totalUnitPrice += unitP;
                }

                // Nếu chỉ có 1 HV mà không có age_tiers, dùng giá mặc định
                if (allBirthYears.length === 0) {
                    totalUnitPrice = selectedAdvancedType.price * sc;
                }

                subtotal = Math.round(totalUnitPrice * Number(privateSessions));
            }
            return subtotal;
        };

        const privateSessionsVal = Number(privateSessions) || undefined;

        // ADD TO CART 
        setCart(prev => [...prev, {
            cart_id: crypto.randomUUID(),
            type: 'TICKET',
            item: selectedAdvancedType,
            quantity: 1, // advanced ticket always qty=1
            unitPrice: calculateAdvancedPrice(),
            subtotal: calculateAdvancedPrice(),
            promoId: selectedPromoId || undefined,
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
            guardianPhone: guardianPhone.trim() || undefined
        } as any]);

        setSelectedAdvancedType(null);
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
            alert('Không thể khởi tạo trình in bộ nhớ tạm.');
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
        const payload: any = {
            p_pass_id: passId,
            p_staff_id: profile?.id,
            p_confirm_new_package: confirmNewPackage,
            p_selected_ticket_id: selectedTicketId || null // Must send null to match 4-argument RPC signature
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

            // Dùng message từ backend để hiển thị đúng ngữ cảnh
            const headerMsg = data.message || 'Xác nhận kích hoạt gói';


            const confirmed = window.confirm(
                `📋 ${headerMsg}\n\n` +
                `Thông tin gói: \n` +
                `• Khách: ${info.customer_name || 'N/A'}\n` +
                `• Loại: ${catLabel} — ${info.type_name}\n` +
                `• Số buổi: ${info.total_sessions || info.remaining_sessions || 'Không giới hạn'}\n\n` +
                `Bấm OK để KÍCH HOẠT và trừ 1 buổi.\n` +
                `Bấm Hủy để KHÔNG kích hoạt.`
            );

            if (confirmed) {
                // Gọi lại với confirm = true, truyền selected_ticket_id nếu có
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
        const remainLabel = passCategory === 'LESSON' ? 'buổi học' : 'buổi bơi';
        const newPkgNote = data.is_new_package ? '\n🆕 Đã kích hoạt GÓI MỚI!' : '';
        alert(`✅ ${data.message}\n` + (data.pass_status.remaining_sessions !== null ? `Còn lại: ${data.pass_status.remaining_sessions} ${remainLabel}.` : 'Không giới hạn lượt.') + newPkgNote);


        // Cập nhật giao diện in vé con
        let newTix = [];
        if (data.new_tickets && Array.isArray(data.new_tickets)) {
            newTix = data.new_tickets;
        } else if (data.new_ticket) {
            newTix = [data.new_ticket];
        }

        setSoldTickets(newTix.map((t: any) => ({
            id: t.id,
            ticket_type_id: '',
            status: 'UNUSED',
            customer_birth_year: null,
            price_paid: t.price_paid,
            sold_at: t.sold_at,
            valid_from: new Date().toISOString().split('T')[0],
            valid_until: new Date().toISOString().split('T')[0],
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
        setCheckinCode('');
    }

    async function handleCheckinSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCheckinError('');
        if (!checkinCode.trim()) return;

        setCheckingIn(true);
        const code = checkinCode.trim().toUpperCase();

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
                ticket_types!inner (name, category, session_count)
            `)
            .or(orFilter)
            .neq('status', 'CANCELLED')
            .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
            .order('sold_at', { ascending: false });

        if (error || !tickets || tickets.length === 0) {
            // alert(`[Gỡ lỗi] Không tìm thấy vé hợp lệ để hiển thị Popup.\nCode quét: ${code}\nLý do: ${error?.message || 'tickets.length = 0'}\nSẽ gọi trực tiếp check-in cũ!`);
            // Không tìm thấy hoặc thẻ ngày, gọi doCheckin để backend hiển thị lỗi chuẩn
            await doCheckin(code);
            setCheckingIn(false);
            return;
        }

        // Lọc thẻ chưa hết hạn nếu backend xử lý sau, ta vẫn nên hiển thị cái gần nhất
        const validTickets = tickets.filter(t => t.status !== 'EXPIRED');

        if (validTickets.length === 0) {
            // alert(`[Gỡ lỗi] Vé bị từ chối chuyển sang Popup vì trạng thái vé đang là: ${tickets[0]?.status}\nSẽ gọi trực tiếp check-in cũ!`);
            // Để backend báo lỗi hết hạn
            await doCheckin(code);
            setCheckingIn(false);
            return;
        }

        // Hiển thị popup preview với thông tin gói gần nhất
        setPreviewTicket(validTickets[0]);
        setCheckingIn(false);
    }

    async function handleSelectPackage(ticketId: string) {
        setShowPackageSelectModal(false);
        setCheckingIn(true);
        await doCheckin(pendingCheckinCode.trim().toUpperCase(), false, ticketId);
        setCheckingIn(false);
    }

    // Auto focus scanner if tab changes to CHECKIN
    useEffect(() => {
        if (activeTab === 'CHECKIN' && scannerInputRef.current) {
            scannerInputRef.current.focus();
        }
    }, [activeTab]);

    const dailyTypes = ticketTypes.filter(t => t.category === 'DAILY');
    const advancedTypes = ticketTypes.filter(t => t.category === 'MONTHLY' || t.category === 'MULTI');
    const lessonTypes = ticketTypes.filter(t => t.category === 'LESSON');

    if (loading) return <div className="page-loading">Đang tải...</div>;

    // --- Compact tile renderers ---
    const tileStyle = (borderColor: string, disabled?: boolean): React.CSSProperties => ({
        background: '#fff', border: '1px solid #f1f5f9', borderRadius: '12px', padding: '14px',
        cursor: disabled ? 'not-allowed' : 'pointer', textAlign: 'left' as const, overflow: 'hidden',
        boxShadow: '0 1px 4px rgba(0,0,0,0.04)', transition: 'all 0.15s ease',
        borderTop: `3px solid ${borderColor}`, opacity: disabled ? 0.55 : 1,
        display: 'flex', flexDirection: 'column' as const, gap: '6px', minHeight: '120px',
    });

    const renderTile = (item: { id: string; name: string; icon: string; price: number; borderColor: string; badge?: string; badge2?: string; badgeColor?: string; disabled?: boolean; onClick: () => void }) => (
        <button key={item.id} onClick={item.onClick} disabled={selling || item.disabled}
            style={tileStyle(item.borderColor, item.disabled)}
            onMouseEnter={e => { if (!item.disabled) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'; } }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(0,0,0,0.04)'; }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '17px' }}>{item.icon}</span>
                <div style={{ fontSize: '13px', fontWeight: 700, color: '#1a1d27', lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' as const }}>{item.name}</div>
            </div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: item.borderColor, marginTop: 'auto' }}>
                {item.price.toLocaleString('vi-VN')}đ
            </div>
            {(item.badge || item.badge2) && (
                <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                    {item.badge && <span style={{ background: item.badgeColor || '#f1f5f9', color: '#475569', padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>{item.badge}</span>}
                    {item.badge2 && <span style={{ background: item.badgeColor || '#f1f5f9', color: '#475569', padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: 600 }}>{item.badge2}</span>}
                </div>
            )}
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
        { key: 'LESSON', label: 'Học Bơi', icon: '📚', count: lessonTypes.length },
        { key: 'PRODUCT', label: 'Sản Phẩm', icon: '🥤', count: products.length },
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
                alert('Không thể khởi tạo trình in bộ nhớ tạm.');
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
                            <span>{checkoutReceipt.paymentMethod === 'CASH' ? 'Tiền mặt' : checkoutReceipt.paymentMethod === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS'}</span>
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
        <div className="page-container" style={{ maxWidth: '1200px' }}>
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>{activeTab === 'SELL' ? '🏪 Bán Hàng' : '📸 Check-in Thẻ'}</h1>
                    <p>{activeTab === 'SELL' ? 'Chọn sản phẩm / dịch vụ để bán' : 'Quét mã Thẻ của khách để in vé lượt'}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '12px' }}>
                    <button className={`btn ${activeTab === 'SELL' ? 'btn-primary' : 'btn-ghost'}`} style={{ border: 'none', margin: 0, padding: '8px 16px' }} onClick={() => setActiveTab('SELL')}>Bán Hàng <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '4px' }}>(F4)</span></button>
                    <button className={`btn ${activeTab === 'CHECKIN' ? 'btn-primary' : 'btn-ghost'}`} style={{ border: 'none', margin: 0, padding: '8px 16px' }} onClick={() => setActiveTab('CHECKIN')}>Quẹt Thẻ Gói <span style={{ fontSize: '10px', opacity: 0.7, marginLeft: '4px' }}>(F2)</span></button>
                </div>
            </div>

            {activeTab === 'SELL' && (
                <div style={{ display: 'flex', gap: '24px', animation: 'fadeIn 0.3s ease', alignItems: 'flex-start' }}>

                    {/* LEFT COLUMN: Search + Filter Tabs + Product Grid */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {/* Search Bar */}
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '18px', color: '#94a3b8' }}>🔍</span>
                            <input
                                type="text"
                                placeholder="Tìm sản phẩm, vé, dịch vụ..."
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                                style={{
                                    width: '100%', padding: '12px 16px 12px 44px', border: '1px solid #e2e8f0',
                                    borderRadius: '12px', fontSize: '14px', background: '#fff',
                                    boxShadow: '0 1px 3px rgba(0,0,0,0.04)', outline: 'none',
                                    transition: 'border-color 0.2s',
                                }}
                                onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                                onBlur={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                            />
                            {searchTerm && (
                                <button onClick={() => setSearchTerm('')}
                                    style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#94a3b8' }}>✕</button>
                            )}
                        </div>

                        {/* Category Tabs */}
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                            {categoryTabs.map(tab => (
                                <button key={tab.key}
                                    onClick={() => setActiveCategory(tab.key)}
                                    style={{
                                        padding: '7px 14px', borderRadius: '20px', border: 'none',
                                        fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                                        background: activeCategory === tab.key ? '#3b82f6' : '#f1f5f9',
                                        color: activeCategory === tab.key ? '#fff' : '#475569',
                                        transition: 'all 0.15s',
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                    }}>
                                    <span>{tab.icon}</span> {tab.label}
                                    <span style={{
                                        background: activeCategory === tab.key ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                                        padding: '1px 7px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
                                        marginLeft: '2px',
                                    }}>{tab.count}</span>
                                </button>
                            ))}
                        </div>

                        {/* Product Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '12px', alignContent: 'start' }}>
                            {filteredItems.length > 0 ? filteredItems.map(item => renderTile(item)) : (
                                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '8px' }}>🔍</div>
                                    <p>Không tìm thấy sản phẩm "{searchTerm}"</p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* RIGHT COLUMN: CART */}
                    <div style={{ width: '360px', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', maxHeight: 'calc(100vh - 120px)', position: 'sticky', top: '24px' }}>
                        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                                <h2 style={{ fontSize: '18px', margin: 0 }}>🛒 Giỏ hàng</h2>
                                <span style={{ background: 'var(--bg-hover)', padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: 600 }}>{cart.length} món</span>
                            </div>

                            {/* ALWAYS-VISIBLE CUSTOMER SEARCH BAR */}
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <div style={{ flex: 1, position: 'relative' }}>
                                    <span style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '14px', color: '#94a3b8' }}>🔍</span>
                                    <input
                                        ref={customerSearchRef}
                                        type="text"
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
                                        style={{
                                            width: '100%', padding: '8px 10px 8px 32px', fontSize: '13px',
                                            borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none',
                                            background: '#f8fafc',
                                        }}
                                        onFocus={e => e.currentTarget.style.borderColor = '#3b82f6'}
                                        onBlur={e => e.currentTarget.style.borderColor = '#e2e8f0'}
                                    />
                                    <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', fontSize: '10px', color: '#94a3b8', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>F3</span>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowNewCustomerModal(true);
                                        setNewCustCardCode(''); setNewCustName(''); setNewCustPhone('');
                                        setNewCustEmail(''); setNewCustBirthDate(''); setNewCustGender('');
                                        setNewCustNote(''); setNewCustAddress(''); setNewCustHotkey('');
                                    }}
                                    style={{
                                        width: '36px', height: '36px', borderRadius: '8px', border: '1px solid #e2e8f0',
                                        background: '#f8fafc',
                                        color: '#475569',
                                        cursor: 'pointer', fontSize: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'all 0.15s', flexShrink: 0,
                                    }}
                                    title="Thêm khách hàng mới"
                                >+</button>
                            </div>

                            {/* Search results dropdown */}
                            {custSearchResults.length > 0 && (
                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '6px', maxHeight: '150px', overflowY: 'auto', background: '#fff', boxShadow: '0 4px 12px rgba(0,0,0,0.08)' }}>
                                    {custSearchResults.map((c, i) => (
                                        <div key={c.id || i} onClick={() => {
                                            setCustomerName(c.full_name);
                                            setCustomerPhone(c.phone);
                                            setCardCode(c.card_code);
                                            setSelectedCustomerId(c.id);
                                            setSelectedCustomerBirthDate(c.birth_date || null);
                                            setCustSearchResults([]);
                                            setCustSearchTerm('');
                                        }} style={{
                                            padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9',
                                            fontSize: '13px', transition: 'background 0.15s'
                                        }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f0f9ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                            <strong>{c.full_name || 'N/A'}</strong>
                                            <span style={{ marginLeft: '8px', color: '#64748b' }}>📞 {c.phone || '—'}</span>
                                            <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '11px' }}>🏷️ {maskCardCode(c.card_code) || '—'}</span>
                                            {c.hotkey && <span style={{ marginLeft: '6px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>⌨ {c.hotkey}</span>}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {searchingCust && <span style={{ fontSize: '11px', color: '#64748b', marginTop: '4px', display: 'block' }}>Đang tìm...</span>}

                            {/* Selected customer info display */}
                            {(cardCode || customerName || customerPhone) && (
                                <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0fdf4', borderRadius: '8px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontSize: '12px' }}>
                                        <div style={{ fontWeight: 600, color: '#166534' }}>👤 {customerName || 'Chưa có tên'}</div>
                                        <div style={{ color: '#64748b', marginTop: '2px' }}>
                                            {cardCode && <span>🏷️ {maskCardCode(cardCode)}</span>}
                                            {customerPhone && <span style={{ marginLeft: '8px' }}>📞 {customerPhone}</span>}
                                            {(() => { const hk = hotkeyCustomers.find(c => c.id === selectedCustomerId); return hk?.hotkey ? <span style={{ marginLeft: '6px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '4px', fontSize: '10px', fontWeight: 700 }}>⌨ {hk.hotkey}</span> : null; })()}
                                        </div>
                                    </div>
                                    <button onClick={() => {
                                        setCustomerName(''); setCustomerPhone(''); setCardCode('');
                                        setSelectedCustomerId(null); setSelectedCustomerBirthDate(null); setCustSearchTerm('');
                                    }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '14px', padding: '0 4px' }}>&times;</button>
                                </div>
                            )}
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {cart.length === 0 ? (
                                <div style={{ textAlign: 'center', color: 'var(--text-muted)', margin: '40px 0' }}>
                                    <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛍️</div>
                                    <p>Giỏ hàng trống</p>
                                </div>
                            ) : (
                                cart.map(c => (
                                    <div key={c.cart_id} style={{ display: 'flex', gap: '12px', paddingBottom: '12px', borderBottom: '1px dashed #e2e8f0' }}>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: 600, fontSize: '14px', marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>{c.item.name} {c.type === 'TICKET' && c.item.category === 'LESSON' ? (c.privateSessions ? `(${c.privateSessions} buổi)` : '') : ''}</span>
                                                <button onClick={() => setCart(prev => prev.filter(x => x.cart_id !== c.cart_id))} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '0 4px' }}>&times;</button>
                                            </div>
                                            {(c.customerName || c.customerName2 || (c as any).extraStudents?.length) && (
                                                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                                                    👤 {c.customerName}{(c as any).extraStudents?.length ? ` & ${(c as any).extraStudents.map((s: any) => s.name).filter(Boolean).join(', ')}` : c.customerName2 ? ` & ${c.customerName2}` : ''}
                                                </div>
                                            )}
                                            {c.promoId && (() => {
                                                const promo = promotions.find(p => p.id === c.promoId);
                                                if (!promo) return null;
                                                const label = promo.type === 'AMOUNT' ? `−${promo.value.toLocaleString('vi-VN')}đ` : promo.type === 'PERCENT' ? `−${promo.value}%` : `+${promo.value} buổi`;
                                                return (
                                                    <div style={{ fontSize: '11px', color: '#059669', fontWeight: 600, marginBottom: '4px' }}>
                                                        🎁 {promo.name} ({label})
                                                    </div>
                                                );
                                            })()}
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                                                <div style={{ color: 'var(--accent-blue)', fontWeight: 700, fontSize: '14px' }}>{c.unitPrice.toLocaleString('vi-VN')}đ</div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', borderRadius: '6px', padding: '2px' }}>
                                                    <button onClick={() => setCart(prev => prev.map(x => x.cart_id === c.cart_id ? { ...x, quantity: Math.max(1, x.quantity - 1), subtotal: Math.max(1, x.quantity - 1) * x.unitPrice } : x))} style={{ border: 'none', background: 'none', width: '24px', cursor: 'pointer', fontWeight: 'bold' }}>-</button>
                                                    <span style={{ fontSize: '13px', fontWeight: 600, width: '20px', textAlign: 'center' }}>{c.quantity}</span>
                                                    <button onClick={() => {
                                                        if (c.type === 'PRODUCT' && c.quantity + 1 > c.item.stock_quantity) {
                                                            alert(`Sản phẩm chỉ còn ${c.item.stock_quantity} trong kho!`);
                                                            return;
                                                        }
                                                        setCart(prev => prev.map(x => x.cart_id === c.cart_id ? { ...x, quantity: x.quantity + 1, subtotal: (x.quantity + 1) * x.unitPrice } : x));
                                                    }} style={{ border: 'none', background: 'none', width: '24px', cursor: 'pointer', fontWeight: 'bold' }}>+</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        <div style={{ padding: '20px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', fontSize: '18px', fontWeight: 800 }}>
                                <span>Tổng cộng:</span>
                                <span style={{ color: 'var(--accent-green)' }}>{cart.reduce((s, c) => s + c.subtotal, 0).toLocaleString('vi-VN')}đ</span>
                            </div>
                            <button className="btn btn-primary" style={{ width: '100%', padding: '14px', fontSize: '15px' }} disabled={cart.length === 0 || selling}
                                onClick={() => {
                                    const hasAdvanced = cart.some(c => c.type === 'TICKET' && c.item.category !== 'DAILY');
                                    if (hasAdvanced && (!cardCode.trim() || !customerPhone.trim())) {
                                        alert('Vui lòng nhập thông tin khách hàng (Mã thẻ, SĐT) trước khi thanh toán vé gói/thẻ tháng/khóa học.\n\nBấm F3 để tìm khách cũ hoặc bấm "+" để thêm khách mới.');
                                        customerSearchRef.current?.focus();
                                        return;
                                    }
                                    setShowPaymentModal(true);
                                }}>
                                Thanh Toán
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'CHECKIN' && (
                <section className="dashboard-content-card" style={{ maxWidth: '600px', margin: '0 auto', textAlign: 'center', animation: 'fadeIn 0.3s ease' }}>
                    <div style={{ padding: '32px 0' }}>
                        <div style={{ fontSize: '48px', marginBottom: '16px' }}>📸</div>
                        <h2 style={{ marginBottom: '8px' }}>Quét Thẻ Tháng / Thẻ Nhiểu Buổi</h2>
                        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>Dùng máy quét mã vạch hoặc nhập mã thẻ vào ô bên dưới để lấy vé lượt cho khách đi qua cổng kiểm soát.</p>

                        <form onSubmit={handleCheckinSubmit} style={{ maxWidth: '400px', margin: '0 auto' }}>
                            {checkinError && <div className="alert alert-error" style={{ marginBottom: '16px' }}>{checkinError}</div>}
                            <input
                                ref={scannerInputRef}
                                type="text"
                                className="input"
                                placeholder="Quét mã QR Thẻ vào đây..."
                                value={checkinCode}
                                onChange={e => setCheckinCode(normalizeScannerInput(e.target.value))}
                                style={{ textAlign: 'center', fontSize: '18px', padding: '16px', marginBottom: '16px' }}
                                autoFocus
                            />
                            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '12px' }} disabled={checkingIn}>
                                {checkingIn ? 'Đang xử lý...' : 'Xác nhận (Enter)'}
                            </button>
                        </form>
                    </div>
                </section>
            )}

            {/* Modal Preview Checkin */}
            {previewTicket && (
                <div className="modal-overlay" onClick={() => setPreviewTicket(null)}>
                    <div className="modal-card" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px', padding: '32px 24px' }}>
                        <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                            <div style={{ fontSize: '56px', marginBottom: '12px', lineHeight: 1 }}>👤</div>
                            <h2 style={{ fontSize: '22px', marginBottom: '8px' }}>Xác Nhận Check-in</h2>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Kiểm tra thông tin khách hàng trước khi xác nhận</p>
                        </div>
                        
                        <div style={{ background: '#f8fafc', padding: '20px', borderRadius: '16px', marginBottom: '28px', border: '1px solid #e2e8f0', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px dashed #cbd5e1' }}>
                                <span style={{ color: '#64748b', fontSize: '14px' }}>Khách hàng</span>
                                <strong style={{ fontSize: '16px', color: '#0f172a' }}>{previewTicket.customer_name || 'Khách vãng lai'}</strong>
                            </div>
                            
                            {previewTicket.customer_phone && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px dashed #cbd5e1' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Số điện thoại</span>
                                    <strong style={{ fontSize: '15px' }}>{previewTicket.customer_phone}</strong>
                                </div>
                            )}

                            {previewTicket.customer_name_2 && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px dashed #cbd5e1' }}>
                                    <span style={{ color: '#64748b', fontSize: '14px' }}>Học viên 2</span>
                                    <strong style={{ fontSize: '15px' }}>{previewTicket.customer_name_2}</strong>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px', paddingBottom: '14px', borderBottom: '1px dashed #cbd5e1' }}>
                                <span style={{ color: '#64748b', fontSize: '14px' }}>Gói thẻ</span>
                                <span style={{ fontWeight: 700, color: '#3b82f6', textAlign: 'right', fontSize: '15px' }}>
                                    {previewTicket.ticket_types?.category === 'LESSON' ? '📚 Học Bơi' : '🏊 ' + previewTicket.ticket_types?.name}
                                </span>
                            </div>

                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span style={{ color: '#64748b', fontSize: '14px' }}>Số buổi còn lại</span>
                                <strong style={{ fontSize: '16px', color: previewTicket.remaining_sessions !== null && previewTicket.remaining_sessions <= 3 ? '#ef4444' : '#10b981' }}>
                                    {previewTicket.remaining_sessions !== null ? `${previewTicket.remaining_sessions} buổi` : 'Không giới hạn'}
                                </strong>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button className="btn btn-secondary" style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: 600, background: '#f1f5f9', color: '#475569', border: 'none' }} onClick={() => setPreviewTicket(null)}>
                                Hủy (ESC)
                            </button>
                            <button 
                                className="btn btn-primary" 
                                style={{ flex: 1, padding: '14px', fontSize: '15px', fontWeight: 600, background: '#0ea5e9', border: 'none', boxShadow: '0 4px 12px rgba(14,165,233,0.3)' }} 
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
                        <div style={{ background: '#f8fafc', padding: '16px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #e2e8f0' }}>
                            <p style={{ margin: 0, fontWeight: 500 }}>{selectedAdvancedType.name}</p>

                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px' }}>
                                <span style={{ color: 'var(--text-secondary)' }}>Tiền thu:</span>
                                <span>
                                    {selectedPromoId ? (() => {
                                        const p = promotions.find(x => x.id === selectedPromoId);
                                        let curr = selectedAdvancedType.price;
                                        if (p?.type === 'AMOUNT') curr = Math.max(0, curr - p.value);
                                        if (p?.type === 'PERCENT') curr = Math.round(curr * (1 - p.value / 100));
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
                                    {selectedPromoId ? (() => {
                                        const p = promotions.find(x => x.id === selectedPromoId);
                                        let sess = selectedAdvancedType.session_count;
                                        if (p?.type === 'BONUS_SESSION' && sess) {
                                            return (
                                                <>
                                                    <span style={{ textDecoration: 'line-through', color: '#999', marginRight: '8px', fontSize: '13px' }}>{sess}</span>
                                                    <strong style={{ color: 'var(--accent-blue)' }}>{sess + p.value} lượt</strong>
                                                </>
                                            )
                                        }
                                        return <strong>{sess || 'Không giới hạn'}</strong>
                                    })() : (
                                        <strong>{selectedAdvancedType.session_count || 'Không giới hạn'}</strong>
                                    )}
                                </span>
                            </div>
                        </div>

                        {/* PRIVATE LESSON (1:1 / 1:2) — Staff enters sessions & duration */}
                        <form onSubmit={handleAdvancedSubmit}>
                            {selectedAdvancedType.category !== 'DAILY' && (
                                <>
                                    {/* Khách hàng thông tin đã được chuyển qua Modal Thanh Toán (Checkout Form) */}
                                </>
                            )}

                            {isPrivateLesson(selectedAdvancedType) && (() => {
                                const sc = getStudentCount(selectedAdvancedType);
                                return (
                                <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bbf7d0' }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: '#166534' }}>
                                        🧑‍🏫 Thông tin đăng ký lớp 1:{sc}
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
                                <label>Áp dụng Khuyến mãi (Tùy chọn)</label>
                                <select
                                    value={selectedPromoId}
                                    onChange={e => setSelectedPromoId(e.target.value)}
                                    style={{ borderColor: selectedPromoId ? 'var(--accent-blue)' : '' }}
                                >
                                    <option value="">-- Không áp dụng KM --</option>
                                    {promotions
                                        .filter(p => {
                                            if (!p.is_active) return false;
                                            // Check date range
                                            if (p.valid_from && new Date() < new Date(p.valid_from)) return false;
                                            if (p.valid_until && new Date() > new Date(p.valid_until)) return false;
                                            if (selectedAdvancedType.category === 'LESSON') {
                                                // For lessons: only show promos that EXPLICITLY list this lesson type
                                                return p.applicable_lesson_types !== null && p.applicable_lesson_types.includes(selectedAdvancedType.id);
                                            }
                                            return p.applicable_ticket_types === null || p.applicable_ticket_types.includes(selectedAdvancedType.id);
                                        })
                                        .map(p => {
                                            let label = p.name;
                                            if (p.type === 'AMOUNT') label += ` (-${p.value.toLocaleString()}đ)`;
                                            if (p.type === 'PERCENT') label += ` (-${p.value}%)`;
                                            if (p.type === 'BONUS_SESSION') label += ` (+${p.value} lượt)`;
                                            return <option key={p.id} value={p.id}>{label}</option>
                                        })}
                                </select>
                            </div>



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
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => setShowPaymentModal(false)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)', maxHeight: '90vh', overflowY: 'auto' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>💳 Thanh toán Đơn hàng</h2>
                            <button onClick={() => setShowPaymentModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>

                        {(() => {
                            const hasAdvanced = cart.some(c => c.type === 'TICKET' && c.item.category !== 'DAILY');
                            const actualPrice = cart.reduce((s, c) => s + c.subtotal, 0);
                            const isFreeTicket = actualPrice === 0;

                            return (
                                <form onSubmit={(e) => { e.preventDefault(); doCheckoutOrder(); }}>
                                    {hasAdvanced && (
                                        <div style={{ background: '#f0fdf4', padding: '14px 16px', borderRadius: '8px', marginBottom: '20px', border: '1px solid #bbf7d0' }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: '#166534', marginBottom: '4px' }}>👤 Thông tin cấp thẻ</div>
                                            <div style={{ fontSize: '14px', fontWeight: 600 }}>{customerName || 'Chưa có tên'}</div>
                                            <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>
                                                {cardCode && <span>🏷️ {maskCardCode(cardCode)}</span>}
                                                {customerPhone && <span style={{ marginLeft: '8px' }}>📞 {customerPhone}</span>}
                                            </div>
                                        </div>
                                    )}

                                    {!isFreeTicket ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                                            <div style={{ marginBottom: '8px', fontWeight: 600, fontSize: '16px', display: 'flex', justifyContent: 'space-between' }}>
                                                <span>Tổng tiền:</span>
                                                <span style={{ color: 'var(--accent-green)' }}>{actualPrice.toLocaleString('vi-VN')}đ</span>
                                            </div>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', background: selectedPaymentMethod === 'CASH' ? 'var(--bg-hover)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="CASH" checked={selectedPaymentMethod === 'CASH'} onChange={() => setSelectedPaymentMethod('CASH')} />
                                                <span style={{ fontSize: '16px', fontWeight: 500 }}>💵 Tiền mặt</span>
                                            </label>

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', background: selectedPaymentMethod === 'TRANSFER' ? 'var(--bg-hover)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="TRANSFER" checked={selectedPaymentMethod === 'TRANSFER'} onChange={() => setSelectedPaymentMethod('TRANSFER')} />
                                                <span style={{ fontSize: '16px', fontWeight: 500 }}>🏦 Chuyển khoản</span>
                                            </label>

                                            {selectedPaymentMethod === 'TRANSFER' && bizInfo.bank_account_number && (
                                                <div style={{ padding: '12px', background: '#f8fafc', borderRadius: '8px', fontSize: '13px', marginLeft: '32px', border: '1px dashed #cbd5e1' }}>
                                                    <div>Ngân hàng: <strong>{bizInfo.bank_name}</strong></div>
                                                    <div>Số tài khoản: <strong style={{ color: '#0f172a', fontSize: '15px' }}>{bizInfo.bank_account_number}</strong></div>
                                                    <div>Chủ TK: <strong>{bizInfo.bank_account_name}</strong></div>
                                                </div>
                                            )}

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', background: selectedPaymentMethod === 'CARD' ? 'var(--bg-hover)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="CARD" checked={selectedPaymentMethod === 'CARD'} onChange={() => setSelectedPaymentMethod('CARD')} />
                                                <span style={{ fontSize: '16px', fontWeight: 500 }}>💳 Quẹt thẻ (POS)</span>
                                            </label>
                                        </div>
                                    ) : (
                                        <div style={{ marginBottom: '24px', textAlign: 'center', color: 'var(--accent-green)' }}>
                                            <p style={{ fontSize: '16px', fontWeight: 600 }}>Miễn phí (0đ)</p>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowPaymentModal(false)}>Hủy</button>
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

            {/* MODAL LỰA CHỌN GÓI VÉ CHECK-IN */}
            {showPackageSelectModal && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => setShowPackageSelectModal(false)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', maxWidth: '500px', width: '90%', boxShadow: 'var(--shadow-lg)', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}
                        onClick={e => e.stopPropagation()}>

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>🗂️ Chọn gói vé sử dụng</h2>
                            <button onClick={() => setShowPackageSelectModal(false)} style={{ background: 'none', border: 'none', fontSize: '24px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>

                        <p style={{ color: 'var(--text-secondary)', marginBottom: '16px', fontSize: '14px' }}>
                            Thẻ này đang chứa nhiều gói khả dụng. Vui lòng hỏi khách muốn dùng gói nào hôm nay:
                        </p>

                        <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {availablePackages.map((pkg, idx) => {
                                const isLesson = pkg.category === 'LESSON';
                                const isActive = pkg.is_active;
                                return (
                                    <button
                                        key={idx}
                                        onClick={() => handleSelectPackage(pkg.id)}
                                        style={{
                                            display: 'flex', flexDirection: 'column', gap: '8px',
                                            padding: '16px', borderRadius: '12px',
                                            background: isLesson ? '#f0fdf4' : '#f8fafc',
                                            border: `1px solid ${isLesson ? '#bbf7d0' : '#e2e8f0'}`,
                                            cursor: 'pointer', textAlign: 'left',
                                            transition: 'all 0.2s', position: 'relative', overflow: 'hidden'
                                        }}
                                        onMouseEnter={e => e.currentTarget.style.borderColor = isLesson ? '#22c55e' : '#3b82f6'}
                                        onMouseLeave={e => e.currentTarget.style.borderColor = isLesson ? '#bbf7d0' : '#e2e8f0'}
                                    >
                                        <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontSize: '20px' }}>{isLesson ? '📚' : '🏊'}</span>
                                                <strong style={{ fontSize: '15px', color: '#1e293b' }}>{pkg.type_name}</strong>
                                            </div>
                                            {!isActive && (
                                                <span style={{ fontSize: '11px', background: '#fef08a', color: '#854d0e', padding: '4px 8px', borderRadius: '12px', fontWeight: 600 }}>
                                                    Chưa kích hoạt
                                                </span>
                                            )}
                                        </div>

                                        <div style={{ fontSize: '13px', color: '#475569', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <div>👤 <span style={{ fontWeight: 500 }}>{pkg.customer_name || 'Khách'}</span></div>
                                            <div>
                                                🎟️ Còn lại: <strong style={{ color: '#0f172a' }}>{pkg.remaining_sessions !== null ? `${pkg.remaining_sessions} buổi` : 'Không giới hạn'}</strong>
                                                <span style={{ color: '#94a3b8', margin: '0 4px' }}>/</span>
                                                {pkg.total_sessions !== null ? pkg.total_sessions : '∞'} buổi
                                            </div>
                                            {(pkg.valid_from || pkg.valid_until) && (
                                                <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
                                                    Hạn: {pkg.valid_from ? new Date(pkg.valid_from).toLocaleDateString('vi-VN') : '---'} → {pkg.valid_until ? new Date(pkg.valid_until).toLocaleDateString('vi-VN') : 'Không giới hạn'}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
            {/* ========== NEW CUSTOMER MODAL POPUP ========== */}
            {showNewCustomerModal && (
                <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') setShowNewCustomerModal(false);
                        if (e.key === 'F8') { e.preventDefault(); handleSaveNewCustomer(); }
                    }}>
                    <div style={{ background: '#fff', borderRadius: '16px', width: '480px', maxWidth: '95vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.15)' }}>
                        {/* Header */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '20px 24px', borderBottom: '1px solid #e2e8f0' }}>
                            <h2 style={{ margin: 0, fontSize: '18px', fontWeight: 700 }}>Tạo khách hàng mới</h2>
                            <button onClick={() => setShowNewCustomerModal(false)} style={{ background: 'none', border: 'none', fontSize: '22px', cursor: 'pointer', color: '#64748b', padding: '4px' }}>&times;</button>
                        </div>
                        {/* Form */}
                        <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {/* Mã thẻ */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Mã thẻ <span style={{ color: '#ef4444' }}>*</span></label>
                                <input type="text" value={newCustCardCode} onChange={e => setNewCustCardCode(e.target.value)} placeholder="Mã thẻ nhựa" autoFocus
                                    style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            {/* Họ và tên */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Họ và tên <span style={{ color: '#ef4444' }}>*</span></label>
                                <input type="text" value={newCustName} onChange={e => setNewCustName(e.target.value)} placeholder="Họ và tên"
                                    style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            {/* SĐT + Email */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Số điện thoại <span style={{ color: '#ef4444' }}>*</span></label>
                                    <input type="tel" value={newCustPhone} onChange={e => setNewCustPhone(e.target.value)} placeholder="Số điện thoại"
                                        style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Email</label>
                                    <input type="email" value={newCustEmail} onChange={e => setNewCustEmail(e.target.value)} placeholder="Email"
                                        style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                            </div>
                            {/* Ngày sinh + Giới tính */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Ngày sinh</label>
                                    <input type="date" value={newCustBirthDate} onChange={e => setNewCustBirthDate(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                                </div>
                                <div>
                                    <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Giới tính</label>
                                    <select value={newCustGender} onChange={e => setNewCustGender(e.target.value)}
                                        style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                                        <option value="">Chọn giới tính</option>
                                        <option value="Nam">Nam</option>
                                        <option value="Nữ">Nữ</option>
                                        <option value="Khác">Khác</option>
                                    </select>
                                </div>
                            </div>
                            {/* Ghi chú */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Ghi chú</label>
                                <input type="text" value={newCustNote} onChange={e => setNewCustNote(e.target.value)} placeholder="Ghi chú"
                                    style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            {/* Địa chỉ */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>Địa chỉ</label>
                                <input type="text" value={newCustAddress} onChange={e => setNewCustAddress(e.target.value)} placeholder="Địa chỉ"
                                    style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', boxSizing: 'border-box' }} />
                            </div>
                            {/* Phím tắt */}
                            <div>
                                <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: '#334155', marginBottom: '6px' }}>⌨ Phím tắt <span style={{ color: '#94a3b8', fontWeight: 400 }}>(không bắt buộc)</span></label>
                                <select value={newCustHotkey} onChange={e => setNewCustHotkey(e.target.value)}
                                    style={{ width: '100%', padding: '10px 14px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', outline: 'none', background: '#fff', boxSizing: 'border-box' }}>
                                    <option value="">-- Không gán phím tắt --</option>
                                    {['F6', 'F7', 'F8', 'F9', 'F10'].filter(k => !hotkeyCustomers.some(c => c.hotkey === k)).map(k => (
                                        <option key={k} value={k}>{k}</option>
                                    ))}
                                </select>
                                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>Gán phím tắt để nhấn nhanh điền thông tin KH khi bán hàng</div>
                            </div>
                        </div>
                        {/* Footer */}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', padding: '16px 24px', borderTop: '1px solid #e2e8f0' }}>
                            <button onClick={() => setShowNewCustomerModal(false)}
                                style={{ padding: '10px 20px', fontSize: '14px', borderRadius: '8px', border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#475569' }}>
                                Hủy <span style={{ background: '#e2e8f0', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>ESC</span>
                            </button>
                            <button onClick={handleSaveNewCustomer} disabled={savingCustomer}
                                style={{ padding: '10px 20px', fontSize: '14px', borderRadius: '8px', border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, opacity: savingCustomer ? 0.7 : 1 }}>
                                {savingCustomer ? 'Đang lưu...' : 'Lưu'} <span style={{ background: 'rgba(255,255,255,0.2)', padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>F8</span>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRODUCT VARIANT SELECTION MODAL */}
            {selectingVariantFor && (
                <div className="modal-overlay" style={{ zIndex: 1100 }}>
                    <div className="modal-card" style={{ maxWidth: '450px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>Chọn phân loại: {selectingVariantFor.name}</h2>
                            <button onClick={() => setSelectingVariantFor(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#64748b' }}>&times;</button>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '60vh', overflowY: 'auto', paddingRight: '4px' }}>
                            {products.filter(v => v.parent_id === selectingVariantFor.id && v.is_active).map(variant => (
                                <button
                                    key={variant.id}
                                    disabled={variant.stock_quantity <= 0}
                                    onClick={() => {
                                        handleProductSaleClick(variant);
                                        setSelectingVariantFor(null);
                                    }}
                                    style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        padding: '14px 16px', borderRadius: '12px', border: `1px solid ${variant.stock_quantity > 0 ? '#e2e8f0' : '#f1f5f9'}`,
                                        background: variant.stock_quantity > 0 ? '#fff' : '#f8fafc', cursor: variant.stock_quantity > 0 ? 'pointer' : 'not-allowed',
                                        opacity: variant.stock_quantity > 0 ? 1 : 0.6,
                                        boxShadow: variant.stock_quantity > 0 ? '0 1px 2px rgba(0,0,0,0.05)' : 'none',
                                        transition: 'all 0.2s ease', textAlign: 'left'
                                    }}
                                    onMouseEnter={e => {
                                        if (variant.stock_quantity > 0) {
                                            e.currentTarget.style.borderColor = '#f59e0b';
                                            e.currentTarget.style.boxShadow = '0 4px 12px rgba(245, 158, 11, 0.1)';
                                            e.currentTarget.style.transform = 'translateY(-1px)';
                                        }
                                    }}
                                    onMouseLeave={e => {
                                        if (variant.stock_quantity > 0) {
                                            e.currentTarget.style.borderColor = '#e2e8f0';
                                            e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.05)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                        }
                                    }}
                                >
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '15px', color: '#1e293b', marginBottom: '4px' }}>
                                            {variant.sku || variant.name.replace(selectingVariantFor.name + ' — ', '')}
                                        </div>
                                        <div style={{ fontSize: '13px', color: '#64748b' }}>
                                            {variant.price.toLocaleString('vi-VN')}đ / {variant.unit}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        {variant.stock_quantity > 0 ? (
                                            <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>
                                                Còn {variant.stock_quantity}
                                            </span>
                                        ) : (
                                            <span style={{ background: '#fee2e2', color: '#991b1b', padding: '4px 8px', borderRadius: '8px', fontSize: '12px', fontWeight: 600 }}>
                                                Hết hàng
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
