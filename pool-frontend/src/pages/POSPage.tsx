import { useEffect, useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { TicketType, Ticket } from '../types';

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
}

export default function POSPage() {
    const { profile } = useAuth();
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
    const [loading, setLoading] = useState(true);
    const [selling, setSelling] = useState(false);
    const [soldTickets, setSoldTickets] = useState<SoldTicket[]>([]); // Array of sold tickets

    // Daily tickets quantity mapping
    const [dailyQuantities, setDailyQuantities] = useState<Record<string, number>>({});

    // Modal states for Advanced Tickets (MULTI / MONTHLY)
    const [customerName, setCustomerName] = useState('');
    const [customerPhone, setCustomerPhone] = useState('');
    const [cardCode, setCardCode] = useState('');
    const [selectedAdvancedType, setSelectedAdvancedType] = useState<TicketType | null>(null);

    // New/Existing customer toggle
    const [customerMode, setCustomerMode] = useState<'NEW' | 'EXISTING'>('NEW');
    const [custSearchTerm, setCustSearchTerm] = useState('');
    const [custSearchResults, setCustSearchResults] = useState<{ name: string, phone: string, card_code: string, birth_year?: number | null }[]>([]);
    const [searchingCust, setSearchingCust] = useState(false);

    // Promotions
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [selectedPromoId, setSelectedPromoId] = useState<string>('');
    const printRef = useRef<HTMLDivElement>(null);

    // Business Info & Payment Options
    const [bizInfo, setBizInfo] = useState<BusinessInfo>({});
    const [showPaymentModal, setShowPaymentModal] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'CASH' | 'TRANSFER' | 'CARD'>('CASH');
    const [pendingTicketData, setPendingTicketData] = useState<{
        ticketType: TicketType;
        name: string | null;
        phone: string | null;
        promoId: string | null;
        code: string | null;
        quantity: number; // New parameter
    } | null>(null);

    // Active Tab (Bán Vé | Check-in Thẻ)
    const [activeTab, setActiveTab] = useState<'SELL' | 'CHECKIN'>('SELL');
    // Check-in State
    const [checkinCode, setCheckinCode] = useState('');
    const [checkingIn, setCheckingIn] = useState(false);
    const [checkinError, setCheckinError] = useState('');
    const scannerInputRef = useRef<HTMLInputElement>(null);

    // Private lesson (1:1 / 1:2) registration fields
    const [privateSessions, setPrivateSessions] = useState<number | ''>(10);
    const [privateDurationVal, setPrivateDurationVal] = useState<number | ''>('');
    const [privateDurationUnit, setPrivateDurationUnit] = useState<'months' | 'days'>('months');
    const [privateUnlimited, setPrivateUnlimited] = useState(true);
    const [privateBirthYear, setPrivateBirthYear] = useState<number | ''>('');
    const [customerName2, setCustomerName2] = useState('');
    const [privateBirthYear2, setPrivateBirthYear2] = useState<number | ''>('');

    // Multi-package selection state
    const [showPackageSelectModal, setShowPackageSelectModal] = useState(false);
    const [availablePackages, setAvailablePackages] = useState<any[]>([]);
    const [pendingCheckinCode, setPendingCheckinCode] = useState('');

    useEffect(() => {
        fetchTicketTypes();
        fetchPromotions();
        fetchBusinessInfo();

        // Initialize speech synthesis Voices early
        if ('speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
        }
    }, []);

    // Helper TTS function
    function speakMessage(text: string) {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // limit overlapping
            const msg = new SpeechSynthesisUtterance(text);
            msg.lang = 'vi-VN';
            // Slight adjustments for better Vietnamese sound
            msg.rate = 1.0;
            msg.pitch = 1.0;
            window.speechSynthesis.speak(msg);
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
                bank_account_name: info.bank_account_name || ''
            });
        }
    }

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
        setCustomerName('');
        setCustomerPhone('');
        setCardCode('');
        setSelectedPromoId('');
        setCustomerMode('NEW');
        setCustSearchTerm('');
        setCustSearchResults([]);
        // Reset private lesson fields
        setPrivateSessions(10);
        setPrivateDurationVal('');
        setPrivateDurationUnit('months');
        setPrivateUnlimited(true);
        setPrivateBirthYear('');
        setCustomerName2('');
        setPrivateBirthYear2('');
    }

    async function doSellTicket(
        ticketType: TicketType,
        name: string | null,
        phone: string | null,
        promoId: string | null,
        code: string | null,
        paymentMethod: 'CASH' | 'TRANSFER' | 'CARD',
        name2?: string | null,
        birthYear2?: number | null
    ) {
        setSelling(true);
        const closeTime = await getPoolCloseTime();

        // Calculate valid_until based on validity_days constraint from settings
        let validUntil = null;
        let validFrom = null;

        if (ticketType.category === 'DAILY') {
            // Daily tickets: set valid_from and valid_until immediately
            if (ticketType.validity_days) {
                const today = new Date();
                const tzOffset = today.getTimezoneOffset() * 60000;
                const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, -1);
                validFrom = localISOTime.split('T')[0];

                const expDate = new Date(today);
                const daysToAdd = ticketType.validity_days > 0 ? ticketType.validity_days - 1 : 0;
                expDate.setDate(today.getDate() + daysToAdd);
                const localISOExp = (new Date(expDate.getTime() - tzOffset)).toISOString().slice(0, -1);
                validUntil = localISOExp.split('T')[0];
            }
        } else {
            // MULTI / MONTHLY / LESSON: Deferred activation
            // valid_from = NULL, valid_until = NULL → sẽ được kích hoạt khi check-in lần đầu
            validFrom = null;
            validUntil = null;

            // For private lessons with specific duration entered by staff
            const isPrivateLesson = ticketType.category === 'LESSON' && ((ticketType as any).lesson_class_type === 'ONE_ON_ONE' || (ticketType as any).lesson_class_type === 'ONE_ON_TWO');
            if (isPrivateLesson && !privateUnlimited && privateDurationVal) {
                // Store duration info on the ticket_type temporarily — but actually we need
                // to pass it directly since the ticket type doesn't have this info for private lessons.
                // The deferred activation in checkin function will use the ticket_type's duration_unit/duration_months/validity_days.
                // For private lessons, we need to set valid_from and valid_until at sell time if they have a custom duration.
                // Actually, since deferred activation calculates valid_until from ticket_type fields,
                // and for private lessons those are null, we just set the dates here directly.
                const today = new Date();
                const tzOffset = today.getTimezoneOffset() * 60000;
                const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, -1);
                validFrom = localISOTime.split('T')[0];
                if (privateDurationUnit === 'months') {
                    const expDate = new Date(today);
                    expDate.setDate(today.getDate() + Math.round(Number(privateDurationVal) * 30));
                    const localISOExp = (new Date(expDate.getTime() - tzOffset)).toISOString().slice(0, -1);
                    validUntil = localISOExp.split('T')[0];
                } else {
                    const expDate = new Date(today);
                    expDate.setDate(today.getDate() + Number(privateDurationVal));
                    const localISOExp = (new Date(expDate.getTime() - tzOffset)).toISOString().slice(0, -1);
                    validUntil = localISOExp.split('T')[0];
                }
            }
        }

        // Calculate Promo impacts
        let finalPrice = ticketType.price;
        let finalSessions = ticketType.session_count || null;

        // For private lessons (1:1 / 1:2): price = unit price × sessions entered by staff
        const isPrivateLesson = ticketType.category === 'LESSON' && ((ticketType as any).lesson_class_type === 'ONE_ON_ONE' || (ticketType as any).lesson_class_type === 'ONE_ON_TWO');
        if (isPrivateLesson && privateSessions) {
            finalSessions = Number(privateSessions);

            // Calculate age-based price if tiers exist
            let unitPrice1 = ticketType.price;
            let unitPrice2 = 0;

            if (ticketType.age_price_tiers && ticketType.age_price_tiers.length > 0) {
                const currentYear = new Date().getFullYear();

                // Student 1
                if (privateBirthYear) {
                    const age1 = currentYear - Number(privateBirthYear);
                    const tier1 = ticketType.age_price_tiers.find(tier => age1 >= tier.minAge && age1 <= tier.maxAge);
                    if (tier1) unitPrice1 = tier1.price;
                }

                // Student 2 (only for ONE_ON_TWO)
                if ((ticketType as any).lesson_class_type === 'ONE_ON_TWO' && privateBirthYear2) {
                    unitPrice2 = ticketType.price; // default to base price
                    const age2 = currentYear - Number(privateBirthYear2);
                    const tier2 = ticketType.age_price_tiers.find(tier => age2 >= tier.minAge && age2 <= tier.maxAge);
                    if (tier2) unitPrice2 = tier2.price;
                }
            } else if ((ticketType as any).lesson_class_type === 'ONE_ON_TWO') {
                // If there are no age tiers but it's 1:2, the price should be 2x the base price
                unitPrice2 = ticketType.price;
            }

            const totalUnitPrice = unitPrice1 + unitPrice2;
            finalPrice = Math.round(totalUnitPrice * finalSessions);
        }

        if (promoId) {
            const promo = promotions.find(p => p.id === promoId);
            if (promo) {
                if (promo.type === 'AMOUNT') {
                    finalPrice = Math.max(0, finalPrice - promo.value);
                } else if (promo.type === 'PERCENT') {
                    finalPrice = Math.floor(finalPrice * (1 - promo.value / 100));
                } else if (promo.type === 'BONUS_SESSION' && finalSessions !== null) {
                    finalSessions += promo.value;
                }
            }
        }

        const quantity = pendingTicketData?.quantity || 1;
        const payloads = Array.from({ length: quantity }).map(() => ({
            ticket_type_id: ticketType.id,
            status: 'UNUSED',
            customer_name: name,
            customer_phone: phone,
            valid_from: validFrom,
            valid_until: validUntil,
            sold_by: profile?.id,
            price_paid: finalPrice,
            remaining_sessions: finalSessions,
            total_sessions: finalSessions,
            promotion_id: promoId || null,
            card_code: code || null,
            payment_method: paymentMethod,
            customer_birth_year: (isPrivateLesson && privateBirthYear) ? Number(privateBirthYear) : null,
            customer_name_2: (isPrivateLesson && name2) ? name2 : null,
            customer_birth_year_2: (isPrivateLesson && birthYear2) ? Number(birthYear2) : null
        }));

        const { data, error } = await supabase
            .from('tickets')
            .insert(payloads)
            .select();

        if (error) {
            alert('Lỗi bán vé: ' + error.message);
            setSelling(false);
            return;
        }

        // Only show QR print if daily
        if (ticketType.category === 'DAILY') {
            const newSoldTickets = data.map((d: any) => ({
                ...d,
                type_name: ticketType.name,
                pool_close_time: closeTime,
                remaining_sessions: finalSessions,
                payment_method: paymentMethod as 'CASH' | 'TRANSFER' | 'CARD'
            }));
            setSoldTickets(newSoldTickets);
        } else {
            // For LESSON/MULTI/MONTHLY: show note about deferred activation
            const isDeferred = !validFrom;
            printReceipt({
                ticketName: ticketType.name,
                customerName: name || 'Khách hàng',
                customerPhone: phone,
                cardCode: code,
                pricePaid: finalPrice,
                originalPrice: ticketType.price,
                sessions: finalSessions,
                validFrom: isDeferred ? null : validFrom,
                validUntil: isDeferred ? null : validUntil,
                soldAt: new Date().toLocaleString('vi-VN'),
                promoName: promoId ? promotions.find(p => p.id === promoId)?.name || null : null,
                paymentMethod: paymentMethod,
                isDeferred: isDeferred,
                lessonClassType: (ticketType as any).lesson_class_type || null,
                customerBirthYear: (isPrivateLesson && privateBirthYear) ? Number(privateBirthYear) : null
            });
            alert('✅ Thu tiền và lưu thẻ thành công!\nPhiếu thu đang được in...');
        }

        setSelling(false);
        setSelectedAdvancedType(null); // Close modal
        setShowPaymentModal(false);
    }

    function handleAdvancedSubmit(e: React.FormEvent) {
        e.preventDefault();
        if (!selectedAdvancedType) return;

        if (selectedAdvancedType.category !== 'DAILY' && !cardCode.trim()) {
            alert('Vui lòng nhập Mã thẻ nhựa!');
            return;
        }

        if (selectedAdvancedType.category !== 'DAILY' && !customerPhone.trim()) {
            alert('Vui lòng nhập Số điện thoại khách hàng!');
            return;
        }

        // Validate age for 1:1 and 1:2 private lessons
        const isPrivateLesson = selectedAdvancedType.category === 'LESSON' &&
            ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_ONE' || (selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO');

        if (isPrivateLesson) {
            if (!privateBirthYear) {
                alert('Vui lòng nhập năm sinh học viên' + ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' ? ' 1!' : '!'));
                return;
            }

            if ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO') {
                if (!customerName2.trim()) {
                    alert('Vui lòng nhập tên học viên 2!');
                    return;
                }
                if (!privateBirthYear2) {
                    alert('Vui lòng nhập năm sinh học viên 2!');
                    return;
                }
            }

            if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                const currentYear = new Date().getFullYear();
                const age1 = currentYear - Number(privateBirthYear);
                const isAge1Valid = selectedAdvancedType.age_price_tiers.some(tier => age1 >= tier.minAge && age1 <= tier.maxAge);

                if (!isAge1Valid) {
                    alert('Học viên 1 không thỏa điều kiện tuổi học bơi');
                    return;
                }

                if ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO') {
                    const age2 = currentYear - Number(privateBirthYear2);
                    const isAge2Valid = selectedAdvancedType.age_price_tiers.some(tier => age2 >= tier.minAge && age2 <= tier.maxAge);
                    if (!isAge2Valid) {
                        alert('Học viên 2 không thỏa điều kiện tuổi học bơi');
                        return;
                    }
                }
            }
        }

        // Prepare data and show payment modal instead of selling directly
        setPendingTicketData({
            ticketType: selectedAdvancedType,
            name: customerName || null,
            phone: customerPhone || null,
            promoId: selectedPromoId || null,
            code: cardCode.trim() || null,
            quantity: 1,
            name2: (selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' ? customerName2 : null,
            birthYear2: (selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' ? Number(privateBirthYear2) : null
        } as any);
        setSelectedPaymentMethod('CASH');
        setShowPaymentModal(true);
    }

    function handleDailySaleClick(ticketType: TicketType) {
        setPendingTicketData({
            ticketType: ticketType,
            name: null,
            phone: null,
            promoId: null,
            code: null,
            quantity: dailyQuantities[ticketType.id] || 1
        });
        setSelectedPaymentMethod('CASH');
        setShowPaymentModal(true);
    }

    function handlePrint() {
        if (!printRef.current) return;
        const printContent = printRef.current.innerHTML;
        const win = window.open('', '_blank', 'width=1024,height=768,scrollbars=yes,resizable=no');
        if (!win) return;
        win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>In Vé</title>
        <style>
          @media print {
            @page { margin: 0; }
            body { 
              width: 100% !important; 
              margin: 0 !important; 
              padding: 4mm !important; 
            }
          }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Times New Roman', Times, serif;
            width: 100%;
            max-width: 320px;
            margin: 0 auto;
            padding: 16px;
            font-size: 15px; /* Tăng size chữ lên một chút cho dễ đọc */
            color: #000;
            background: #fff;
          }
          .ticket-print {
            text-align: center;
            page-break-after: always;
            border-bottom: 2px dashed #000;
            padding-bottom: 24px;
            margin-bottom: 24px;
            width: 100%;
          }
          .ticket-print:last-child {
            page-break-after: auto;
            border-bottom: none;
            padding-bottom: 0;
            margin-bottom: 0;
          }
          .ticket-print h2 { font-size: 22px; margin-bottom: 6px; text-transform: uppercase; }
          .ticket-print .subtitle { color: #444; font-size: 12px; margin-bottom: 12px; font-weight: bold; }
          .ticket-print .qr-wrapper { margin: 16px 0; text-align: center; }
          .ticket-print .qr-wrapper svg { width: 180px; height: 180px; margin: 0 auto; display: block; }
          .ticket-print .info-row {
            display: flex;
            justify-content: space-between;
            padding: 4px 0;
            border-bottom: 1px dotted #ccc;
            font-size: 12px;
          }
          .ticket-print .info-row .label { color: #666; }
          .ticket-print .info-row .value { font-weight: 700; }
          .ticket-print .footer {
            margin-top: 10px;
            font-size: 10px;
            color: #999;
          }
        </style>
      </head>
      <body>
        ${printContent}
        <script>setTimeout(function(){window.print();},500);<\/script>
      </body>
      </html>
    `);
        win.document.close();
    }

    // --- In Phiếu Thu Tiền (Khổ K80) ---
    interface ReceiptInfo {
        ticketName: string;
        customerName: string;
        customerPhone: string | null;
        cardCode: string | null;
        pricePaid: number;
        originalPrice: number;
        sessions: number | null;
        validFrom: string | null;
        validUntil: string | null;
        soldAt: string;
        promoName: string | null;
        paymentMethod: 'CASH' | 'TRANSFER' | 'CARD';
        isDeferred?: boolean;
        lessonClassType?: string | null;
        customerBirthYear?: number | null;
    }

    function printReceipt(info: ReceiptInfo) {
        const win = window.open('', '_blank', 'width=800,height=800');
        if (!win) return;

        const hasDiscount = info.pricePaid < info.originalPrice;

        win.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <title>Phiếu Thu Tiền</title>
        <style>
          @page { size: 80mm auto; margin: 0; }
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: 'Times New Roman', Times, serif;
            width: 72mm;
            padding: 4mm;
            margin: 0 auto;
            font-size: 12px;
          }
          .receipt { text-align: center; }
          .receipt h2 { font-size: 16px; margin-bottom: 2px; }
          .receipt .subtitle { font-size: 10px; color: #666; margin-bottom: 12px; }
          .divider { border-top: 1px dashed #333; margin: 8px 0; }
          .row { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
          .row .lbl { color: #555; }
          .row .val { font-weight: 700; text-align: right; }
          .total-row { display: flex; justify-content: space-between; padding: 6px 0; font-size: 15px; font-weight: 900; border-top: 2px solid #000; margin-top: 6px; }
          .footer { margin-top: 12px; font-size: 9px; color: #999; text-align: center; }
        </style>
      </head>
      <body>
        <div class="receipt">
          ${bizInfo.business_logo ? `<img src="${bizInfo.business_logo}" style="max-height: 40px; margin-bottom: 4px;" />` : ''}
          <h2 style="font-size: 14px; text-transform: uppercase;">${bizInfo.business_name || 'Hệ Thống Vé Bơi'}</h2>
          ${bizInfo.business_address ? `<p class="subtitle" style="margin-bottom: 2px;">Đ/c: ${bizInfo.business_address}</p>` : ''}
          ${bizInfo.business_phone ? `<p class="subtitle" style="margin-bottom: 8px;">SĐT: ${bizInfo.business_phone}</p>` : ''}
          <div class="divider" style="margin-top:0"></div>
          <h2 style="margin-top: 8px;">🏊 PHIẾU THU TIỀN</h2>
          <div class="divider"></div>

          <div class="row"><span class="lbl">Khách hàng:</span><span class="val">${info.customerName}</span></div>
          ${info.customerPhone ? `<div class="row"><span class="lbl">SĐT:</span><span class="val">${info.customerPhone}</span></div>` : ''}
          ${info.customerBirthYear ? `<div class="row"><span class="lbl">Năm sinh:</span><span class="val">${info.customerBirthYear} (${new Date().getFullYear() - info.customerBirthYear} tuổi)</span></div>` : ''}
          ${info.cardCode ? `<div class="row"><span class="lbl">Mã thẻ:</span><span class="val">${info.cardCode}</span></div>` : ''}

          <div class="divider"></div>

          <div class="row"><span class="lbl">Loại vé:</span><span class="val">${info.ticketName}</span></div>
          ${info.sessions !== null ? `<div class="row"><span class="lbl">Số lượt bơi:</span><span class="val">${info.sessions} lượt</span></div>` : '<div class="row"><span class="lbl">Số lượt:</span><span class="val">Không giới hạn</span></div>'}
          ${info.isDeferred ? '<div class="row"><span class="lbl">Hiệu lực:</span><span class="val" style="color:#f59e0b;">Kích hoạt khi check-in lần đầu</span></div>' : (info.validFrom ? (info.validFrom === info.validUntil ? `<div class="row"><span class="lbl">Hiệu lực:</span><span class="val">Trong ngày</span></div>` : `<div class="row"><span class="lbl">Hiệu lực:</span><span class="val">${info.validFrom} → ${info.validUntil}</span></div>`) : '')}
          ${info.lessonClassType ? `<div class="row"><span class="lbl">Loại lớp:</span><span class="val">${info.lessonClassType === 'GROUP' ? 'Lớp nhóm' : info.lessonClassType === 'ONE_ON_ONE' ? '1 kèm 1' : '1 kèm 2'}</span></div>` : ''}

          <div class="divider"></div>

          ${hasDiscount ? `
            <div class="row"><span class="lbl">Giá gốc:</span><span class="val" style="text-decoration:line-through;color:#999">${info.originalPrice.toLocaleString('vi-VN')}đ</span></div>
            ${info.promoName ? `<div class="row"><span class="lbl">KM:</span><span class="val" style="color:green">${info.promoName}</span></div>` : ''}
          ` : ''}

          <div class="total-row">
            <span>THÀNH TIỀN:</span>
            <span>${info.pricePaid.toLocaleString('vi-VN')}đ</span>
          </div>

          <div class="divider"></div>
          <div class="row"><span class="lbl">HT Thanh toán:</span><span class="val">${info.paymentMethod === 'CASH' ? 'Tiền mặt' : info.paymentMethod === 'TRANSFER' ? 'Chuyển khoản' : 'Quẹt thẻ'}</span></div>
          <div class="row"><span class="lbl">Thời gian:</span><span class="val">${info.soldAt}</span></div>

          ${info.paymentMethod === 'TRANSFER' && bizInfo.bank_account_number && bizInfo.bank_name ? `
            <div class="divider"></div>
            <div style="text-align:center; margin-top: 8px;">
              <p style="font-size:10px; font-weight:700; margin-bottom: 4px;">Quét mã QR để thanh toán</p>
              <img src="https://img.vietqr.io/image/${bizInfo.bank_name}-${bizInfo.bank_account_number}-compact2.png?amount=${info.pricePaid}&addInfo=VeBoi${info.ticketName.replace(/\s/g, '')}&accountName=${bizInfo.bank_account_name || ''}" style="width: 100%; max-width: 120px;" />
              <p style="font-size:10px; margin-top: 4px;">Ngân hàng: <b>${bizInfo.bank_name}</b></p>
              <p style="font-size:10px;">STK: <b>${bizInfo.bank_account_number}</b></p>
              ${bizInfo.bank_account_name ? `<p style="font-size:10px;">Chủ TK: <b>${bizInfo.bank_account_name}</b></p>` : ''}
            </div>
          ` : ''}

          <p class="footer">Cảm ơn quý khách!<br/>Vui lòng giữ phiếu thu để đối chiếu khi cần.</p>
        </div>
        <script>setTimeout(function(){window.print();}, 1500);<\/script>
      </body>
      </html>
    `);
        win.document.close();
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
            p_confirm_new_package: confirmNewPackage
        };
        if (selectedTicketId) {
            payload.p_selected_ticket_id = selectedTicketId;
        }

        const { data, error } = await supabase.rpc('checkin_pass_and_issue_ticket', payload);

        if (error) {
            setCheckinError(error.message);
            speakMessage('Lỗi hệ thống');
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
            speakMessage('Gói hiện tại đã hết buổi');
            const info = data.new_package_info;
            const catLabel = info.category === 'LESSON' ? 'Gói học bơi' : 'Gói bơi';
            const confirmed = window.confirm(
                `⚠️ GÓI HIỆN TẠI ĐÃ HẾT BUỔI!\n\n` +
                `Tìm thấy gói mới chưa kích hoạt:\n` +
                `• Khách: ${info.customer_name || 'N/A'}\n` +
                `• Loại: ${catLabel} — ${info.type_name}\n` +
                `• Số buổi: ${info.total_sessions || info.remaining_sessions || 'Không giới hạn'}\n\n` +
                `Bấm OK để KÍCH HOẠT GÓI MỚI và trừ 1 buổi.\n` +
                `Bấm Hủy để KHÔNG kích hoạt.`
            );

            if (confirmed) {
                // Gọi lại với confirm = true
                await doCheckin(passId, true);
            }
            return;
        }

        if (!data.success) {
            setCheckinError(data.message);
            if (data.message.includes('đóng cửa')) speakMessage('Hồ bơi đang đóng cửa');
            else if (data.message.includes('Chưa đến giờ') || data.message.includes('quá giờ')) speakMessage('Chưa đến giờ mở cửa');
            else if (data.message.includes('Hết hạn')) speakMessage('Thẻ đã hết hạn');
            else if (data.message.includes('Hết lượt')) speakMessage('Thẻ đã hết lượt bơi');
            else speakMessage('Vé không hợp lệ');
            return;
        }

        // --- Success ---
        const passCategory = data.pass_status.category || '';
        const remainLabel = passCategory === 'LESSON' ? 'buổi học' : 'buổi bơi';
        const newPkgNote = data.is_new_package ? '\n🆕 Đã kích hoạt GÓI MỚI!' : '';
        alert(`✅ ${data.message}\n` + (data.pass_status.remaining_sessions !== null ? `Còn lại: ${data.pass_status.remaining_sessions} ${remainLabel}.` : 'Không giới hạn lượt.') + newPkgNote);
        speakMessage('Xin mời vào');

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
        await doCheckin(checkinCode.trim());
        setCheckingIn(false);
    }

    async function handleSelectPackage(ticketId: string) {
        setShowPackageSelectModal(false);
        setCheckingIn(true);
        await doCheckin(pendingCheckinCode, false, ticketId);
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

    // Lesson schedule data
    const [lessonSchedulesMap, setLessonSchedulesMap] = useState<Record<string, any[]>>({});
    useEffect(() => {
        (async () => {
            const { data } = await supabase.from('lesson_schedules').select('*');
            if (data) {
                const map: Record<string, any[]> = {};
                data.forEach((s: any) => {
                    if (!map[s.ticket_type_id]) map[s.ticket_type_id] = [];
                    map[s.ticket_type_id].push(s);
                });
                setLessonSchedulesMap(map);
            }
        })();
    }, [ticketTypes]);

    const dayNamesShort: Record<number, string> = { 0: 'CN', 1: 'T2', 2: 'T3', 3: 'T4', 4: 'T5', 5: 'T6', 6: 'T7' };

    if (loading) return <div className="page-loading">Đang tải...</div>;

    const renderTicketButton = (t: TicketType) => {
        const isDaily = t.category === 'DAILY';
        const colors = isDaily
            ? ['#3b82f6', '#6366f1', '#dbeafe', '#3b82f6']  // blue
            : ['#8b5cf6', '#a855f7', '#ede9fe', '#7c3aed']; // purple
        const icons = isDaily ? '🎫' : (t.category === 'MONTHLY' ? '📅' : '🔢');
        return (
            <button key={t.id} onClick={() => isDaily ? handleDailySaleClick(t) : sellTicket(t)} disabled={selling}
                style={{
                    background: '#fff', border: 'none', borderRadius: '14px', padding: 0,
                    cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.2s ease',
                    transform: 'translateY(0)',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${colors[0]}30`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}>
                {/* Top accent */}
                <div style={{ height: '4px', background: `linear-gradient(90deg, ${colors[0]}, ${colors[1]})` }} />
                <div style={{ padding: '18px 20px', paddingBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '28px' }}>{icons}</span>
                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1d27' }}>{t.name}</div>
                            {t.description && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.description}</div>}
                        </div>
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: 800, background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '8px' }}>
                        {t.price.toLocaleString('vi-VN')} đ
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: isDaily ? '12px' : '0' }}>
                        <span style={{ background: colors[2], color: colors[3], padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                            {t.validity_days ? `⏱ ${t.validity_days} ngày` : '⏱ Trong ngày'}
                        </span>
                        <span style={{ background: colors[2], color: colors[3], padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                            {t.session_count ? `🏊 ${t.session_count} lượt` : '🏊 Không giới hạn'}
                        </span>
                    </div>

                    {isDaily && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--bg-hover)', borderRadius: '8px', padding: '4px', marginTop: '12px' }} onClick={e => e.stopPropagation()}>
                            <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: '4px 0', fontSize: '18px', fontWeight: 'bold' }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDailyQuantities(prev => ({
                                        ...prev,
                                        [t.id]: Math.max(1, (prev[t.id] || 1) - 1)
                                    }));
                                }}>−</button>
                            <div style={{ fontSize: '16px', fontWeight: 600, width: '40px', textAlign: 'center' }}>
                                {dailyQuantities[t.id] || 1}
                            </div>
                            <button className="btn btn-ghost btn-sm" style={{ flex: 1, padding: '4px 0', fontSize: '18px', fontWeight: 'bold' }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDailyQuantities(prev => ({
                                        ...prev,
                                        [t.id]: Math.min(50, (prev[t.id] || 1) + 1)
                                    }));
                                }}>+</button>
                        </div>
                    )}
                </div>
            </button>
        );
    };

    const renderLessonButton = (t: TicketType) => {
        const colors = ['#10b981', '#059669', '#d1fae5', '#047857']; // green
        const classLabel = (t as any).lesson_class_type === 'GROUP' ? '👥 Nhóm' : (t as any).lesson_class_type === 'ONE_ON_ONE' ? '🧑‍🏫 1:1' : '🧑‍🏫 1:2';
        const scheds = lessonSchedulesMap[t.id] || [];
        const schedText = (t as any).lesson_schedule_type === 'FIXED' && scheds.length > 0
            ? scheds.map((s: any) => `${dayNamesShort[s.day_of_week]} ${s.start_time?.substring(0, 5)}`).join(', ')
            : 'Lịch tự do';
        const durationText = (t as any).lesson_class_type === 'GROUP'
            ? ((t as any).duration_unit === 'months' ? `${(t as any).duration_months} tháng` : (t as any).duration_unit === 'days' ? `${t.validity_days} ngày` : '')
            : 'Tự chọn khi ĐK';
        const isPrivate = (t as any).lesson_class_type === 'ONE_ON_ONE' || (t as any).lesson_class_type === 'ONE_ON_TWO';
        return (
            <button key={t.id} onClick={() => sellTicket(t)} disabled={selling}
                style={{
                    background: '#fff', border: 'none', borderRadius: '14px', padding: 0,
                    cursor: 'pointer', textAlign: 'left', overflow: 'hidden',
                    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', transition: 'all 0.2s ease',
                    transform: 'translateY(0)',
                }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${colors[0]}30`; }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 12px rgba(0,0,0,0.08)'; }}>
                <div style={{ height: '4px', background: `linear-gradient(90deg, ${colors[0]}, ${colors[1]})` }} />
                <div style={{ padding: '18px 20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                        <span style={{ fontSize: '28px' }}>📚</span>
                        <div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1a1d27' }}>{t.name}</div>
                            {t.description && <div style={{ fontSize: '12px', color: '#64748b' }}>{t.description}</div>}
                        </div>
                    </div>
                    <div style={{ fontSize: '26px', fontWeight: 800, background: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', marginBottom: '8px' }}>
                        {t.price.toLocaleString('vi-VN')} đ{isPrivate ? ' / buổi' : ''}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                        <span style={{ background: colors[2], color: colors[3], padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                            {classLabel}
                        </span>
                        <span style={{ background: colors[2], color: colors[3], padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                            🏊 {isPrivate ? 'Tự chọn số buổi' : `${t.session_count} buổi`}
                        </span>
                        {durationText && <span style={{ background: colors[2], color: colors[3], padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600 }}>
                            ⏱ {durationText}
                        </span>}
                    </div>
                    <div style={{ marginTop: '8px', fontSize: '11px', color: '#64748b' }}>
                        📅 {schedText}
                    </div>
                </div>
            </button>
        );
    };

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

                                <div><strong>{ticket.pass_category === 'LESSON' ? 'Học viên:' : 'Khách hàng:'}</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                <div><strong>Hiệu lực:</strong> {ticket.valid_from === ticket.valid_until ? 'Trong ngày' : `${ticket.valid_from} → ${ticket.valid_until}`}</div>

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
                                    <span className="value">Hôm nay, {ticket.pool_close_time}</span>
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
                                </p>
                            </div>
                        ))}
                    </div>

                    <div className="sold-ticket-actions">
                        <button className="btn btn-primary" onClick={handlePrint}>
                            🖨️ In Vé
                        </button>
                        <button className="btn btn-secondary" onClick={() => setSoldTickets([])}>
                            ← Bán vé tiếp
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ maxWidth: '1000px' }}>
            <div className="page-header flex-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    <h1>{activeTab === 'SELL' ? '🎫 Bán Vé' : '📸 Check-in Thẻ'}</h1>
                    <p>{activeTab === 'SELL' ? 'Chọn loại vé để bán cho khách' : 'Quét mã Thẻ của khách để in vé lượt'}</p>
                </div>
                <div style={{ display: 'flex', gap: '8px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '12px' }}>
                    <button className={`btn ${activeTab === 'SELL' ? 'btn-primary' : 'btn-ghost'}`} style={{ border: 'none', margin: 0, padding: '8px 16px' }} onClick={() => setActiveTab('SELL')}>Bán Vé Mới</button>
                    <button className={`btn ${activeTab === 'CHECKIN' ? 'btn-primary' : 'btn-ghost'}`} style={{ border: 'none', margin: 0, padding: '8px 16px' }} onClick={() => setActiveTab('CHECKIN')}>Quẹt Thẻ Gói</button>
                </div>
            </div>

            {activeTab === 'SELL' && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '24px', animation: 'fadeIn 0.3s ease' }}>
                    {/* COL 1 — Vé Lượt */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                            <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: 'linear-gradient(180deg, #3b82f6, #6366f1)' }} />
                            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1d27' }}>Vé Lượt</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {dailyTypes.length > 0 ? dailyTypes.map(renderTicketButton) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Chưa có vé lượt nào đang mở bán.</p>}
                        </div>
                    </div>

                    {/* COL 2 — Vé Nhiều Buổi / Vé Tháng */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                            <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: 'linear-gradient(180deg, #8b5cf6, #a855f7)' }} />
                            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1d27' }}>Vé Nhiều Buổi / Vé Tháng</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {advancedTypes.length > 0 ? advancedTypes.map(renderTicketButton) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Chưa có loại vé đặc biệt nào.</p>}
                        </div>
                    </div>

                    {/* COL 3 — Gói Khóa Học Bơi */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                            <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: 'linear-gradient(180deg, #10b981, #059669)' }} />
                            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1d27' }}>📚 Gói Khóa Học Bơi</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {lessonTypes.length > 0 ? lessonTypes.map(renderLessonButton) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Chưa có gói khóa học nào.</p>}
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
                                onChange={e => setCheckinCode(e.target.value)}
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
                                        if (p?.type === 'PERCENT') curr = Math.floor(curr * (1 - p.value / 100));
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
                                    {/* Toggle Khách mới / Khách cũ */}
                                    <div style={{ display: 'flex', gap: '4px', marginBottom: '14px', background: 'var(--bg-hover)', padding: '4px', borderRadius: '8px' }}>
                                        <button type="button" className={`btn ${customerMode === 'NEW' ? 'btn-primary' : 'btn-ghost'}`}
                                            style={{ flex: 1, margin: 0, padding: '8px', fontSize: '13px' }}
                                            onClick={() => { setCustomerMode('NEW'); setCustomerName(''); setCustomerPhone(''); setCardCode(''); setCustSearchResults([]); }}>
                                            👤 Khách mới
                                        </button>
                                        <button type="button" className={`btn ${customerMode === 'EXISTING' ? 'btn-primary' : 'btn-ghost'}`}
                                            style={{ flex: 1, margin: 0, padding: '8px', fontSize: '13px' }}
                                            onClick={() => setCustomerMode('EXISTING')}>
                                            🔍 Khách cũ
                                        </button>
                                    </div>

                                    {customerMode === 'EXISTING' && (
                                        <div className="form-group" style={{ marginBottom: '12px' }}>
                                            <label>Tìm khách hàng</label>
                                            <input type="text" placeholder="Nhập mã thẻ, SĐT hoặc tên khách..."
                                                value={custSearchTerm}
                                                onChange={async (e) => {
                                                    const term = e.target.value;
                                                    setCustSearchTerm(term);
                                                    if (term.length < 2) { setCustSearchResults([]); return; }
                                                    setSearchingCust(true);
                                                    const { data } = await supabase
                                                        .from('tickets')
                                                        .select('customer_name, customer_phone, customer_birth_year, card_code, ticket_types!inner(category)')
                                                        .or(`card_code.ilike.%${term}%,customer_phone.ilike.%${term}%,customer_name.ilike.%${term}%`)
                                                        .in('ticket_types.category', ['MONTHLY', 'MULTI', 'LESSON'])
                                                        .limit(20);
                                                    // Deduplicate by phone
                                                    const seen = new Set<string>();
                                                    const unique = (data || []).filter((d: any) => {
                                                        const key = d.customer_phone || d.card_code;
                                                        if (!key || seen.has(key)) return false;
                                                        seen.add(key);
                                                        return true;
                                                    }).map((d: any) => ({
                                                        name: d.customer_name || '',
                                                        phone: d.customer_phone || '',
                                                        card_code: d.card_code || '',
                                                        birth_year: d.customer_birth_year || null
                                                    }));
                                                    setCustSearchResults(unique);
                                                    setSearchingCust(false);
                                                }}
                                                style={{ fontSize: '14px' }}
                                            />
                                            {searchingCust && <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>Đang tìm...</span>}
                                            {custSearchResults.length > 0 && (
                                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', marginTop: '6px', maxHeight: '150px', overflowY: 'auto' }}>
                                                    {custSearchResults.map((c, i) => (
                                                        <div key={i} onClick={() => {
                                                            setCustomerName(c.name);
                                                            setCustomerPhone(c.phone);
                                                            setCardCode(c.card_code);
                                                            if (c.birth_year) setPrivateBirthYear(c.birth_year);
                                                            setCustSearchResults([]);
                                                            setCustSearchTerm('');
                                                        }} style={{
                                                            padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border-color)',
                                                            fontSize: '13px', transition: 'background 0.15s'
                                                        }}
                                                            onMouseEnter={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                                                            onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                                            <strong>{c.name || 'N/A'}</strong>
                                                            <span style={{ marginLeft: '8px', color: 'var(--text-secondary)' }}>📞 {c.phone || '—'}</span>
                                                            <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontSize: '11px' }}>🏷️ {c.card_code || '—'}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    <div className="form-group">
                                        <label>Mã Thẻ (Quét bằng máy hoặc nhập tay) <span style={{ color: 'red' }}>*</span></label>
                                        <input type="text" required
                                            placeholder="Quét mã vạch trên thẻ vào đây"
                                            value={cardCode}
                                            onChange={e => setCardCode(e.target.value)}
                                            style={{ backgroundColor: '#fff', fontSize: '16px', fontWeight: 'bold' }}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Họ và Tên khách</label>
                                        <input type="text"
                                            placeholder="Nhập tên khách hàng"
                                            value={customerName}
                                            onChange={e => setCustomerName(e.target.value)}
                                        />
                                    </div>
                                    <div className="form-group">
                                        <label>Số điện thoại <span style={{ color: 'red' }}>*</span></label>
                                        <input type="tel" required
                                            placeholder="Nhập SĐT khách hàng"
                                            value={customerPhone}
                                            onChange={e => setCustomerPhone(e.target.value)}
                                        />
                                    </div>
                                </>
                            )}

                            {selectedAdvancedType.category === 'LESSON' && ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_ONE' || (selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO') && (
                                <div style={{ background: '#f0fdf4', padding: '16px', borderRadius: '8px', marginBottom: '16px', border: '1px solid #bbf7d0' }}>
                                    <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '12px', color: '#166534' }}>
                                        🧑‍🏫 Thông tin đăng ký lớp {(selectedAdvancedType as any).lesson_class_type === 'ONE_ON_ONE' ? '1:1' : '1:2'}
                                    </div>
                                    <div className="form-group" style={{ marginBottom: '12px' }}>
                                        <label>Năm sinh học viên {(selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' ? '1 ' : ''}<span style={{ color: 'red' }}>*</span></label>
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

                                    {(selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' && (
                                        <>
                                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                                <label>Họ và Tên học viên 2 <span style={{ color: 'red' }}>*</span></label>
                                                <input type="text" required
                                                    value={customerName2}
                                                    onChange={e => setCustomerName2(e.target.value)}
                                                    placeholder="Nhập tên học viên 2"
                                                    style={{ fontSize: '15px' }}
                                                />
                                            </div>
                                            <div className="form-group" style={{ marginBottom: '12px' }}>
                                                <label>Năm sinh học viên 2 <span style={{ color: 'red' }}>*</span></label>
                                                <input type="number" min="1900" max={new Date().getFullYear()} required
                                                    value={privateBirthYear2}
                                                    onChange={e => setPrivateBirthYear2(e.target.value ? Number(e.target.value) : '')}
                                                    placeholder="Nhập năm sinh (VD: 2010)"
                                                    style={{ fontSize: '15px' }}
                                                />
                                                {privateBirthYear2 && (
                                                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                        Độ tuổi: <strong>{new Date().getFullYear() - Number(privateBirthYear2)} tuổi</strong>
                                                    </div>
                                                )}
                                            </div>
                                        </>
                                    )}

                                    <div className="form-group" style={{ marginBottom: '12px' }}>
                                        <label>Số buổi học <span style={{ color: 'red' }}>*</span></label>
                                        <input type="number" min="1" required
                                            value={privateSessions}
                                            onChange={e => setPrivateSessions(e.target.value ? Number(e.target.value) : '')}
                                            style={{ fontSize: '16px', fontWeight: 'bold' }}
                                        />
                                        {(() => {
                                            let unitPrice1 = selectedAdvancedType.price;
                                            let unitPrice2 = 0;

                                            if (selectedAdvancedType.age_price_tiers && selectedAdvancedType.age_price_tiers.length > 0) {
                                                const currentYear = new Date().getFullYear();

                                                // Student 1
                                                if (privateBirthYear) {
                                                    const age1 = currentYear - Number(privateBirthYear);
                                                    const tier1 = selectedAdvancedType.age_price_tiers.find(t => age1 >= t.minAge && age1 <= t.maxAge);
                                                    if (tier1) unitPrice1 = tier1.price;
                                                }

                                                // Student 2
                                                if ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO' && privateBirthYear2) {
                                                    unitPrice2 = selectedAdvancedType.price;
                                                    const age2 = currentYear - Number(privateBirthYear2);
                                                    const tier2 = selectedAdvancedType.age_price_tiers.find(t => age2 >= t.minAge && age2 <= t.maxAge);
                                                    if (tier2) unitPrice2 = tier2.price;
                                                }
                                            } else if ((selectedAdvancedType as any).lesson_class_type === 'ONE_ON_TWO') {
                                                unitPrice2 = selectedAdvancedType.price;
                                            }

                                            const totalUnitPrice = unitPrice1 + unitPrice2;
                                            const totalPrice = Math.round(Number(privateSessions || 0) * totalUnitPrice);

                                            return (
                                                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>
                                                    Tổng tiền: <strong style={{ color: 'var(--accent-green)' }}>{totalPrice.toLocaleString('vi-VN')}đ</strong> ({privateSessions || 0} buổi × {Math.round(totalUnitPrice).toLocaleString('vi-VN')}đ/buổi)
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
                            )}


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
                                    {selling ? 'Đang xử lý...' : (selectedAdvancedType.category === 'DAILY' ? 'Thu tiền & In vé' : 'Thu tiền')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {/* MODAL THANH TOÁN */}
            {showPaymentModal && pendingTicketData && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
                    onClick={() => setShowPaymentModal(false)}>
                    <div style={{ background: 'var(--bg-card)', borderRadius: '16px', padding: '24px', maxWidth: '400px', width: '90%', boxShadow: 'var(--shadow-lg)' }}
                        onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '18px' }}>💳 Chọn hình thức thanh toán</h2>
                            <button onClick={() => setShowPaymentModal(false)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: 'var(--text-secondary)' }}>&times;</button>
                        </div>

                        {(() => {
                            let actualPrice = pendingTicketData.ticketType.price;
                            if (pendingTicketData.promoId) {
                                const promo = promotions.find(p => p.id === pendingTicketData.promoId);
                                if (promo) {
                                    if (promo.type === 'AMOUNT') actualPrice = Math.max(0, actualPrice - promo.value);
                                    if (promo.type === 'PERCENT') actualPrice = Math.floor(actualPrice * (1 - promo.value / 100));
                                }
                            }
                            const isFreeTicket = actualPrice === 0;

                            return (
                                <>
                                    {!isFreeTicket ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
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
                                                    <div style={{ marginTop: '8px', color: '#64748b', fontStyle: 'italic' }}>
                                                        (Vui lòng kiểm tra màn hình chuyển khoản của khách)
                                                    </div>
                                                </div>
                                            )}

                                            <label style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', border: '1px solid var(--border-color)', borderRadius: '8px', cursor: 'pointer', background: selectedPaymentMethod === 'CARD' ? 'var(--bg-hover)' : 'transparent' }}>
                                                <input type="radio" name="payment" value="CARD" checked={selectedPaymentMethod === 'CARD'} onChange={() => setSelectedPaymentMethod('CARD')} />
                                                <span style={{ fontSize: '16px', fontWeight: 500 }}>💳 Quẹt thẻ (POS)</span>
                                            </label>
                                        </div>
                                    ) : (
                                        <div style={{ marginBottom: '24px', textAlign: 'center', color: 'var(--accent-green)' }}>
                                            <p style={{ fontSize: '16px', fontWeight: 600 }}>Vé miễn phí (0đ)</p>
                                            <p style={{ fontSize: '14px', color: 'var(--text-secondary)' }}>Vui lòng xác nhận để phát hành vé.</p>
                                        </div>
                                    )}

                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowPaymentModal(false)}>Hủy</button>
                                        <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={selling} onClick={() => {
                                            doSellTicket(
                                                pendingTicketData.ticketType,
                                                pendingTicketData.name,
                                                pendingTicketData.phone,
                                                pendingTicketData.promoId,
                                                pendingTicketData.code,
                                                isFreeTicket ? 'CASH' : selectedPaymentMethod,
                                                (pendingTicketData as any).name2,
                                                (pendingTicketData as any).birthYear2
                                            );
                                        }}>
                                            {selling ? 'Đang xử lý...' : (isFreeTicket ? 'PHÁT HÀNH VÉ' : 'THANH TOÁN & IN VÉ')}
                                        </button>
                                    </div >
                                </>
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
        </div >
    );
}
