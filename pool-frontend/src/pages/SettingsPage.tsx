/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars */
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import * as XLSX from 'xlsx';
import type { CardBank, CardBatchView } from '../types';

interface Settings {
    gate_control_mode: string;
    pool_open_time: string;
    pool_close_time: string;
    business_name?: string;
    business_address?: string;
    business_phone?: string;
    business_email?: string;
    business_logo?: string;
    bank_name?: string;
    bank_account_number?: string;
    bank_account_name?: string;
    print_format?: 'K80' | 'A5';
}

interface DaySchedule {
    open: string;
    close: string;
    closed: boolean;
}

type WeekSchedule = Record<string, DaySchedule>;

interface TicketType {
    id: string;
    name: string;
    category: 'DAILY' | 'MULTI' | 'MONTHLY' | 'LESSON';
    price: number;
    description: string;
    validity_days: number | null;
    session_count: number | null;
    is_active: boolean;
    duration_months: number | null;
    duration_unit: 'days' | 'months' | null;
    lesson_class_type: 'GROUP' | 'ONE_ON_ONE' | 'ONE_ON_TWO' | null;
    lesson_schedule_type: 'FIXED' | 'FLEXIBLE' | null;
    age_price_tiers: { minAge: number, maxAge: number, price: number }[] | null;
}

interface LessonScheduleRow {
    id: string;
    ticket_type_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
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


export default function SettingsPage() {
    const { profile } = useAuth();
    const [settings, setSettings] = useState<Settings>({
        gate_control_mode: 'MANUAL_QR',
        pool_open_time: '06:00',
        pool_close_time: '20:00',
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Weekly schedule
    const defaultSchedule: WeekSchedule = {
        mon: { open: '06:00', close: '20:00', closed: false },
        tue: { open: '06:00', close: '20:00', closed: false },
        wed: { open: '06:00', close: '20:00', closed: false },
        thu: { open: '06:00', close: '20:00', closed: false },
        fri: { open: '06:00', close: '20:00', closed: false },
        sat: { open: '06:00', close: '21:00', closed: false },
        sun: { open: '06:00', close: '21:00', closed: false },
    };
    const [weekSchedule, setWeekSchedule] = useState<WeekSchedule>(defaultSchedule);

    // active tab state
    const [activeTab, setActiveTab] = useState<'system' | 'business' | 'tickets' | 'promotions' | 'lessons' | 'cards'>('system');

    // Card Bank state
    const [cards, setCards] = useState<CardBank[]>([]);
    const [cardBatches, setCardBatches] = useState<CardBatchView[]>([]);
    const [showBatchModal, setShowBatchModal] = useState(false);
    const [batchTxtFile, setBatchTxtFile] = useState<File | null>(null);

    const [cbPrefix, setCbPrefix] = useState('HB');
    const [cbQuantity, setCbQuantity] = useState<number | ''>(50);
    const [cbBatchNote, setCbBatchNote] = useState('');
    const [cardSubTab, setCardSubTab] = useState<'system' | 'manual' | 'batches'>('system');
    const [filterBatch, setFilterBatch] = useState<number | 'ALL'>('ALL');

    const [checkCardCode, setCheckCardCode] = useState('');
    const [checkCardResult, setCheckCardResult] = useState<{exists: boolean, data?: any} | null>(null);
    const [checkingCard, setCheckingCard] = useState(false);

    const [manualCardCode, setManualCardCode] = useState('');
    const [addingManualCard, setAddingManualCard] = useState(false);

    // Ticket Types state
    const [ticketTypes, setTicketTypes] = useState<TicketType[]>([]);
    const [showTicketModal, setShowTicketModal] = useState(false);
    const [editingTicket, setEditingTicket] = useState<TicketType | null>(null);

    // Form state for ticket type
    const [tName, setTName] = useState('');
    const [tCategory, setTCategory] = useState<'DAILY' | 'MULTI' | 'MONTHLY' | 'LESSON'>('DAILY');
    const [tPrice, setTPrice] = useState(0);
    const [tDesc, setTDesc] = useState('');
    const [tDays, setTDays] = useState<number | ''>('');
    const [tSessions, setTSessions] = useState<number | ''>('');

    // Promotions state
    const [promotions, setPromotions] = useState<Promotion[]>([]);
    const [showPromoModal, setShowPromoModal] = useState(false);
    const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);

    // Form state for promotions
    const [pName, setPName] = useState('');
    const [pType, setPType] = useState<'AMOUNT' | 'PERCENT' | 'BONUS_SESSION'>('AMOUNT');
    const [pValue, setPValue] = useState<number | ''>('');
    const [isUnlimitedPromo, setIsUnlimitedPromo] = useState(true);
    const [pFrom, setPFrom] = useState('');
    const [pUntil, setPUntil] = useState('');
    const [pAllTickets, setPAllTickets] = useState(true);
    const [pSelectedTickets, setPSelectedTickets] = useState<string[]>([]);
    const [pAllLessons, setPAllLessons] = useState(true);
    const [pSelectedLessons, setPSelectedLessons] = useState<string[]>([]);

    // --- LESSON PACKAGES state ---
    const [lessonTypes, setLessonTypes] = useState<TicketType[]>([]);
    const [showLessonModal, setShowLessonModal] = useState(false);
    const [editingLesson, setEditingLesson] = useState<TicketType | null>(null);
    const [lName, setLName] = useState('');
    const [lSessions, setLSessions] = useState<number | ''>(10);
    const [lDurationVal, setLDurationVal] = useState<number | ''>(1);
    const [lDurationUnit, setLDurationUnit] = useState<'months' | 'days'>('months');
    const [lPrice, setLPrice] = useState(0);
    const [lClassType, setLClassType] = useState<'GROUP' | 'ONE_ON_ONE' | 'ONE_ON_TWO'>('GROUP');
    const [lDesc, setLDesc] = useState('');
    const [lSchedules, setLSchedules] = useState<{ day: number; start: string; end: string; enabled: boolean }[]>(
        [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: d, start: '10:00', end: '11:00', enabled: false }))
    );
    const [lessonSchedulesMap, setLessonSchedulesMap] = useState<Record<string, LessonScheduleRow[]>>({});
    const [lAgeTiers, setLAgeTiers] = useState<{ minAge: number, maxAge: number, price: number }[]>([]);



    const dayNames: Record<number, string> = { 0: 'Chủ nhật', 1: 'Thứ 2', 2: 'Thứ 3', 3: 'Thứ 4', 4: 'Thứ 5', 5: 'Thứ 6', 6: 'Thứ 7' };

    useEffect(() => {
        if (activeTab === 'cards') {
            fetchCards();
            fetchCardBatches();
        }
    }, [activeTab]);

    useEffect(() => {
        fetchSettings();
        fetchTicketTypes();
        fetchPromotions();
        fetchWeekSchedule();
        fetchLessonTypes();
        fetchCards();
        fetchCardBatches();
    }, []);

    async function fetchSettings() {
        const { data } = await supabase
            .from('system_settings')
            .select('key, value');

        if (data) {
            const s: Record<string, string> = {};
            for (const row of data) {
                if (row.key === 'pool_weekly_schedule') continue; // Handled separately by fetchWeekSchedule
                try {
                    // value is stored as JSONB, parse the quoted string
                    s[row.key] = typeof row.value === 'string'
                        ? row.value.replace(/^"|"$/g, '')
                        : JSON.parse(JSON.stringify(row.value)).replace(/^"|"$/g, '');
                } catch (e) {
                    s[row.key] = typeof row.value === 'string' ? row.value : String(row.value);
                }
            }
            setSettings(prev => ({ ...prev, ...s } as Settings));
        }
    }

    async function fetchTicketTypes() {
        const { data } = await supabase
            .from('ticket_types')
            .select('*')
            .neq('category', 'LESSON')
            .order('created_at', { ascending: false });

        if (data) setTicketTypes(data);
        setLoading(false);
    }

    async function fetchPromotions() {
        const { data } = await supabase
            .from('promotions')
            .select('*')
            .order('created_at', { ascending: false });
        if (data) setPromotions(data);
    }

    async function fetchCards() {
        const { data } = await supabase.from('card_bank').select('*').order('created_at', { ascending: false }).limit(2000);
        if (data) setCards(data as CardBank[]);
    }

    async function fetchCardBatches() {
        const { data } = await supabase.from('card_batches_view').select('*').order('batch_number', { ascending: false });
        if (data) setCardBatches(data as CardBatchView[]);
    }

    async function handleCheckCard() {
        const code = checkCardCode.trim().toUpperCase();
        if (!code) return;
        setCheckingCard(true);
        setCheckCardResult(null);
        try {
            const { data, error } = await supabase
                .from('card_bank')
                .select('*')
                .ilike('card_code', code)
                .single();

            if (error && error.code !== 'PGRST116') {
                throw error;
            }

            if (data) {
                setCheckCardResult({ exists: true, data });
            } else {
                setCheckCardResult({ exists: false });
            }
        } catch (e: any) {
            alert('Lỗi khi kiểm tra thẻ: ' + e.message);
        }
        setCheckingCard(false);
    }

