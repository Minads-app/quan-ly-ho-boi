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
}

interface Promotion {
    id: string;
    name: string;
    type: 'AMOUNT' | 'PERCENT' | 'BONUS_SESSION';
    value: number;
    valid_from: string | null;
    valid_until: string | null;
    applicable_ticket_types: string[] | null;
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
    const [custSearchResults, setCustSearchResults] = useState<{ name: string, phone: string, card_code: string }[]>([]);
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
    }

    async function doSellTicket(
        ticketType: TicketType,
        name: string | null,
        phone: string | null,
        promoId: string | null,
        code: string | null,
        paymentMethod: 'CASH' | 'TRANSFER' | 'CARD'
    ) {
        setSelling(true);
        const closeTime = await getPoolCloseTime();

        // Calculate valid_until based on validity_days constraint from settings
        let validUntil = null;
        let validFrom = null;

        if (ticketType.validity_days) {
            const today = new Date();
            // Lấy Local Date (YYYY-MM-DD) thay vì UTC
            const tzOffset = today.getTimezoneOffset() * 60000; // offset in milliseconds
            const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, -1);
            validFrom = localISOTime.split('T')[0];

            const expDate = new Date(today);
            // Một vé trong ngày (1 ngày) thì expiration date phải là ngày hôm nay.
            const daysToAdd = ticketType.validity_days > 0 ? ticketType.validity_days - 1 : 0;
            expDate.setDate(today.getDate() + daysToAdd);
            const localISOExp = (new Date(expDate.getTime() - tzOffset)).toISOString().slice(0, -1);
            validUntil = localISOExp.split('T')[0];
        }

        // Calculate Promo impacts
        let finalPrice = ticketType.price;
        let finalSessions = ticketType.session_count || null;

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
            payment_method: paymentMethod
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
            // Advanced ticket: Print receipt and show success
            printReceipt({
                ticketName: ticketType.name,
                customerName: name || 'Khách hàng',
                customerPhone: phone,
                cardCode: code,
                pricePaid: finalPrice,
                originalPrice: ticketType.price,
                sessions: finalSessions,
                validFrom: validFrom,
                validUntil: validUntil,
                soldAt: new Date().toLocaleString('vi-VN'),
                promoName: promoId ? promotions.find(p => p.id === promoId)?.name || null : null,
                paymentMethod: paymentMethod
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

        // Prepare data and show payment modal instead of selling directly
        setPendingTicketData({
            ticketType: selectedAdvancedType,
            name: customerName || null,
            phone: customerPhone || null,
            promoId: selectedPromoId || null,
            code: cardCode.trim() || null,
            quantity: 1
        });
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
        const win = window.open('', '_blank', 'width=400,height=700,scrollbars=yes');
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
          ${info.cardCode ? `<div class="row"><span class="lbl">Mã thẻ:</span><span class="val">${info.cardCode}</span></div>` : ''}

          <div class="divider"></div>

          <div class="row"><span class="lbl">Loại vé:</span><span class="val">${info.ticketName}</span></div>
          ${info.sessions !== null ? `<div class="row"><span class="lbl">Số lượt bơi:</span><span class="val">${info.sessions} lượt</span></div>` : '<div class="row"><span class="lbl">Số lượt:</span><span class="val">Không giới hạn</span></div>'}
          ${info.validFrom ? (info.validFrom === info.validUntil ? `<div class="row"><span class="lbl">Hiệu lực:</span><span class="val">Trong ngày</span></div>` : `<div class="row"><span class="lbl">Hiệu lực:</span><span class="val">${info.validFrom} → ${info.validUntil}</span></div>`) : ''}

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
    async function handleCheckinSubmit(e: React.FormEvent) {
        e.preventDefault();
        setCheckinError('');
        if (!checkinCode.trim()) return;

        setCheckingIn(true);
        // Call RPC Check-in
        const { data, error } = await supabase.rpc('checkin_pass_and_issue_ticket', {
            p_pass_id: checkinCode.trim(),
            p_staff_id: profile?.id
        });

        if (error) {
            setCheckinError(error.message);
            speakMessage('Lỗi hệ thống');
        } else if (!data.success) {
            setCheckinError(data.message);
            // Translate common DB error msgs to TTS
            if (data.message.includes('đóng cửa')) speakMessage('Hồ bơi đang đóng cửa');
            else if (data.message.includes('Chưa đến giờ') || data.message.includes('quá giờ')) speakMessage('Chưa đến giờ mở cửa');
            else if (data.message.includes('Hết hạn')) speakMessage('Thẻ đã hết hạn');
            else if (data.message.includes('Hết lượt')) speakMessage('Thẻ đã hết lượt bơi');
            else speakMessage('Vé không hợp lệ');
        } else {
            // Success
            alert(`✅ ${data.message}\n` + (data.pass_status.remaining_sessions !== null ? `Còn lại: ${data.pass_status.remaining_sessions} lượt.` : 'Không giới hạn lượt.'));
            speakMessage('Xin mời vào');

            // Cập nhật giao diện in vé con
            setSoldTickets([{
                id: data.new_ticket.id,
                ticket_type_id: '',
                status: 'UNUSED',
                price_paid: data.new_ticket.price_paid,
                sold_at: data.new_ticket.sold_at,
                valid_from: new Date().toISOString().split('T')[0], // local date 
                valid_until: new Date().toISOString().split('T')[0],
                type_name: data.new_ticket.type_name,
                pool_close_time: data.new_ticket.pool_close_time,
                remaining_sessions: 1,
                customer_name: data.new_ticket.customer_name,
                customer_phone: null,
                sold_by: profile?.id || null,
                last_scan_direction: null,
                last_scan_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                payment_method: 'CASH' // check-in vé mồ côi
            }]);
            setCheckinCode('');
        }
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
                                <h2>🏊 VÉ BƠI</h2>

                                <div><strong>Khách hàng:</strong> {ticket.customer_name || 'Khách Vãng Lai'}</div>
                                <div><strong>Hiệu lực:</strong> {ticket.valid_from === ticket.valid_until ? 'Trong ngày' : `${ticket.valid_from} → ${ticket.valid_until}`}</div>

                                {ticket.remaining_sessions !== undefined && ticket.remaining_sessions !== null && (
                                    <div style={{ marginTop: '4px', fontWeight: 'bold', borderTop: '1px dashed #ccc', paddingTop: '4px' }}>
                                        Số lượt tổng cộng: {ticket.remaining_sessions} lượt
                                    </div>
                                )}
                                <div className="info-row">
                                    <span className="label">Giá</span>
                                    <span className="value">{formatPrice(ticket.price_paid)}</span>
                                </div>
                                <div className="info-row">
                                    <span className="label">Bán lúc</span>
                                    <span className="value">{formatTime(ticket.sold_at)}</span>
                                </div>
                                <div className="info-row">
                                    <span className="label">Hết hạn</span>
                                    <span className="value">Hôm nay, {ticket.pool_close_time}</span>
                                </div>
                                {ticket.customer_name && (
                                    <div className="info-row">
                                        <span className="label">Khách</span>
                                        <span className="value">{ticket.customer_name}</span>
                                    </div>
                                )}

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
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', animation: 'fadeIn 0.3s ease' }}>
                    {/* LEFT COLUMN — Vé Lượt */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                            <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: 'linear-gradient(180deg, #3b82f6, #6366f1)' }} />
                            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1d27' }}>Vé Lượt</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {dailyTypes.length > 0 ? dailyTypes.map(renderTicketButton) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Chưa có vé lượt nào đang mở bán.</p>}
                        </div>
                    </div>

                    {/* RIGHT COLUMN — Vé Nhiều Buổi / Vé Tháng */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px' }}>
                            <div style={{ width: '4px', height: '24px', borderRadius: '4px', background: 'linear-gradient(180deg, #8b5cf6, #a855f7)' }} />
                            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#1a1d27' }}>Vé Nhiều Buổi / Vé Tháng</h2>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {advancedTypes.length > 0 ? advancedTypes.map(renderTicketButton) : <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Chưa có loại vé đặc biệt nào.</p>}
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

                        <form onSubmit={handleAdvancedSubmit}>
                            <div className="form-group">
                                <label>Áp dụng Khuyến mãi (Tùy chọn)</label>
                                <select
                                    value={selectedPromoId}
                                    onChange={e => setSelectedPromoId(e.target.value)}
                                    style={{ borderColor: selectedPromoId ? 'var(--accent-blue)' : '' }}
                                >
                                    <option value="">-- Không áp dụng KM --</option>
                                    {promotions
                                        .filter(p => p.applicable_ticket_types === null || p.applicable_ticket_types.includes(selectedAdvancedType.id))
                                        .map(p => {
                                            let label = p.name;
                                            if (p.type === 'AMOUNT') label += ` (-${p.value.toLocaleString()}đ)`;
                                            if (p.type === 'PERCENT') label += ` (-${p.value}%)`;
                                            if (p.type === 'BONUS_SESSION') label += ` (+${p.value} lượt)`;
                                            return <option key={p.id} value={p.id}>{label}</option>
                                        })}
                                </select>
                            </div>

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
                                                        .select('customer_name, customer_phone, card_code, ticket_types!inner(category)')
                                                        .or(`card_code.ilike.%${term}%,customer_phone.ilike.%${term}%,customer_name.ilike.%${term}%`)
                                                        .in('ticket_types.category', ['MONTHLY', 'MULTI'])
                                                        .limit(20);
                                                    // Deduplicate by phone
                                                    const seen = new Set<string>();
                                                    const unique = (data || []).filter((d: any) => {
                                                        const key = d.customer_phone || d.card_code;
                                                        if (!key || seen.has(key)) return false;
                                                        seen.add(key);
                                                        return true;
                                                    }).map((d: any) => ({ name: d.customer_name || '', phone: d.customer_phone || '', card_code: d.card_code || '' }));
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

                        <div style={{ display: 'flex', gap: '12px' }}>
                            <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowPaymentModal(false)}>Hủy</button>
                            <button type="button" className="btn btn-primary" style={{ flex: 2 }} disabled={selling} onClick={() => {
                                doSellTicket(
                                    pendingTicketData.ticketType,
                                    pendingTicketData.name,
                                    pendingTicketData.phone,
                                    pendingTicketData.promoId,
                                    pendingTicketData.code,
                                    selectedPaymentMethod
                                );
                            }}>
                                {selling ? 'Đang xử lý...' : 'THANH TOÁN & IN VÉ'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