    async function handleGenerateCards(e: React.FormEvent) {
        e.preventDefault();
        if (!cbPrefix || !cbQuantity || cbQuantity <= 0) return;
        setSaving(true);

        const prefix = cbPrefix.toUpperCase();
        const quantity = Number(cbQuantity);
        const now = new Date();
        const monthYear = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getFullYear()).slice(2)}`;

        // Get max batch_number
        const { data: maxBatchData } = await supabase
            .from('card_bank')
            .select('batch_number')
            .eq('source', 'SYSTEM')
            .order('batch_number', { ascending: false })
            .limit(1);

        let newBatchNumber = 1;
        if (maxBatchData && maxBatchData.length > 0 && maxBatchData[0].batch_number) {
            newBatchNumber = maxBatchData[0].batch_number + 1;
        }

        // Get max sequence number to continue incrementing
        const { data: existing } = await supabase
            .from('card_bank')
            .select('sequence_number')
            .eq('prefix', prefix)
            .eq('month_year', monthYear)
            .order('sequence_number', { ascending: false })
            .limit(1);

        let startSeq = 1;
        if (existing && existing.length > 0) {
            startSeq = existing[0].sequence_number + 1;
        }

        const newCards: any[] = [];
        for (let i = 0; i < quantity; i++) {
            const seq = startSeq + i;
            const seqStr = String(seq).padStart(5, '0');
            const randomStr = Math.random().toString(36).substring(2, 8).toUpperCase();
            const cardCode = `${prefix}${monthYear}${seqStr}${randomStr}`;

            newCards.push({
                card_code: cardCode,
                prefix,
                month_year: monthYear,
                sequence_number: seq,
                random_string: randomStr,
                status: 'UNUSED',
                source: 'SYSTEM',
                batch_number: newBatchNumber,
                batch_note: cbBatchNote.trim() || null,
                created_by: profile?.id
            });
        }

        const { error } = await supabase.from('card_bank').insert(newCards);
        if (error) {
            alert('Lỗi tạo thẻ: ' + error.message);
        } else {
            alert(`Đã tạo thành công ${quantity} mã thẻ mới ở Lô ${newBatchNumber}!`);
            fetchCards();
            setCbQuantity('');
            setCbBatchNote('');
        }
        setSaving(false);
    }

    async function handleImportBatch(e: React.FormEvent) {
        e.preventDefault();
        if (!batchTxtFile) {
            alert('Vui lòng chọn file .txt chứa mã thẻ!');
            return;
        }
        setSaving(true);

        try {
            const text = await batchTxtFile.text();
            // Tách theo dòng, trim, chuyển thành CHỮ HOA và lọc dòng rỗng
            const lines = text.split('\n').map(l => l.trim().toUpperCase()).filter(l => l.length > 0);

            // Loại bỏ trùng mã trong chính file tải lên
            const uniqueCodes = Array.from(new Set(lines));

            if (uniqueCodes.length === 0) {
                alert('File không chứa mã thẻ hợp lệ.');
                setSaving(false); return;
            }

            // Get max batch_number
            const { data: maxBatchData } = await supabase
                .from('card_bank')
                .select('batch_number')
                .order('batch_number', { ascending: false })
                .limit(1);

            let newBatchNumber = 1;
            if (maxBatchData && maxBatchData.length > 0 && maxBatchData[0].batch_number) {
                newBatchNumber = maxBatchData[0].batch_number + 1;
            }

            const newCards = uniqueCodes.map(code => ({
                card_code: code,
                status: 'UNUSED',
                source: 'MANUAL',
                batch_number: newBatchNumber,
                batch_note: cbBatchNote.trim() || null,
                created_by: profile?.id
            }));

            // Nếu mã nào đã tồn tại trong csdl thì ignor, chỉ insert những mã chừa có
            const { error } = await supabase.from('card_bank').upsert(newCards, { onConflict: 'card_code', ignoreDuplicates: true });

            if (error) {
                throw error;
            }

            alert(`Đã tạo thành công Lô thẻ số ${newBatchNumber} gồm ${uniqueCodes.length} thẻ.`);
            setShowBatchModal(false);
            setBatchTxtFile(null);
            setCbBatchNote('');
            fetchCards();
            fetchCardBatches();

        } catch (error: any) {
            alert('Lỗi import lô thẻ. Chi tiết: ' + error.message);
        }
        setSaving(false);
    }

    async function handleDeleteBatch(batchNumber: number) {
        if (!window.confirm(`XÓA LÔ THẺ SỐ ${batchNumber}?\nTất cả mã thẻ trong lô này chưa gắn với khách hàng đều sẽ bị xóa mất vĩnh viễn!\n\nLưu ý: Bạn không thể xóa lô nếu đã có thẻ được sử dụng.`)) {
            return;
        }

        // Cảnh báo nếu có mã thẻ đã USED
        const checkUsed = await supabase.from('card_bank').select('id', { count: 'exact', head: true }).eq('batch_number', batchNumber).neq('status', 'UNUSED');
        if (checkUsed.count && checkUsed.count > 0) {
            alert(`Lô thẻ này đã có ${checkUsed.count} thẻ được kích hoạt sử dụng (USED). Bạn KHÔNG THỂ xóa toàn bộ lô này.\n\nHãy thu hồi hoặc ẩn từng thẻ.`);
            return;
        }

        const { error } = await supabase.from('card_bank').delete().eq('batch_number', batchNumber);

        if (error) {
            alert('Lỗi khi xóa lô thẻ: ' + error.message);
        } else {
            fetchCards();
            fetchCardBatches();
            if (filterBatch === batchNumber) setFilterBatch('ALL');
        }
    }

    async function handleAddManualCard(e: React.FormEvent) {
        e.preventDefault();
        const code = manualCardCode.trim().toUpperCase();
        if (!code) return;
        setAddingManualCard(true);

        try {
            // Check if exist
            const { data: exist } = await supabase.from('card_bank').select('card_code').eq('card_code', code).maybeSingle();
            if (exist) {
                alert('Lỗi: Mã thẻ này đã tồn tại trong hệ thống!');
            } else {
                const { error } = await supabase.from('card_bank').insert([{
                    card_code: code,
                    status: 'UNUSED',
                    source: 'MANUAL',
                    created_by: profile?.id
                }]);
                if (error) throw error;
                
                alert(`Đã thêm mã thẻ thủ công "${code}" thành công!`);
                setManualCardCode('');
                fetchCards();
            }
        } catch (error: any) {
            alert('Lỗi thêm thẻ thủ công. Chi tiết: ' + error.message);
        }
        setAddingManualCard(false);
    }

    function exportCardsToExcel() {
        let exportCards = cards.filter(c => c.status === 'UNUSED' && c.source === 'SYSTEM');
        if (filterBatch !== 'ALL') {
            exportCards = exportCards.filter(c => c.batch_number === filterBatch);
        }

        if (exportCards.length === 0) {
            alert('Không có mã thẻ UNUSED nào để xuất trong lô này.');
            return;
        }

        const sorted = [...exportCards].sort((a, b) => (a.sequence_number ?? 0) - (b.sequence_number ?? 0));

        const wsData = sorted.map((c, idx) => ({
            'STT': idx + 1,
            'Số Lô': c.batch_number || 'N/A',
            'Ghi chú lô': c.batch_note || '',
            'Mã Thẻ': c.card_code
        }));

        const ws = XLSX.utils.json_to_sheet(wsData);
        // Tự động căn chỉnh độ rộng cột
        ws['!cols'] = [{ wch: 5 }, { wch: 10 }, { wch: 30 }, { wch: 25 }];

        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'TheChuaDung');

        const fileName = filterBatch === 'ALL' ? `the_chua_dung_tatca_${new Date().toISOString().slice(0, 10)}.xlsx` : `the_lô_${filterBatch}_${new Date().toISOString().slice(0, 10)}.xlsx`;
        XLSX.writeFile(wb, fileName);
    }



    async function saveAllSettings() {
        setSaving(true);
        setSaved(false);
        try {
            const updates = Object.keys(settings).map((k) => ({
                key: k,
                value: JSON.stringify(settings[k as keyof Settings]),
                updated_at: new Date().toISOString(),
                updated_by: profile?.id,
            }));

            for (const item of updates) {
                await supabase.from('system_settings').upsert(item, { onConflict: 'key' });
            }

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (e: any) {
            alert('Lỗi lưu cài đặt: ' + e.message);
        }
        setSaving(false);
    }

    function handleModeChange(mode: string) {
        setSettings(prev => ({ ...prev, gate_control_mode: mode }));
    }

    // Weekly schedule
    async function fetchWeekSchedule() {
        const { data } = await supabase.from('system_settings').select('value').eq('key', 'pool_weekly_schedule').single();
        if (data?.value) {
            try {
                const parsed = typeof data.value === 'string' ? JSON.parse(data.value) : data.value;
                setWeekSchedule(prev => ({ ...prev, ...parsed }));
            } catch { /* keep default */ }
        }
    }

    async function saveWeekSchedule(updated: WeekSchedule) {
        setWeekSchedule(updated);
        setSaving(true); setSaved(false);
        const { error } = await supabase.from('system_settings').upsert({
            key: 'pool_weekly_schedule',
            value: updated,
            updated_at: new Date().toISOString(),
            updated_by: profile?.id,
        }, { onConflict: 'key' });
        if (error) alert('Lỗi lưu lịch: ' + error.message);
        else { setSaved(true); setTimeout(() => setSaved(false), 2000); }
        setSaving(false);
    }

    const dayLabels: Record<string, string> = {
        mon: 'Thứ 2', tue: 'Thứ 3', wed: 'Thứ 4', thu: 'Thứ 5',
        fri: 'Thứ 6', sat: 'Thứ 7', sun: 'CN',
    };



    // --- TICKET TYPE MANAGEMENT ---

    function openNewTicketModal() {
        setEditingTicket(null);
        setTName('');
        setTCategory('DAILY');
        setTPrice(0);
        setTDesc('');
        setTDays(1); // default 1 day for daily
        setTSessions('');
        setShowTicketModal(true);
    }

    function openEditTicketModal(t: TicketType) {
        setEditingTicket(t);
        setTName(t.name);
        setTCategory(t.category);
        setTPrice(t.price);
        setTDesc(t.description || '');
        setTDays(t.validity_days || '');
        setTSessions(t.session_count || '');
        setShowTicketModal(true);
    }

    async function toggleTicketActive(id: string, currentStatus: boolean) {
        await supabase.from('ticket_types').update({ is_active: !currentStatus }).eq('id', id);
        fetchTicketTypes();
    }

    async function handleSaveTicket(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);

        const payload = {
            name: tName,
            category: tCategory,
            price: tPrice,
            description: tDesc,
            validity_days: tDays === '' ? null : Number(tDays),
            session_count: tSessions === '' ? null : Number(tSessions)
        };

        if (editingTicket) {
            await supabase.from('ticket_types').update(payload).eq('id', editingTicket.id);
        } else {
            await supabase.from('ticket_types').insert([payload]);
        }

        setShowTicketModal(false);
        setSaving(false);
        fetchTicketTypes();
    }

    async function handleDeleteTicket(id: string) {
        if (!window.confirm('Bạn có chắc chắn muốn xóa loại vé này? Lưu ý: Không thể xóa nếu đã có khách mua loại vé này.')) return;

        const { error } = await supabase.from('ticket_types').delete().eq('id', id);
        if (error) {
            alert('Không thể xóa: ' + (error.code === '23503' ? 'Loại vé này đã phát sinh giao dịch nên không thể xóa. Vui lòng chuyển sang trạng thái "Đã ẩn".' : error.message));
        } else {
            fetchTicketTypes();
        }
    }

    // --- PROMOTIONS MANAGEMENT ---

    function openNewPromoModal() {
        setEditingPromo(null);
        setPName('');
        setPType('AMOUNT');
        setPValue('');
        setIsUnlimitedPromo(true);
        setPFrom('');
        setPUntil('');
        setPAllTickets(true);
        setPSelectedTickets([]);
        setPAllLessons(true);
        setPSelectedLessons([]);
        setShowPromoModal(true);
    }

    function openEditPromoModal(p: Promotion) {
        setEditingPromo(p);
        setPName(p.name);
        setPType(p.type);
        setPValue(p.value);
        setIsUnlimitedPromo(!p.valid_from && !p.valid_until);
        setPFrom(p.valid_from ? new Date(p.valid_from).toISOString().slice(0, 16) : '');
        setPUntil(p.valid_until ? new Date(p.valid_until).toISOString().slice(0, 16) : '');
        setPAllTickets(p.applicable_ticket_types === null);
        setPSelectedTickets(p.applicable_ticket_types || []);
        setPAllLessons(p.applicable_lesson_types === null);
        setPSelectedLessons(p.applicable_lesson_types || []);
        setShowPromoModal(true);
    }

    async function togglePromoActive(id: string, currentStatus: boolean) {
        await supabase.from('promotions').update({ is_active: !currentStatus }).eq('id', id);
        fetchPromotions();
    }

    async function handleSavePromo(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);

        const payload = {
            name: pName,
            type: pType,
            value: Number(pValue),
            valid_from: (!isUnlimitedPromo && pFrom) ? new Date(pFrom).toISOString() : null,
            valid_until: (!isUnlimitedPromo && pUntil) ? new Date(pUntil).toISOString() : null,
            applicable_ticket_types: pAllTickets ? null : pSelectedTickets,
            applicable_lesson_types: pAllLessons ? null : pSelectedLessons
        };

        let err = null;
        if (editingPromo) {
            const { error } = await supabase.from('promotions').update(payload).eq('id', editingPromo.id);
            err = error;
        } else {
            const { error } = await supabase.from('promotions').insert([payload]);
            err = error;
        }

        if (err) {
            alert('Lỗi lưu KM: ' + err.message);
        } else {
            setShowPromoModal(false);
            fetchPromotions();
        }
        setSaving(false);
    }

    async function handleDeletePromo(id: string) {
        if (!window.confirm('Bạn có chắc chắn muốn xóa chương trình khuyến mãi này?')) return;

        const { error } = await supabase.from('promotions').delete().eq('id', id);
        if (error) {
            alert('Không thể xóa: ' + (error.code === '23503' ? 'Khuyến mãi này đã được áp dụng cho vé bán ra nên không thể xóa. Vui lòng chuyển sang trạng thái "Đã tắt".' : error.message));
        } else {
            fetchPromotions();
        }
    }

    // --- LESSON PACKAGES MANAGEMENT ---
    async function fetchLessonTypes() {
        const { data } = await supabase
            .from('ticket_types')
            .select('*')
            .eq('category', 'LESSON')
            .order('created_at', { ascending: false });
        if (data) setLessonTypes(data);

        // Fetch schedules for all lesson types
        const { data: schedData } = await supabase.from('lesson_schedules').select('*');
        if (schedData) {
            const map: Record<string, LessonScheduleRow[]> = {};
            schedData.forEach((s: any) => {
                if (!map[s.ticket_type_id]) map[s.ticket_type_id] = [];
                map[s.ticket_type_id].push(s);
            });
            setLessonSchedulesMap(map);
        }
    }

    function openNewLessonModal() {
        setEditingLesson(null);
        setLName('');
        setLSessions(10);
        setLDurationVal(1);
        setLDurationUnit('months');
        setLPrice(0);
        setLClassType('GROUP');
        setLDesc('');
        setLSchedules([0, 1, 2, 3, 4, 5, 6].map(d => ({ day: d, start: '10:00', end: '11:00', enabled: false })));
        setLAgeTiers([]);
        setShowLessonModal(true);
    }

    function openEditLessonModal(t: TicketType) {
        setEditingLesson(t);
        setLName(t.name);
        setLSessions(t.session_count || '');
        setLDurationUnit(t.duration_unit || 'months');
        setLDurationVal(t.duration_unit === 'days' ? (t.validity_days || '') : (t.duration_months || ''));
        setLPrice(t.price);
        setLClassType(t.lesson_class_type || 'GROUP');
        setLDesc(t.description || '');
        // Load schedules
        const existing = lessonSchedulesMap[t.id] || [];
        setLSchedules([0, 1, 2, 3, 4, 5, 6].map(d => {
            const found = existing.find(s => s.day_of_week === d);
            return { day: d, start: found?.start_time?.substring(0, 5) || '10:00', end: found?.end_time?.substring(0, 5) || '11:00', enabled: !!found };
        }));
        setLAgeTiers(t.age_price_tiers || []);
        setShowLessonModal(true);
    }

    async function handleSaveLesson(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        const isPrivate = lClassType !== 'GROUP'; // ONE_ON_ONE, ONE_ON_TWO
        const scheduleType = lClassType === 'GROUP' ? 'FIXED' : 'FLEXIBLE';
        const payload: any = {
            name: lName,
            category: 'LESSON' as any,
            price: lPrice,
            description: lDesc,
            session_count: isPrivate ? null : (lSessions === '' ? null : Number(lSessions)),
            duration_unit: isPrivate ? null : lDurationUnit,
            validity_days: isPrivate ? null : (lDurationUnit === 'days' ? (lDurationVal === '' ? null : Number(lDurationVal)) : null),
            duration_months: isPrivate ? null : (lDurationUnit === 'months' ? (lDurationVal === '' ? null : Number(lDurationVal)) : null),
            lesson_class_type: lClassType,
            lesson_schedule_type: scheduleType,
            age_price_tiers: isPrivate && lAgeTiers.length > 0 ? lAgeTiers : null
        };

        let typeId = editingLesson?.id;
        if (editingLesson) {
            await supabase.from('ticket_types').update(payload).eq('id', editingLesson.id);
        } else {
            const { data } = await supabase.from('ticket_types').insert([payload]).select();
            if (data && data[0]) typeId = data[0].id;
        }

        // Save schedules (only for GROUP)
        if (typeId && scheduleType === 'FIXED') {
            await supabase.from('lesson_schedules').delete().eq('ticket_type_id', typeId);
            const rows = lSchedules.filter(s => s.enabled).map(s => ({
                ticket_type_id: typeId!,
                day_of_week: s.day,
                start_time: s.start,
                end_time: s.end,
            }));
            if (rows.length > 0) {
                await supabase.from('lesson_schedules').insert(rows);
            }
        } else if (typeId && scheduleType === 'FLEXIBLE') {
            await supabase.from('lesson_schedules').delete().eq('ticket_type_id', typeId);
        }

        setShowLessonModal(false);
        setSaving(false);
        fetchLessonTypes();
        fetchTicketTypes();
    }

    async function handleDeleteLesson(id: string) {
        if (!window.confirm('Xóa gói khóa học bơi này? Không thể xóa nếu đã có khách đăng ký.')) return;
        const { error } = await supabase.from('ticket_types').delete().eq('id', id);
        if (error) {
            alert('Không thể xóa: ' + (error.code === '23503' ? 'Gói này đã phát sinh giao dịch. Vui lòng chuyển sang "Đã ẩn".' : error.message));
        } else {
            fetchLessonTypes();
            fetchTicketTypes();
        }
    }

    async function toggleLessonActive(id: string, currentStatus: boolean) {
        await supabase.from('ticket_types').update({ is_active: !currentStatus }).eq('id', id);
        fetchLessonTypes();
        fetchTicketTypes();
    }

    function formatScheduleSummary(typeId: string, classType: string | null, schedType: string | null): string {
        if (classType !== 'GROUP' || schedType !== 'FIXED') return 'Lịch tự do';
        const scheds = lessonSchedulesMap[typeId] || [];
        if (scheds.length === 0) return 'Chưa đặt lịch';
        return scheds.map(s => `${dayNames[s.day_of_week]} ${s.start_time?.substring(0, 5)}-${s.end_time?.substring(0, 5)}`).join(', ');
    }

    if (loading) return <div className="page-loading">Đang tải...</div>;

    if (profile?.role !== 'ADMIN') {
        return (
            <div className="page-container">
                <div className="alert alert-error">
                    Chỉ ADMIN mới có quyền truy cập trang Cài đặt.
                </div>
            </div>
        );
    }

    return (
        <div className="page-container" style={{ maxWidth: '1000px' }}>
            <div className="page-header">
                <h1>⚙️ Cài Đặt Hệ Thống</h1>
                <p>Cấu hình cổng kiểm soát và các loại vé bơi</p>
                {saved && <span className="save-badge">✓ Đã lưu</span>}
            </div>

            {/* Tabs Navigation */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', borderBottom: '1px solid var(--border-color)', marginBottom: '24px' }}>
                <button
                    className={`btn ${activeTab === 'system' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('system')}
                >
                    🔧 Cài đặt chung
                </button>
                <button
                    className={`btn ${activeTab === 'business' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('business')}
                >
                    🏢 Đơn vị & Thanh toán
                </button>
                <button
                    className={`btn ${activeTab === 'tickets' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('tickets')}
                >
                    🎟️ Quản lý Loại Vé
                </button>
                <button
                    className={`btn ${activeTab === 'lessons' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('lessons')}
                >
                    📚 Gói Khóa Học Bơi
                </button>
                <button
                    className={`btn ${activeTab === 'promotions' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('promotions')}
                >
                    🎁 Khuyến Mãi
                </button>
                <button
                    className={`btn ${activeTab === 'cards' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ borderRadius: '8px 8px 0 0', padding: '12px 24px', margin: 0 }}
                    onClick={() => setActiveTab('cards')}
                >
                    💳 Ngân Hàng Thẻ
                </button>

            </div>

            {activeTab === 'business' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <section className="settings-section">
                        <h2>🏢 Thông tin doanh nghiệp</h2>
                        <p className="section-desc">Hiển thị trên Sidebar và tiêu đề các mẫu in ấn báo cáo</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '500px' }}>
                            <div className="form-group">
                                <label>Tên doanh nghiệp / Công ty</label>
                                <input type="text" className="form-control"
                                    value={settings.business_name || ''}
                                    onChange={e => setSettings({ ...settings, business_name: e.target.value })}
                                    placeholder="Hệ Thống Vé Bơi"
                                />
                            </div>
                            <div className="form-group">
                                <label>Địa chỉ</label>
                                <input type="text" className="form-control"
                                    value={settings.business_address || ''}
                                    onChange={e => setSettings({ ...settings, business_address: e.target.value })}
                                    placeholder="123 Đường XYZ, TP HCM..."
                                />
                            </div>
                            <div className="form-group" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                                <div>
                                    <label>Số điện thoại</label>
                                    <input type="text" className="form-control"
                                        value={settings.business_phone || ''}
                                        onChange={e => setSettings({ ...settings, business_phone: e.target.value })}
                                        placeholder="0123.456.789"
                                    />
                                </div>
                                <div>
                                    <label>Email liên hệ</label>
                                    <input type="email" className="form-control"
                                        value={settings.business_email || ''}
                                        onChange={e => setSettings({ ...settings, business_email: e.target.value })}
                                        placeholder="lienhe@domain.com"
                                    />
                                </div>
                            </div>
                            <div className="form-group">
                                <label>Link ảnh Logo (URL)</label>
                                <label>Tiện ích Tải Ảnh Logo</label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                    <div style={{ flex: 1 }}>
                                        <input type="text" className="form-control"
                                            value={settings.business_logo || ''}
                                            onChange={e => setSettings({ ...settings, business_logo: e.target.value })}
                                            placeholder="https://example.com/logo.png"
                                            style={{ marginBottom: '8px' }}
                                        />
                                        <input type="file" accept="image/*"
                                            onChange={async (e) => {
                                                const file = e.target.files?.[0];
                                                if (!file) return;

                                                const oldUrl = settings.business_logo;

                                                setSaving(true);
                                                try {
                                                    const fileExt = file.name.split('.').pop();
                                                    const fileName = `business_logo_${Date.now()}.${fileExt}`;

                                                    const { data, error } = await supabase.storage.from('assets').upload(fileName, file, { upsert: true });
                                                    if (error) throw error;

                                                    if (data) {
                                                        const newUrl = supabase.storage.from('assets').getPublicUrl(fileName).data.publicUrl;
                                                        setSettings({ ...settings, business_logo: newUrl });

                                                        // Attempt to delete old image to save space
                                                        if (oldUrl && oldUrl.includes('/storage/v1/object/public/assets/')) {
                                                            const oldFileName = oldUrl.split('/').pop();
                                                            if (oldFileName && !oldFileName.includes('?')) {
                                                                await supabase.storage.from('assets').remove([oldFileName]);
                                                            }
                                                        }
                                                    }
                                                } catch (err: any) {
                                                    alert('Lỗi tải ảnh: ' + err.message + '\n\nVui lòng đảm bảo bạn đã chạy script SQL tạo Storage (013_storage_setup).');
                                                }
                                                setSaving(false);
                                            }}
                                        />
                                        <div style={{ fontSize: '11px', color: 'var(--text-secondary)', marginTop: '4px' }}>
                                            Bạn có thể dán link trực tiếp hoặc chọn ảnh từ máy để tự động tải lên máy chủ. Ảnh cũ sẽ tự động bị xóa.
                                        </div>
                                    </div>
                                    {settings.business_logo && (
                                        <img src={settings.business_logo} alt="Logo preview" style={{ height: '60px', width: '60px', objectFit: 'contain', borderRadius: '4px', background: '#f8fafc', padding: '4px', border: '1px solid #e2e8f0', flexShrink: 0 }} />
                                    )}
                                </div>
                            </div>
                        </div>
                    </section>

                    <section className="settings-section" style={{ marginTop: '24px' }}>
                        <h2>💳 Thông tin Ngân hàng</h2>
                        <p className="section-desc">Sử dụng để tạo mã QR chuyển khoản khi bán vé</p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '500px' }}>
                            <div className="form-group">
                                <label>Ngân hàng nhận (VD: VCB, MBBank...)</label>
                                <input type="text" className="form-control"
                                    value={settings.bank_name || ''}
                                    onChange={e => setSettings({ ...settings, bank_name: e.target.value })}
                                    placeholder="MBBank"
                                />
                            </div>
                            <div className="form-group">
                                <label>Số tài khoản</label>
                                <input type="text" className="form-control"
                                    value={settings.bank_account_number || ''}
                                    onChange={e => setSettings({ ...settings, bank_account_number: e.target.value })}
                                    placeholder="9999999999"
                                />
                            </div>
                            <div className="form-group">
                                <label>Tên chủ tài khoản</label>
                                <input type="text" className="form-control"
                                    value={settings.bank_account_name || ''}
                                    onChange={e => setSettings({ ...settings, bank_account_name: e.target.value })}
                                    placeholder="NGUYEN VAN A"
                                    style={{ textTransform: 'uppercase' }}
                                />
                            </div>
                            <div className="form-group">
                                <label>Khổ in mặc định (Phiếu Thu & Mã QR)</label>
                                <select className="form-control"
                                    value={settings.print_format || 'K80'}
                                    onChange={e => setSettings({ ...settings, print_format: e.target.value as 'K80' | 'A5' })}
                                >
                                    <option value="K80">Máy in Bill K80 (80mm)</option>
                                    <option value="A5">Máy in A5 dọc</option>
                                </select>
                            </div>
                        </div>
                    </section>

                    <div style={{ marginTop: '24px' }}>
                        <button className="btn btn-primary" onClick={saveAllSettings} disabled={saving}>
                            {saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'system' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    {/* Gate Control Mode */}
                    <section className="settings-section">
                        <h2>Chế độ kiểm soát cổng</h2>
                        <p className="section-desc">
                            Chọn cách kiểm soát ra vào hồ bơi
                        </p>
                        <div className="mode-toggle">
                            <button
                                className={`mode-btn ${settings.gate_control_mode === 'MANUAL_QR' ? 'active' : ''}`}
                                onClick={() => handleModeChange('MANUAL_QR')}
                                disabled={saving}
                            >
                                <span className="mode-icon">📱</span>
                                <span className="mode-label">QR Thủ công</span>
                                <span className="mode-desc">Nhân viên soát vé kiểm tra mã QR</span>
                            </button>
                            <button
                                className={`mode-btn ${settings.gate_control_mode === 'AUTO_GATE' ? 'active' : ''}`}
                                onClick={() => handleModeChange('AUTO_GATE')}
                                disabled={saving}
                            >
                                <span className="mode-icon">🚧</span>
                                <span className="mode-label">Cửa tự động</span>
                                <span className="mode-desc">Quét QR tự mở cổng barrier</span>
                            </button>
                        </div>
                    </section>

                    {/* Weekly Schedule */}
                    <section className="settings-section">
                        <h2>📅 Lịch hoạt động từng ngày</h2>
                        <p className="section-desc">
                            Vé QR chỉ hợp lệ trong khung giờ hoạt động. Ngoài giờ → quét vào bị từ chối. Ngày nghỉ → tất cả bị từ chối.
                        </p>
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                <thead>
                                    <tr>
                                        <th>Ngày</th>
                                        <th>Giờ mở cửa</th>
                                        <th>Giờ đóng cửa</th>
                                        <th style={{ textAlign: 'center' }}>Nghỉ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(dayLabels).map(([key, label]) => {
                                        const day = weekSchedule[key] || defaultSchedule[key];
                                        return (
                                            <tr key={key} style={{ opacity: day.closed ? 0.5 : 1 }}>
                                                <td style={{ fontWeight: 600, fontSize: '14px' }}>{label}</td>
                                                <td>
                                                    <input type="time" value={day.open} disabled={day.closed}
                                                        onChange={e => {
                                                            const updated = { ...weekSchedule, [key]: { ...day, open: e.target.value } };
                                                            setWeekSchedule(updated);
                                                        }}
                                                        onBlur={() => saveWeekSchedule(weekSchedule)}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '14px' }}
                                                    />
                                                </td>
                                                <td>
                                                    <input type="time" value={day.close} disabled={day.closed}
                                                        onChange={e => {
                                                            const updated = { ...weekSchedule, [key]: { ...day, close: e.target.value } };
                                                            setWeekSchedule(updated);
                                                        }}
                                                        onBlur={() => saveWeekSchedule(weekSchedule)}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '14px' }}
                                                    />
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <input type="checkbox" checked={day.closed}
                                                        onChange={e => {
                                                            const updated = { ...weekSchedule, [key]: { ...day, closed: e.target.checked } };
                                                            setWeekSchedule(updated);
                                                        }}
                                                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#ef4444' }}
                                                    />
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <div style={{ marginTop: '24px' }}>
                        <button className="btn btn-primary" onClick={() => { saveAllSettings(); saveWeekSchedule(weekSchedule); }} disabled={saving}>
                            {saving ? 'Đang lưu...' : 'Lưu Thay Đổi'}
                        </button>
                    </div>
                </div>
            )}

            {activeTab === 'tickets' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div className="dashboard-content-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>Danh sách Loại vé bơi</h2>
                            <button className="btn btn-primary btn-sm" onClick={openNewTicketModal}>
                                ➕ Tạo vé mới
                            </button>
                        </div>

                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Loại vé</th>
                                        <th>Mức giá</th>
                                        <th>Hạn sử dụng</th>
                                        <th>Số lượt (nếu có)</th>
                                        <th>Trạng thái (Bán)</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ticketTypes.map(t => (
                                        <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.5 }}>
                                            <td>
                                                <strong>{t.name}</strong>
                                                <div className="text-sm text-slate-400">
                                                    {t.category === 'DAILY' ? 'Vé ngày lẻ' : t.category === 'MULTI' ? 'Vé nhiều buổi' : 'Vé tháng'}
                                                </div>
                                            </td>
                                            <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                {t.price.toLocaleString('vi-VN')}đ
                                            </td>
                                            <td>{t.validity_days ? `${t.validity_days} ngày` : 'Không giới hạn'}</td>
                                            <td>{t.session_count ? `${t.session_count} lượt` : 'K.Giới hạn'}</td>
                                            <td>
                                                <button
                                                    className={`badge ${t.is_active ? 'badge-success' : 'badge-error'}`}
                                                    onClick={() => toggleTicketActive(t.id, t.is_active)}
                                                    style={{ cursor: 'pointer', border: 'none' }}
                                                >
                                                    {t.is_active ? 'Đang bán' : 'Đã ẩn'}
                                                </button>
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => openEditTicketModal(t)}
                                                >
                                                    ✏️ Sửa
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--alert-red)', marginLeft: '8px' }}
                                                    onClick={() => handleDeleteTicket(t.id)}
                                                >
                                                    🗑️ Xóa
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {ticketTypes.length === 0 && (
                                        <tr><td colSpan={6} style={{ textAlign: 'center' }}>Chưa có loại vé nào.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'promotions' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div className="dashboard-content-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>Chương trình Khuyến mãi</h2>
                            <button className="btn btn-primary btn-sm" onClick={openNewPromoModal}>
                                ➕ Thêm Khuyến mãi
                            </button>
                        </div>

                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Tên chương trình</th>
                                        <th>Hình thức</th>
                                        <th>Giá trị</th>
                                        <th>Thời hạn áp dụng</th>
                                        <th>Loại vé áp dụng</th>
                                        <th>Trạng thái</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {promotions.map(p => (
                                        <tr key={p.id} style={{ opacity: p.is_active ? 1 : 0.5 }}>
                                            <td><strong>{p.name}</strong></td>
                                            <td>
                                                <span className="badge badge-outline">
                                                    {p.type === 'AMOUNT' ? 'Giảm tiền mặt' : p.type === 'PERCENT' ? 'Giảm %' : 'Tặng thêm buổi'}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                {p.type === 'AMOUNT' && `-${p.value.toLocaleString('vi-VN')}đ`}
                                                {p.type === 'PERCENT' && `-${p.value}%`}
                                                {p.type === 'BONUS_SESSION' && `+${p.value} buổi`}
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '13px' }}>
                                                    {p.valid_from ? new Date(p.valid_from).toLocaleDateString() : 'Bất kỳ'}
                                                    {' → '}
                                                    {p.valid_until ? new Date(p.valid_until).toLocaleDateString() : 'Không thời hạn'}
                                                </div>
                                            </td>
                                            <td>
                                                <div style={{ fontSize: '13px' }}>
                                                    {p.applicable_ticket_types === null ? 'Tất cả loại vé' : `${p.applicable_ticket_types.length} loại vé`}
                                                </div>
                                                {p.applicable_lesson_types && p.applicable_lesson_types.length > 0 && (
                                                    <div style={{ fontSize: '11px', color: '#6366f1', marginTop: '2px' }}>
                                                        📚 {p.applicable_lesson_types.length} gói khóa học
                                                    </div>
                                                )}
                                            </td>
                                            <td>
                                                <button
                                                    className={`badge ${p.is_active ? 'badge-success' : 'badge-error'}`}
                                                    onClick={() => togglePromoActive(p.id, p.is_active)}
                                                    style={{ cursor: 'pointer', border: 'none' }}
                                                >
                                                    {p.is_active ? 'Đang bật' : 'Đã tắt'}
                                                </button>
                                            </td>
                                            <td>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    onClick={() => openEditPromoModal(p)}
                                                >
                                                    ✏️ Sửa
                                                </button>
                                                <button
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ color: 'var(--alert-red)', marginLeft: '8px' }}
                                                    onClick={() => handleDeletePromo(p.id)}
                                                >
                                                    🗑️ Xóa
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                    {promotions.length === 0 && (
                                        <tr><td colSpan={6} style={{ textAlign: 'center' }}>Chưa có chương trình khuyến mãi nào.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}



            {showTicketModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '500px' }}>
                        <h2>{editingTicket ? 'Sửa thông tin vé' : 'Tạo loại vé mới'}</h2>
                        <form onSubmit={handleSaveTicket}>
                            <div className="form-group">
                                <label>Tên loại vé (VD: Vé nhóm 10 tặng 2)</label>
                                <input type="text" required value={tName} onChange={e => setTName(e.target.value)} />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Loại cấu trúc</label>
                                    <select value={tCategory} onChange={e => setTCategory(e.target.value as any)}>
                                        <option value="DAILY">Vé lẻ 1 lần (DAILY)</option>
                                        <option value="MULTI">Gói nhiều buổi (MULTI)</option>
                                        <option value="MONTHLY">Vé tháng/năm (MONTHLY)</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Giá bán (VND)</label>
                                    <input type="number" min="0" required value={tPrice} onChange={e => setTPrice(Number(e.target.value))} />
                                </div>
                            </div>

                            <div className="form-group">
                                <label>Ghi chú (Hiển thị cho thu ngân - Không bắt buộc)</label>
                                <input type="text" value={tDesc} onChange={e => setTDesc(e.target.value)} />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Hạn sử dụng (Số ngày)</label>
                                    <input
                                        type="number" min="1"
                                        placeholder="Để trống = Không hết hạn"
                                        value={tDays} onChange={e => setTDays(e.target.value ? Number(e.target.value) : '')}
                                    />
                                </div>
                                <div className="form-group">
                                    <label>Số lượt IN qua cổng</label>
                                    <input
                                        type="number" min="1"
                                        placeholder="Để trống = Không giới hạn"
                                        value={tSessions} onChange={e => setTSessions(e.target.value ? Number(e.target.value) : '')}
                                        disabled={tCategory === 'DAILY'} // Daily auto assumes 1 behind the scenes
                                    />
                                    {tCategory === 'DAILY' && <span style={{ fontSize: '11px', color: 'gray' }}>Vé Lẻ tự mặc định 1 lượt</span>}
                                </div>
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowTicketModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Promotions Modal */}
            {showPromoModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '500px' }}>
                        <h2>{editingPromo ? 'Sửa Khuyến mãi' : 'Thêm Khuyến mãi mới'}</h2>
                        <form onSubmit={handleSavePromo}>
                            <div className="form-group">
                                <label>Tên CT Khuyến Mãi (VD: Khai trương giảm 10%)</label>
                                <input type="text" required value={pName} onChange={e => setPName(e.target.value)} />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Hình thức KM</label>
                                    <select value={pType} onChange={e => setPType(e.target.value as any)}>
                                        <option value="AMOUNT">Trừ tiền gộp (VND)</option>
                                        <option value="PERCENT">Biết khấu tỷ lệ (%)</option>
                                        <option value="BONUS_SESSION">Tặng thêm luợt bơi</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    <label>Giá trị (Tiền / Tỷ lệ / Số buổi)</label>
                                    <input type="number" min="1" required value={pValue} onChange={e => setPValue(Number(e.target.value))} />
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '8px' }}>Thời hạn áp dụng</label>
                                <div style={{ display: 'flex', gap: '20px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            name="promoUnlimited"
                                            checked={isUnlimitedPromo}
                                            onChange={() => setIsUnlimitedPromo(true)}
                                        />
                                        Bất kỳ lúc nào (Không bao giờ hết hạn)
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            name="promoUnlimited"
                                            checked={!isUnlimitedPromo}
                                            onChange={() => setIsUnlimitedPromo(false)}
                                        />
                                        Có thời hạn cụ thể
                                    </label>
                                </div>
                            </div>

                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '8px' }}>Áp dụng cho loại vé</label>
                                <div style={{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            checked={pAllTickets}
                                            onChange={() => setPAllTickets(true)}
                                        />
                                        Tất cả loại vé
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            checked={!pAllTickets}
                                            onChange={() => setPAllTickets(false)}
                                        />
                                        Chỉ các vé được chọn
                                    </label>
                                </div>
                                {!pAllTickets && (
                                    <div style={{ background: 'var(--bg-hover, #f8fafc)', padding: '12px', borderRadius: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color, #e2e8f0)' }}>
                                        {ticketTypes.map(t => (
                                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', marginBottom: '8px', fontSize: '14px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={pSelectedTickets.includes(t.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setPSelectedTickets(prev => [...prev, t.id]);
                                                        } else {
                                                            setPSelectedTickets(prev => prev.filter(id => id !== t.id));
                                                        }
                                                    }}
                                                />
                                                {t.name} <span style={{ color: 'var(--text-secondary, #64748b)' }}>({t.category === 'DAILY' ? 'Vé lẻ' : t.category === 'MULTI' ? 'Gói nhiều buổi' : 'Vé tháng/năm'})</span>
                                            </label>
                                        ))}
                                        {ticketTypes.length === 0 && <div style={{ fontSize: '13px', color: 'gray' }}>Chưa có loại vé nào.</div>}
                                    </div>
                                )}
                            </div>

                            {/* LESSON PACKAGES SELECTION */}
                            <div className="form-group" style={{ marginBottom: '16px' }}>
                                <label style={{ display: 'block', marginBottom: '8px' }}>📚 Áp dụng cho gói khóa học</label>
                                <div style={{ display: 'flex', gap: '20px', marginBottom: '12px' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            checked={pAllLessons}
                                            onChange={() => setPAllLessons(true)}
                                        />
                                        Không áp dụng / Tất cả
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', margin: 0 }}>
                                        <input
                                            type="radio"
                                            checked={!pAllLessons}
                                            onChange={() => setPAllLessons(false)}
                                        />
                                        Chỉ các gói được chọn
                                    </label>
                                </div>
                                {!pAllLessons && (
                                    <div style={{ background: 'var(--bg-hover, #f8fafc)', padding: '12px', borderRadius: '8px', maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--border-color, #e2e8f0)' }}>
                                        {lessonTypes.map(t => (
                                            <label key={t.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontWeight: 'normal', marginBottom: '8px', fontSize: '14px' }}>
                                                <input
                                                    type="checkbox"
                                                    checked={pSelectedLessons.includes(t.id)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setPSelectedLessons(prev => [...prev, t.id]);
                                                        } else {
                                                            setPSelectedLessons(prev => prev.filter(id => id !== t.id));
                                                        }
                                                    }}
                                                />
                                                {t.name} <span style={{ color: 'var(--text-secondary, #64748b)' }}>({t.lesson_class_type === 'GROUP' ? 'Lớp nhóm' : t.lesson_class_type === 'ONE_ON_ONE' ? '1 kèm 1' : '1 kèm 2'})</span>
                                            </label>
                                        ))}
                                        {lessonTypes.length === 0 && <div style={{ fontSize: '13px', color: 'gray' }}>Chưa có gói khóa học nào.</div>}
                                    </div>
                                )}
                            </div>

                            {!isUnlimitedPromo && (
                                <div className="form-row" style={{ animation: 'fadeIn 0.3s ease' }}>
                                    <div className="form-group">
                                        <label>Từ ngày (Bắt buộc)</label>
                                        <input type="datetime-local" required value={pFrom} onChange={e => setPFrom(e.target.value)} />
                                    </div>
                                    <div className="form-group">
                                        <label>Đến ngày (Bắt buộc)</label>
                                        <input type="datetime-local" required value={pUntil} onChange={e => setPUntil(e.target.value)} />
                                    </div>
                                </div>
                            )}

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowPromoModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu cài đặt'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* ============ LESSON PACKAGES TAB ============ */}
            {activeTab === 'lessons' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    <div className="dashboard-content-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                            <h2 style={{ fontSize: '18px', margin: 0 }}>📚 Gói Khóa Học Bơi</h2>
                            <button className="btn btn-primary btn-sm" onClick={openNewLessonModal}>
                                ➕ Tạo gói mới
                            </button>
                        </div>

                        <div className="table-responsive">
                            <table className="data-table">
                                <thead>
                                    <tr>
                                        <th>Tên gói</th>
                                        <th>Loại lớp</th>
                                        <th>Số buổi</th>
                                        <th>Thời gian</th>
                                        <th>Lịch học</th>
                                        <th>Giá</th>
                                        <th>Trạng thái</th>
                                        <th>Thao tác</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {lessonTypes.map(t => (
                                        <tr key={t.id} style={{ opacity: t.is_active ? 1 : 0.5 }}>
                                            <td>
                                                <strong>{t.name}</strong>
                                                {t.description && <div style={{ fontSize: '11px', color: '#64748b' }}>{t.description}</div>}
                                            </td>
                                            <td>
                                                <span className="badge badge-outline" style={{ fontSize: '11px' }}>
                                                    {t.lesson_class_type === 'GROUP' ? '👥 Lớp nhóm' : t.lesson_class_type === 'ONE_ON_ONE' ? '🧑‍🏫 1 kèm 1' : '🧑‍🏫 1 kèm 2'}
                                                </span>
                                            </td>
                                            <td style={{ fontWeight: 600 }}>{t.session_count || '—'} buổi</td>
                                            <td>{t.duration_unit === 'months' ? `${t.duration_months} tháng` : t.duration_unit === 'days' ? `${t.validity_days} ngày` : '—'}</td>
                                            <td style={{ fontSize: '12px', maxWidth: '200px' }}>
                                                {formatScheduleSummary(t.id, t.lesson_class_type, t.lesson_schedule_type)}
                                            </td>
                                            <td style={{ fontWeight: 600, color: 'var(--accent-green)' }}>
                                                {(t.lesson_class_type === 'ONE_ON_ONE' || t.lesson_class_type === 'ONE_ON_TWO') && t.age_price_tiers?.length ? (
                                                    <span style={{ fontSize: '13px' }}>Tính theo độ tuổi</span>
                                                ) : (
                                                    <>{t.price.toLocaleString('vi-VN')}đ{(t.lesson_class_type === 'ONE_ON_ONE' || t.lesson_class_type === 'ONE_ON_TWO') ? ' / buổi' : ''}</>
                                                )}
                                            </td>
                                            <td>
                                                <button
                                                    className={`badge ${t.is_active ? 'badge-success' : 'badge-error'}`}
                                                    onClick={() => toggleLessonActive(t.id, t.is_active)}
                                                    style={{ cursor: 'pointer', border: 'none' }}
                                                >
                                                    {t.is_active ? 'Đang bán' : 'Đã ẩn'}
                                                </button>
                                            </td>
                                            <td>
                                                <button className="btn btn-ghost btn-sm" onClick={() => openEditLessonModal(t)}>✏️ Sửa</button>
                                                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--alert-red)', marginLeft: '8px' }} onClick={() => handleDeleteLesson(t.id)}>🗑️ Xóa</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {lessonTypes.length === 0 && (
                                        <tr><td colSpan={8} style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>Chưa có gói khóa học bơi nào.</td></tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* ============ LESSON MODAL ============ */}
            {showLessonModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '600px' }}>
                        <h2>{editingLesson ? 'Sửa Gói Khóa Học' : 'Tạo Gói Khóa Học Mới'}</h2>
                        <form onSubmit={handleSaveLesson}>
                            <div className="form-group">
                                <label>Tên gói học <span style={{ color: 'red' }}>*</span></label>
                                <input type="text" required value={lName} onChange={e => setLName(e.target.value)} placeholder="VD: Khóa cơ bản trẻ em" />
                            </div>

                            <div className="form-row">
                                <div className="form-group">
                                    <label>Loại lớp <span style={{ color: 'red' }}>*</span></label>
                                    <select value={lClassType} onChange={e => {
                                        setLClassType(e.target.value as any);
                                        if (e.target.value === 'GROUP') setLAgeTiers([]);
                                    }}>
                                        <option value="GROUP">👥 Lớp bơi nhóm</option>
                                        <option value="ONE_ON_ONE">🧑‍🏫 1 kèm 1</option>
                                        <option value="ONE_ON_TWO">🧑‍🏫 1 kèm 2</option>
                                    </select>
                                </div>
                                <div className="form-group">
                                    {lClassType === 'GROUP' ? (
                                        <>
                                            <label>Giá trọn gói (VND) <span style={{ color: 'red' }}>*</span></label>
                                            <input type="number" min="0" required value={lPrice} onChange={e => setLPrice(Number(e.target.value))} />
                                        </>
                                    ) : (
                                        <>
                                            <label>Đơn giá / buổi mặc định (VND)</label>
                                            <input type="number" min="0" value={lPrice} onChange={e => setLPrice(Number(e.target.value))} />
                                            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>Giá này áp dụng nếu khách không thuộc độ tuổi cấu hình bên dưới.</div>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Age Pricing Tiers specific for ONE_ON_ONE and ONE_ON_TWO */}
                            {lClassType !== 'GROUP' && (
                                <div style={{ marginBottom: '16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                        <label style={{ margin: 0 }}>Cấu hình giá theo nhóm tuổi</label>
                                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLAgeTiers([...lAgeTiers, { minAge: 0, maxAge: 99, price: lPrice }])}>
                                            + Thêm mức giá
                                        </button>
                                    </div>
                                    {lAgeTiers.length === 0 && <div style={{ fontSize: '12px', color: '#64748b', fontStyle: 'italic' }}>Chưa cấu hình. Sẽ áp dụng Đơn giá mặc định bên trên cho tất cả học viên.</div>}
                                    {lAgeTiers.map((tier, idx) => (
                                        <div key={idx} style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '8px' }}>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span style={{ fontSize: '13px', color: '#64748b', width: '20px' }}>Từ</span>
                                                <input type="number" min="0" required value={tier.minAge} style={{ padding: '6px', fontSize: '13px', width: '60px' }}
                                                    onChange={e => {
                                                        const newTiers = [...lAgeTiers];
                                                        newTiers[idx].minAge = Number(e.target.value);
                                                        setLAgeTiers(newTiers);
                                                    }}
                                                />
                                            </div>
                                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <span style={{ fontSize: '13px', color: '#64748b', width: '20px' }}>đến</span>
                                                <input type="number" min="0" required value={tier.maxAge} style={{ padding: '6px', fontSize: '13px', width: '60px' }}
                                                    onChange={e => {
                                                        const newTiers = [...lAgeTiers];
                                                        newTiers[idx].maxAge = Number(e.target.value);
                                                        setLAgeTiers(newTiers);
                                                    }}
                                                />
                                                <span style={{ fontSize: '13px', color: '#64748b' }}>tuổi:</span>
                                            </div>
                                            <div style={{ flex: '0 0 140px' }}>
                                                <input type="number" min="0" required value={tier.price} placeholder="Đơn giá / buổi" style={{ padding: '6px', fontSize: '13px' }}
                                                    onChange={e => {
                                                        const newTiers = [...lAgeTiers];
                                                        newTiers[idx].price = Number(e.target.value);
                                                        setLAgeTiers(newTiers);
                                                    }}
                                                />
                                            </div>
                                            <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'red', padding: '0 8px' }}
                                                onClick={() => {
                                                    const newTiers = lAgeTiers.filter((_, i) => i !== idx);
                                                    setLAgeTiers(newTiers);
                                                }}>
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {lClassType === 'GROUP' && (
                                <div className="form-row">
                                    <div className="form-group">
                                        <label>Số buổi học <span style={{ color: 'red' }}>*</span></label>
                                        <input type="number" min="1" required value={lSessions} onChange={e => setLSessions(e.target.value ? Number(e.target.value) : '')} />
                                    </div>
                                    <div className="form-group">
                                        <label>Thời gian học <span style={{ color: 'red' }}>*</span></label>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <input type="number" min="1" step={lDurationUnit === 'months' ? '0.5' : '1'} required
                                                value={lDurationVal}
                                                onChange={e => setLDurationVal(e.target.value ? Number(e.target.value) : '')}
                                                style={{ flex: 1 }}
                                            />
                                            <select value={lDurationUnit} onChange={e => setLDurationUnit(e.target.value as any)} style={{ width: '100px' }}>
                                                <option value="months">Tháng</option>
                                                <option value="days">Ngày</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="form-group">
                                <label>Ghi chú (Tùy chọn)</label>
                                <input type="text" value={lDesc} onChange={e => setLDesc(e.target.value)} placeholder="Ghi chú hiển thị cho nhân viên" />
                            </div>

                            {/* SCHEDULE SECTION */}
                            <div style={{ marginTop: '16px', padding: '16px', background: '#f8fafc', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                                <h3 style={{ fontSize: '14px', marginBottom: '12px', color: '#334155' }}>
                                    📅 Lịch học
                                    {lClassType === 'GROUP' ? ' (Cố định)' : ' (Tự do)'}
                                </h3>

                                {lClassType === 'GROUP' ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {lSchedules.map((s, i) => (
                                            <div key={s.day} style={{ display: 'flex', alignItems: 'center', gap: '10px', opacity: s.enabled ? 1 : 0.4 }}>
                                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', width: '100px', cursor: 'pointer', margin: 0, fontWeight: 'normal', fontSize: '13px' }}>
                                                    <input type="checkbox" checked={s.enabled}
                                                        onChange={e => {
                                                            const newS = [...lSchedules];
                                                            newS[i] = { ...newS[i], enabled: e.target.checked };
                                                            setLSchedules(newS);
                                                        }}
                                                        style={{ accentColor: '#10b981' }}
                                                    />
                                                    {dayNames[s.day]}
                                                </label>
                                                <input type="time" value={s.start} disabled={!s.enabled}
                                                    onChange={e => { const newS = [...lSchedules]; newS[i] = { ...newS[i], start: e.target.value }; setLSchedules(newS); }}
                                                    style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                                                />
                                                <span style={{ color: '#94a3b8' }}>→</span>
                                                <input type="time" value={s.end} disabled={!s.enabled}
                                                    onChange={e => { const newS = [...lSchedules]; newS[i] = { ...newS[i], end: e.target.value }; setLSchedules(newS); }}
                                                    style={{ padding: '4px 8px', borderRadius: '6px', border: '1px solid #e2e8f0', fontSize: '13px' }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div style={{ padding: '16px', textAlign: 'center', color: '#64748b', fontSize: '13px', background: '#fff', borderRadius: '8px' }}>
                                        📋 <strong>Lịch tự do</strong> — Khách hẹn trực tiếp với huấn luyện viên.
                                    </div>
                                )}
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowLessonModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang lưu...' : 'Lưu'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}


            {/* ============ CARDS BANK TAB ============ */}
            {activeTab === 'cards' && (
                <div className="tab-content" style={{ animation: 'fadeIn 0.3s ease' }}>
                    {/* Check Card Block */}
                    <div className="dashboard-content-card" style={{ marginBottom: '24px' }}>
                        <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>🔍 Kiểm tra trạng thái mã thẻ</h2>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                            <input
                                type="text"
                                className="form-control"
                                placeholder="Nhập mã thẻ cần kiểm tra..."
                                value={checkCardCode}
                                onChange={e => setCheckCardCode(e.target.value.toUpperCase())}
                                style={{ flex: 1, maxWidth: '400px', textTransform: 'uppercase' }}
                                onKeyDown={e => { if (e.key === 'Enter') handleCheckCard(); }}
                            />
                            <button
                                className="btn btn-primary"
                                onClick={handleCheckCard}
                                disabled={checkingCard || !checkCardCode.trim()}
                            >
                                {checkingCard ? 'Đang kiểm tra...' : 'Kiểm tra'}
                            </button>
                        </div>
                        {checkCardResult && (
                            <div style={{ marginTop: '16px', padding: '16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: '#f8fafc', animation: 'fadeIn 0.2s ease' }}>
                                {checkCardResult.exists && checkCardResult.data ? (
                                    <div>
                                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--accent-green)', marginBottom: '12px' }}>
                                            ✅ Thẻ tồn tại trong hệ thống
                                        </div>
                                        <div style={{ fontSize: '14px', color: '#334155', display: 'grid', gridTemplateColumns: 'minmax(120px, auto) 1fr', gap: '8px', alignItems: 'center' }}>
                                            <div style={{ color: 'var(--text-secondary)' }}>Mã thẻ:</div>
                                            <div><span style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '15px', background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>{checkCardResult.data.card_code}</span></div>
                                            
                                            <div style={{ color: 'var(--text-secondary)' }}>Trạng thái:</div>
                                            <div>
                                                <span className={`badge ${checkCardResult.data.status === 'UNUSED' ? 'badge-success' : checkCardResult.data.status === 'USED' ? 'badge-primary' : 'badge-error'}`}>
                                                    {checkCardResult.data.status === 'UNUSED' ? 'Chưa sử dụng' : checkCardResult.data.status === 'USED' ? 'Đã sử dụng' : checkCardResult.data.status}
                                                </span>
                                            </div>
                                            
                                            <div style={{ color: 'var(--text-secondary)' }}>Nguồn gốc:</div>
                                            <div>{checkCardResult.data.source === 'SYSTEM' ? 'Hệ thống tạo tự động' : 'Nhập thủ công/Import'}</div>
                                            
                                            {checkCardResult.data.batch_number && (
                                                <>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Lô số:</div>
                                                    <div>Lô {checkCardResult.data.batch_number}</div>
                                                </>
                                            )}
                                            
                                            {checkCardResult.data.batch_note && (
                                                <>
                                                    <div style={{ color: 'var(--text-secondary)' }}>Ghi chú:</div>
                                                    <div>{checkCardResult.data.batch_note}</div>
                                                </>
                                            )}
                                            
                                            <div style={{ color: 'var(--text-secondary)' }}>Ngày tạo:</div>
                                            <div>{new Date(checkCardResult.data.created_at).toLocaleString('vi-VN')}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--alert-red)' }}>
                                        ❌ Mã thẻ "{checkCardCode.toUpperCase()}" KHÔNG TỒN TẠI trong hệ thống.
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Sub-tabs */}
                    <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
                        <button
                            className={`btn ${cardSubTab === 'system' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setCardSubTab('system')}
                            style={{ padding: '8px 20px' }}
                        >
                            🏭 Thẻ Hệ Thống ({cards.filter(c => !c.source || c.source === 'SYSTEM').length})
                        </button>
                        <button
                            className={`btn ${cardSubTab === 'manual' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setCardSubTab('manual')}
                            style={{ padding: '8px 20px' }}
                        >
                            ✏️ Thẻ Thủ Công ({cards.filter(c => c.source === 'MANUAL').length})
                        </button>
                        <button
                            className={`btn ${cardSubTab === 'batches' ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setCardSubTab('batches')}
                            style={{ padding: '8px 20px' }}
                        >
                            📦 Quản lý Lô Thẻ ({cardBatches.length})
                        </button>
                    </div>

                    {/* SUB-TAB: Thẻ Hệ Thống */}
                    {cardSubTab === 'system' && (
                        <div className="form-row">
                            <div className="dashboard-content-card" style={{ flex: 1 }}>
                                <h2 style={{ fontSize: '18px', marginBottom: '16px' }}>Tạo Lô Thẻ Mới</h2>
                                <form onSubmit={handleGenerateCards} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <div className="form-group">
                                        <label>Tiền tố (Gợi ý: HB = Hồ bơi)</label>
                                        <input type="text" className="form-control" required value={cbPrefix} onChange={e => setCbPrefix(e.target.value)} maxLength={5} placeholder="VD: HB" />
                                    </div>
                                    <div className="form-group">
                                        <label>Số lượng thẻ muốn tạo</label>
                                        <input type="number" className="form-control" required min="1" max="1000" value={cbQuantity} onChange={e => setCbQuantity(e.target.value ? Number(e.target.value) : '')} placeholder="VD: 50" />
                                    </div>
                                    <div className="form-group">
                                        <label>Ghi chú Lô thẻ (Tùy chọn)</label>
                                        <input type="text" className="form-control" value={cbBatchNote} onChange={e => setCbBatchNote(e.target.value)} placeholder="VD: Khai trương chi nhánh mới" />
                                    </div>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        Cấu trúc thẻ: <b>[Tiền tố] + [ThángNăm] + [Số thứ tự 5 số] + [6 Ký tự ngẫu nhiên]</b><br />
                                        Ví dụ: <b>{cbPrefix || 'HB'}{String(new Date().getMonth() + 1).padStart(2, '0')}{String(new Date().getFullYear()).slice(2)}00001A1B2C</b>
                                    </div>
                                    <button type="submit" className="btn btn-primary" disabled={saving}>
                                        {saving ? 'Đang tạo...' : 'Tạo Lô Thẻ'}
                                    </button>
                                </form>
                            </div>

                            <div className="dashboard-content-card" style={{ flex: 2 }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                                    <div>
                                        <h2 style={{ fontSize: '18px', margin: 0, marginBottom: '8px' }}>Kho Thẻ Hệ Thống</h2>
                                        <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            Bạn có {cards.filter(c => (!c.source || c.source === 'SYSTEM') && c.status === 'UNUSED').length} thẻ chưa sử dụng.
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                        <select
                                            className="form-control"
                                            value={filterBatch}
                                            onChange={(e) => setFilterBatch(e.target.value === 'ALL' ? 'ALL' : Number(e.target.value))}
                                            style={{ minWidth: '150px' }}
                                        >
                                            <option value="ALL">Tất cả lô thẻ</option>
                                            {Array.from(new Set(cards.filter(c => (!c.source || c.source === 'SYSTEM') && c.batch_number).map(c => c.batch_number as number)))
                                                .sort((a, b) => b - a)
                                                .map(batch => (
                                                    <option key={batch} value={batch}>Lô {batch}</option>
                                                ))
                                            }
                                        </select>
                                        <button
                                            className="btn btn-outline"
                                            onClick={exportCardsToExcel}
                                            disabled={
                                                cards.filter(c => (!c.source || c.source === 'SYSTEM') && c.status === 'UNUSED' && (filterBatch === 'ALL' || c.batch_number === filterBatch)).length === 0
                                            }
                                        >
                                            📥 Xuất Excel (.xlsx)
                                        </button>
                                    </div>
                                </div>

                                <div className="table-responsive" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    <table className="data-table">
                                        <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                                            <tr>
                                                <th>Mã Thẻ</th>
                                                <th>Số Lô</th>
                                                <th>Ghi chú</th>
                                                <th>Trạng Thái</th>
                                                <th>Người Tạo</th>
                                                <th>Ngày Tạo</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {cards.filter(c => (!c.source || c.source === 'SYSTEM') && (filterBatch === 'ALL' || c.batch_number === filterBatch))
                                                .slice(0, 100).map(c => (
                                                    <tr key={c.id}>
                                                        <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{c.card_code}</td>
                                                        <td>{c.batch_number ? `Lô ${c.batch_number}` : '—'}</td>
                                                        <td style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>{c.batch_note || '—'}</td>
                                                        <td>
                                                            <span className={`badge ${c.status === 'UNUSED' ? 'badge-success' : c.status === 'USED' ? 'badge-primary' : 'badge-error'}`}>
                                                                {c.status}
                                                            </span>
                                                        </td>
                                                        <td style={{ fontSize: '12px' }}>{c.created_by?.substring(0, 8)}...</td>
                                                        <td style={{ fontSize: '12px' }}>{new Date(c.created_at).toLocaleString('vi-VN')}</td>
                                                    </tr>
                                                ))}
                                            {cards.filter(c => (!c.source || c.source === 'SYSTEM') && (filterBatch === 'ALL' || c.batch_number === filterBatch)).length === 0 && (
                                                <tr><td colSpan={6} style={{ textAlign: 'center' }}>Chưa có thẻ hệ thống nào hoặc không khớp bộ lọc.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* SUB-TAB: Thẻ Thủ Công */}
                    {cardSubTab === 'manual' && (
                        <div className="dashboard-content-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '16px' }}>
                                <div>
                                    <h2 style={{ fontSize: '18px', margin: 0 }}>Kho Thẻ Thủ Công</h2>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        Các mã thẻ được import từ hệ thống cũ hoặc nhập thủ công định danh.
                                    </div>
                                </div>
                                <form onSubmit={handleAddManualCard} style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <input
                                        type="text"
                                        className="form-control"
                                        placeholder="Nhập mã thẻ mới..."
                                        value={manualCardCode}
                                        onChange={e => setManualCardCode(e.target.value.toUpperCase())}
                                        style={{ textTransform: 'uppercase', width: '250px' }}
                                        required
                                    />
                                    <button type="submit" className="btn btn-primary btn-sm" disabled={addingManualCard || !manualCardCode.trim()}>
                                        {addingManualCard ? 'Đang thêm...' : '➕ Thêm thẻ'}
                                    </button>
                                </form>
                            </div>

                            <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                <table className="data-table">
                                    <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                                        <tr>
                                            <th>Mã Thẻ</th>
                                            <th>Trạng Thái</th>
                                            <th>Ngày Tạo</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cards.filter(c => c.source === 'MANUAL').map(c => (
                                            <tr key={c.id}>
                                                <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>{c.card_code}</td>
                                                <td>
                                                    <span className={`badge ${c.status === 'UNUSED' ? 'badge-success' : c.status === 'USED' ? 'badge-primary' : 'badge-error'}`}>
                                                        {c.status}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '12px' }}>{new Date(c.created_at).toLocaleString('vi-VN')}</td>
                                            </tr>
                                        ))}
                                        {cards.filter(c => c.source === 'MANUAL').length === 0 && (
                                            <tr><td colSpan={3} style={{ textAlign: 'center' }}>Chưa có thẻ thủ công nào. Hãy import khách hàng cũ từ trang Khách hàng.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* SUB-TAB: Lô Thẻ */}
                    {cardSubTab === 'batches' && (
                        <div className="dashboard-content-card">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                <div>
                                    <h2 style={{ fontSize: '18px', margin: 0 }}>Quản lý Lô Thẻ</h2>
                                    <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                                        Danh sách các lô thẻ được tạo tự động bởi hệ thống và Import từ file .txt
                                    </div>
                                </div>
                                <button className="btn btn-primary btn-sm" onClick={() => { setCbBatchNote(''); setBatchTxtFile(null); setShowBatchModal(true); }}>
                                    📥 Import Lô Thẻ (TXT)
                                </button>
                            </div>

                            <div className="table-responsive" style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                <table className="data-table">
                                    <thead style={{ position: 'sticky', top: 0, background: '#fff' }}>
                                        <tr>
                                            <th>Số Lô</th>
                                            <th>Ghi Chú</th>
                                            <th style={{ textAlign: 'right' }}>Tổng Số Thẻ</th>
                                            <th style={{ textAlign: 'right' }}>Chưa Dùng</th>
                                            <th style={{ textAlign: 'right' }}>Đã Dùng</th>
                                            <th>Ngày Tạo</th>
                                            <th>Thao tác</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {cardBatches.map(b => (
                                            <tr key={b.batch_number}>
                                                <td style={{ fontWeight: 'bold' }}>Lô {b.batch_number}</td>
                                                <td>{b.batch_note || '—'}</td>
                                                <td style={{ textAlign: 'right', fontWeight: 'bold' }}>{b.total_cards}</td>
                                                <td style={{ textAlign: 'right', color: 'var(--accent-green)' }}>{b.unused_cards}</td>
                                                <td style={{ textAlign: 'right', color: 'var(--alert-red)' }}>{b.used_cards}</td>
                                                <td style={{ fontSize: '12px' }}>{new Date(b.created_at).toLocaleString('vi-VN')}</td>
                                                <td>
                                                    <button
                                                        className="btn btn-ghost btn-sm"
                                                        style={{ color: 'var(--alert-red)' }}
                                                        onClick={() => handleDeleteBatch(b.batch_number)}
                                                        disabled={b.used_cards > 0}
                                                        title={b.used_cards > 0 ? "Không thể xóa lô đã có thẻ đang sử dụng" : "Xóa vĩnh viễn toàn bộ lô thẻ"}
                                                    >
                                                        🗑️ Xóa Lô
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                        {cardBatches.length === 0 && (
                                            <tr><td colSpan={7} style={{ textAlign: 'center' }}>Chưa có lô thẻ nào được tạo.</td></tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Batch Import Modal */}
            {showBatchModal && (
                <div className="modal-overlay">
                    <div className="modal-card" style={{ maxWidth: '500px' }}>
                        <h2>Import Lô Thẻ Mới</h2>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                            Hệ thống sẽ tạo lô thẻ mới từ file .txt của bạn (Mỗi dòng một mã thẻ). Các thẻ trùng lặp nội bộ file hoặc đã tồn tại trên hệ thống sẽ bị bỏ qua.
                        </p>
                        <form onSubmit={handleImportBatch}>
                            <div className="form-group">
                                <label>Ghi chú Lô thẻ mới (Tùy chọn)</label>
                                <input type="text" className="form-control" value={cbBatchNote} onChange={e => setCbBatchNote(e.target.value)} placeholder="VD: Lô thẻ nhập từ xưởng tháng 10" />
                            </div>

                            <div className="form-group">
                                <label>Đính kèm File (.txt) <span style={{ color: 'red' }}>*</span></label>
                                <input
                                    type="file"
                                    accept=".txt"
                                    className="form-control"
                                    style={{ padding: '8px' }}
                                    onChange={e => setBatchTxtFile(e.target.files && e.target.files.length > 0 ? e.target.files[0] : null)}
                                    required
                                />
                                {batchTxtFile && <div style={{ fontSize: '13px', color: 'var(--accent-green)', marginTop: '4px' }}>Đã chọn: {batchTxtFile.name}</div>}
                            </div>

                            <div className="modal-actions" style={{ marginTop: '24px' }}>
                                <button type="button" className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setShowBatchModal(false)} disabled={saving}>Hủy</button>
                                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>{saving ? 'Đang tải lên...' : 'Bắt đầu Import'}</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

        </div>
    );
}
