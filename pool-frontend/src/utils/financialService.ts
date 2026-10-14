/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../lib/supabase';
import type {
    FinancialCategory,
    FixedCostTemplate,
    FinancialTransaction,
    PaymentMethodType,
    FundSourceType,
    FinancialType,
    CostType
} from '../types';

const SETTINGS_KEYS = {
    CATEGORIES: 'pnl_categories_v1',
    TEMPLATES: 'pnl_fixed_templates_v1',
    TRANSACTIONS: 'pnl_transactions_v1',
};

export const DEFAULT_FINANCIAL_CATEGORIES: FinancialCategory[] = [
    // ĐỊNH PHÍ (FIXED COSTS - Chi phí cố định hàng tháng tối thiểu phải có)
    {
        id: '11111111-0001-4000-8000-000000000001',
        name: 'Thuê mặt bằng / Khấu hao cơ sở hạ tầng',
        type: 'EXPENSE',
        cost_type: 'FIXED',
        description: 'Tiền thuê đất, mặt bằng hoặc trích khấu hao xây dựng hồ bơi, mái che, hệ thống lọc',
        sort_order: 10,
        is_system: true,
        is_active: true,
    },
    {
        id: '11111111-0001-4000-8000-000000000002',
        name: 'Lương cơ bản nhân sự cố định',
        type: 'EXPENSE',
        cost_type: 'FIXED',
        description: 'Lương cứng Quản lý, Lễ tân/Thu ngân, Soát vé, Cứu hộ, Bảo vệ, Tạp vụ',
        sort_order: 20,
        is_system: true,
        is_active: true,
    },
    {
        id: '11111111-0001-4000-8000-000000000003',
        name: 'BHXH, BHYT & Phúc lợi cố định',
        type: 'EXPENSE',
        cost_type: 'FIXED',
        description: 'Chi phí bảo hiểm bắt buộc, phụ cấp ăn ca/đồng phục định kỳ hàng tháng',
        sort_order: 30,
        is_system: true,
        is_active: true,
    },
    {
        id: '11111111-0001-4000-8000-000000000004',
        name: 'Internet, Phần mềm & Viễn thông',
        type: 'EXPENSE',
        cost_type: 'FIXED',
        description: 'Cước cáp quang, phần mềm quản lý, tên miền/máy chủ, điện thoại cố định',
        sort_order: 40,
        is_system: true,
        is_active: true,
    },
    {
        id: '11111111-0001-4000-8000-000000000005',
        name: 'Bảo trì định kỳ thiết bị & Hệ thống lọc',
        type: 'EXPENSE',
        cost_type: 'FIXED',
        description: 'Chi phí bảo dưỡng định kỳ máy bơm tuần hoàn, bình lọc cát, máy gia nhiệt (Heat pump)',
        sort_order: 50,
        is_system: true,
        is_active: true,
    },

    // BIẾN PHÍ (VARIABLE COSTS - Chi phí biến đổi theo vận hành & mùa vụ)
    {
        id: '22222222-0002-4000-8000-000000000001',
        name: 'Hóa chất xử lý nước hồ bơi',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Chlorine (Clo), PAC lắng cặn, Soda nâng pH, Axit HCl, Đồng sunfat diệt rêu, thuốc thử nước',
        sort_order: 110,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000002',
        name: 'Tiền Điện & Nước cấp hồ bơi',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Điện vận hành bơm lọc, bơm nhiệt, chiếu sáng; Nước cấp bù bay hơi và sục rửa bình lọc',
        sort_order: 120,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000003',
        name: 'Thù lao & Hoa hồng Huấn luyện viên (HLV)',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Lương dạy bơi kèm, dạy nhóm, dạy bóng rổ và hoa hồng bán khóa học',
        sort_order: 130,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000004',
        name: 'Lương nhân viên thời vụ / Tăng ca',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Chi phí thuê cứu hộ, lễ tân part-time mùa cao điểm hoặc làm thêm giờ',
        sort_order: 140,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000005',
        name: 'Giá vốn nhập hàng bán lẻ (POS)',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Nhập nước giải khát, đồ ăn nhẹ, kính bơi, mũ bơi, phao bơi, đồ bơi',
        sort_order: 150,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000006',
        name: 'Vật tư tiêu hao & Vệ sinh',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Giấy in hóa đơn nhiệt, phôi thẻ từ RFID/QR, nước lau sàn, xà phòng, giấy vệ sinh',
        sort_order: 160,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000007',
        name: 'Sửa chữa thiết bị phát sinh',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Thay thế linh kiện hỏng đột xuất (vòi sen, đèn hồ, cổng xoay Tripod, đầu đọc thẻ...)',
        sort_order: 170,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000008',
        name: 'Marketing, Quảng cáo & Sự kiện',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Quảng cáo Facebook/Zalo, in ấn băng rôn chiêu sinh, tổ chức giải bơi',
        sort_order: 180,
        is_system: true,
        is_active: true,
    },
    {
        id: '22222222-0002-4000-8000-000000000009',
        name: 'Chi phí vận hành phát sinh khác',
        type: 'EXPENSE',
        cost_type: 'VARIABLE',
        description: 'Tiếp khách, phí ngân hàng/POS, chi phí hành chính đột xuất khác',
        sort_order: 190,
        is_system: true,
        is_active: true,
    },

    // THU KHÁC (OTHER INCOME - Ngoài bán vé & hàng POS)
    {
        id: '33333333-0003-4000-8000-000000000001',
        name: 'Cho thuê làn bơi / Thuê hồ tổ chức giải',
        type: 'INCOME',
        cost_type: null,
        description: 'Cho trường học, CLB, công ty thuê làn bơi tập luyện hoặc tổ chức thi đấu',
        sort_order: 210,
        is_system: true,
        is_active: true,
    },
    {
        id: '33333333-0003-4000-8000-000000000002',
        name: 'Thu phí dịch vụ phụ trợ (Thẻ từ, Tủ đồ, Khăn...)',
        type: 'INCOME',
        cost_type: null,
        description: 'Phí cấp lại thẻ từ bị mất/hỏng, phí thuê tủ khóa (locker), thuê đồ bơi/khăn tắm',
        sort_order: 220,
        is_system: true,
        is_active: true,
    },
    {
        id: '33333333-0003-4000-8000-000000000003',
        name: 'Thu tài trợ, Quảng cáo & Hợp tác',
        type: 'INCOME',
        cost_type: null,
        description: 'Thu tiền đặt biển quảng cáo tại hồ bơi, tài trợ giải đấu, hoa hồng đối tác',
        sort_order: 230,
        is_system: true,
        is_active: true,
    },
    {
        id: '33333333-0003-4000-8000-000000000004',
        name: 'Thu thanh lý & Thu nhập khác',
        type: 'INCOME',
        cost_type: null,
        description: 'Thanh lý thiết bị cũ, phế liệu, tiền đền bù hư hỏng tài sản, lãi tiền gửi',
        sort_order: 240,
        is_system: true,
        is_active: true,
    },
];

export const DEFAULT_FIXED_COST_TEMPLATES: FixedCostTemplate[] = [
    {
        id: '44444444-0004-4000-8000-000000000001',
        name: 'Tiền thuê mặt bằng / Khấu hao cơ sở hàng tháng',
        category_id: '11111111-0001-4000-8000-000000000001',
        default_amount: 0,
        default_payment_method: 'TRANSFER_COMPANY',
        day_of_month: 1,
        note: 'Chi phí mặt bằng hoặc trích khấu hao cố định hàng tháng',
        is_active: true,
    },
    {
        id: '44444444-0004-4000-8000-000000000002',
        name: 'Lương cơ bản bộ phận Quản lý, Lễ tân, Cứu hộ, Vệ sinh',
        category_id: '11111111-0001-4000-8000-000000000002',
        default_amount: 0,
        default_payment_method: 'TRANSFER_COMPANY',
        day_of_month: 5,
        note: 'Quỹ lương cứng nhân viên cố định hàng tháng',
        is_active: true,
    },
    {
        id: '44444444-0004-4000-8000-000000000003',
        name: 'Chi phí BHXH & Phụ cấp cố định nhân sự',
        category_id: '11111111-0001-4000-8000-000000000003',
        default_amount: 0,
        default_payment_method: 'TRANSFER_COMPANY',
        day_of_month: 5,
        note: 'Đóng BHXH và phụ cấp cố định hàng tháng',
        is_active: true,
    },
    {
        id: '44444444-0004-4000-8000-000000000004',
        name: 'Cước Internet cáp quang & Phần mềm quản lý',
        category_id: '11111111-0001-4000-8000-000000000004',
        default_amount: 0,
        default_payment_method: 'TRANSFER',
        day_of_month: 10,
        note: 'Cước viễn thông, phần mềm định kỳ',
        is_active: true,
    },
    {
        id: '44444444-0004-4000-8000-000000000005',
        name: 'Chi phí bảo trì định kỳ hệ thống lọc & bơm nhiệt',
        category_id: '11111111-0001-4000-8000-000000000005',
        default_amount: 0,
        default_payment_method: 'TRANSFER',
        day_of_month: 15,
        note: 'Khoán bảo dưỡng hệ thống kỹ thuật hàng tháng',
        is_active: true,
    },
];

function generateUUID(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

function isMissingTableError(error: any): boolean {
    if (!error) return false;
    const msg = (error.message || '').toLowerCase();
    const code = error.code || '';
    return (
        code === '42P01' ||
        code === 'PGRST205' ||
        msg.includes('relation') ||
        msg.includes('does not exist') ||
        msg.includes('schema cache') ||
        msg.includes('could not find the table')
    );
}

async function readSettingJson<T>(key: string, defaultVal: T): Promise<T> {
    const { data, error } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', key)
        .maybeSingle();

    if (error || !data || data.value === undefined || data.value === null) {
        return defaultVal;
    }

    try {
        if (typeof data.value === 'string') {
            return JSON.parse(data.value) as T;
        }
        return data.value as T;
    } catch {
        return defaultVal;
    }
}

async function writeSettingJson<T>(key: string, value: T, userId?: string): Promise<void> {
    const payload: any = {
        key,
        value,
        updated_at: new Date().toISOString(),
    };
    if (userId) payload.updated_by = userId;

    const { error } = await supabase
        .from('system_settings')
        .upsert(payload, { onConflict: 'key' });

    if (error) {
        throw new Error(error.message);
    }
}

// ============================================================
// 1. CATEGORIES MANAGEMENT
// ============================================================

export async function fetchFinancialCategories(): Promise<FinancialCategory[]> {
    const { data, error } = await supabase
        .from('financial_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

    if (!error && data) {
        if (data.length === 0) {
            return DEFAULT_FINANCIAL_CATEGORIES;
        }
        return data as FinancialCategory[];
    }

    if (isMissingTableError(error)) {
        const stored = await readSettingJson<FinancialCategory[]>(
            SETTINGS_KEYS.CATEGORIES,
            DEFAULT_FINANCIAL_CATEGORIES
        );
        return stored.length > 0 ? stored : DEFAULT_FINANCIAL_CATEGORIES;
    }

    return DEFAULT_FINANCIAL_CATEGORIES;
}

export async function saveFinancialCategory(
    category: Partial<FinancialCategory> & { name: string; type: FinancialType; cost_type: CostType },
    userId?: string
): Promise<FinancialCategory> {
    const now = new Date().toISOString();
    const record: FinancialCategory = {
        id: category.id || generateUUID(),
        name: category.name.trim(),
        type: category.type,
        cost_type: category.type === 'INCOME' ? null : (category.cost_type || 'VARIABLE'),
        description: category.description || null,
        sort_order: category.sort_order ?? 100,
        is_system: category.is_system ?? false,
        is_active: category.is_active ?? true,
        updated_at: now,
    };

    const { data, error } = await supabase
        .from('financial_categories')
        .upsert({
            id: record.id,
            name: record.name,
            type: record.type,
            cost_type: record.cost_type,
            description: record.description,
            sort_order: record.sort_order,
            is_system: record.is_system,
            is_active: record.is_active,
            updated_at: now,
        })
        .select()
        .single();

    if (!error && data) {
        return data as FinancialCategory;
    }

    if (isMissingTableError(error)) {
        const existing = await fetchFinancialCategories();
        const idx = existing.findIndex(c => c.id === record.id);
        const updated = idx >= 0
            ? existing.map(c => (c.id === record.id ? record : c))
            : [...existing, record];
        await writeSettingJson(SETTINGS_KEYS.CATEGORIES, updated, userId);
        return record;
    }

    throw new Error(error?.message || 'Không thể lưu danh mục thu/chi');
}

// ============================================================
// 2. FIXED COST TEMPLATES MANAGEMENT
// ============================================================

export async function fetchFixedCostTemplates(): Promise<FixedCostTemplate[]> {
    const { data, error } = await supabase
        .from('fixed_cost_templates')
        .select('*')
        .order('day_of_month', { ascending: true })
        .order('name', { ascending: true });

    if (!error && data) {
        if (data.length === 0) {
            return DEFAULT_FIXED_COST_TEMPLATES;
        }
        return data as FixedCostTemplate[];
    }

    if (isMissingTableError(error)) {
        const stored = await readSettingJson<FixedCostTemplate[]>(
            SETTINGS_KEYS.TEMPLATES,
            DEFAULT_FIXED_COST_TEMPLATES
        );
        return stored.length > 0 ? stored : DEFAULT_FIXED_COST_TEMPLATES;
    }

    return DEFAULT_FIXED_COST_TEMPLATES;
}

export async function saveFixedCostTemplate(
    template: Partial<FixedCostTemplate> & { name: string; default_amount: number },
    userId?: string
): Promise<FixedCostTemplate> {
    const now = new Date().toISOString();
    const record: FixedCostTemplate = {
        id: template.id || generateUUID(),
        name: template.name.trim(),
        category_id: template.category_id || '11111111-0001-4000-8000-000000000001',
        default_amount: Number(template.default_amount) || 0,
        default_payment_method: template.default_payment_method || 'TRANSFER_COMPANY',
        day_of_month: Math.min(28, Math.max(1, Number(template.day_of_month) || 1)),
        note: template.note || null,
        is_active: template.is_active ?? true,
        created_by: userId || null,
        updated_at: now,
    };

    const { data, error } = await supabase
        .from('fixed_cost_templates')
        .upsert({
            id: record.id,
            name: record.name,
            category_id: record.category_id,
            default_amount: record.default_amount,
            default_payment_method: record.default_payment_method,
            day_of_month: record.day_of_month,
            note: record.note,
            is_active: record.is_active,
            created_by: record.created_by,
            updated_at: now,
        })
        .select()
        .single();

    if (!error && data) {
        return data as FixedCostTemplate;
    }

    if (isMissingTableError(error)) {
        const existing = await fetchFixedCostTemplates();
        const idx = existing.findIndex(t => t.id === record.id);
        const updated = idx >= 0
            ? existing.map(t => (t.id === record.id ? record : t))
            : [...existing, record];
        await writeSettingJson(SETTINGS_KEYS.TEMPLATES, updated, userId);
        return record;
    }

    throw new Error(error?.message || 'Không thể lưu cấu hình định phí');
}

export async function deleteFixedCostTemplate(id: string, userId?: string): Promise<void> {
    const { error } = await supabase.from('fixed_cost_templates').delete().eq('id', id);
    if (!error) return;

    if (isMissingTableError(error)) {
        const existing = await fetchFixedCostTemplates();
        const updated = existing.filter(t => t.id !== id);
        await writeSettingJson(SETTINGS_KEYS.TEMPLATES, updated, userId);
        return;
    }

    throw new Error(error?.message || 'Không thể xóa định phí mẫu');
}

// ============================================================
// 3. FINANCIAL TRANSACTIONS (THU KHÁC / ĐỊNH PHÍ / BIẾN PHÍ)
// ============================================================

export async function fetchFinancialTransactions(
    fromDate: string,
    toDate: string
): Promise<FinancialTransaction[]> {
    const { data, error } = await supabase
        .from('financial_transactions')
        .select(`*, profiles:created_by(full_name)`)
        .gte('transaction_date', fromDate)
        .lte('transaction_date', toDate)
        .order('transaction_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (!error && data) {
        return data.map((row: any) => ({
            ...row,
            amount: Number(row.amount) || 0,
            created_by_name: row.profiles?.full_name || row.created_by_name || 'Admin',
        }));
    }

    if (isMissingTableError(error)) {
        const allTx = await readSettingJson<FinancialTransaction[]>(
            SETTINGS_KEYS.TRANSACTIONS,
            []
        );
        return allTx
            .filter(tx => tx.transaction_date >= fromDate && tx.transaction_date <= toDate)
            .sort((a, b) => {
                if (a.transaction_date !== b.transaction_date) {
                    return b.transaction_date.localeCompare(a.transaction_date);
                }
                return (b.created_at || '').localeCompare(a.created_at || '');
            });
    }

    return [];
}

export async function saveFinancialTransaction(
    tx: {
        id?: string;
        transaction_date: string;
        type: FinancialType;
        cost_type: CostType;
        category_id: string | null;
        category_name: string;
        amount: number;
        payment_method: PaymentMethodType;
        fund_source: FundSourceType;
        description: string;
        template_id?: string | null;
    },
    userId: string,
    userName: string
): Promise<FinancialTransaction> {
    const now = new Date().toISOString();
    const accounting_month = tx.transaction_date.slice(0, 7);
    const record: FinancialTransaction = {
        id: tx.id || generateUUID(),
        transaction_date: tx.transaction_date,
        accounting_month,
        type: tx.type,
        cost_type: tx.type === 'INCOME' ? null : (tx.cost_type || 'VARIABLE'),
        category_id: tx.category_id,
        category_name: tx.category_name,
        amount: Math.round(Number(tx.amount)),
        payment_method: tx.payment_method,
        fund_source: tx.fund_source,
        description: tx.description.trim(),
        template_id: tx.template_id || null,
        created_by: userId,
        created_by_name: userName,
        created_at: now,
        updated_at: now,
    };

    const { data, error } = await supabase
        .from('financial_transactions')
        .upsert({
            id: record.id,
            transaction_date: record.transaction_date,
            accounting_month: record.accounting_month,
            type: record.type,
            cost_type: record.cost_type,
            category_id: record.category_id,
            category_name: record.category_name,
            amount: record.amount,
            payment_method: record.payment_method,
            fund_source: record.fund_source,
            description: record.description,
            template_id: record.template_id,
            created_by: record.created_by,
        })
        .select()
        .single();

    if (!error && data) {
        return {
            ...(data as FinancialTransaction),
            amount: Number(data.amount),
            created_by_name: userName,
        };
    }

    if (isMissingTableError(error)) {
        const allTx = await readSettingJson<FinancialTransaction[]>(
            SETTINGS_KEYS.TRANSACTIONS,
            []
        );
        const idx = allTx.findIndex(item => item.id === record.id);
        const updated = idx >= 0
            ? allTx.map(item => (item.id === record.id ? { ...item, ...record, created_at: item.created_at } : item))
            : [record, ...allTx];
        await writeSettingJson(SETTINGS_KEYS.TRANSACTIONS, updated, userId);
        return record;
    }

    throw new Error(error?.message || 'Không thể lưu bút toán thu/chi');
}

export async function deleteFinancialTransaction(id: string, userId?: string): Promise<void> {
    const { error } = await supabase.from('financial_transactions').delete().eq('id', id);
    if (!error) return;

    if (isMissingTableError(error)) {
        const allTx = await readSettingJson<FinancialTransaction[]>(
            SETTINGS_KEYS.TRANSACTIONS,
            []
        );
        const updated = allTx.filter(item => item.id !== id);
        await writeSettingJson(SETTINGS_KEYS.TRANSACTIONS, updated, userId);
        return;
    }

    throw new Error(error?.message || 'Không thể xóa bút toán');
}

// ============================================================
// 4. APPLY FIXED COSTS BY CURRENT MONTH OR PERIOD RANGE
// ============================================================

export function getMonthsInRange(fromMonth: string, toMonth: string): string[] {
    const [startY, startM] = fromMonth.split('-').map(Number);
    const [endY, endM] = toMonth.split('-').map(Number);
    if (!startY || !startM || !endY || !endM) return [];

    const result: string[] = [];
    let y = startY;
    let m = startM;

    while (y < endY || (y === endY && m <= endM)) {
        result.push(`${y}-${String(m).padStart(2, '0')}`);
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
        if (result.length > 120) break; // safety cap 10 years
    }
    return result;
}

export interface FixedCostApplyItem {
    template: FixedCostTemplate;
    category_name: string;
    amount: number;
}

export async function applyFixedCostsForPeriod(params: {
    fromMonth: string; // YYYY-MM
    toMonth: string;   // YYYY-MM
    items: FixedCostApplyItem[];
    duplicateMode: 'SKIP_EXISTING' | 'OVERWRITE_EXISTING';
    userId: string;
    userName: string;
}): Promise<{ createdCount: number; updatedCount: number; skippedCount: number; monthsCount: number }> {
    const months = getMonthsInRange(params.fromMonth, params.toMonth);
    if (months.length === 0) {
        throw new Error('Khoảng tháng chọn không hợp lệ (Từ tháng phải nhỏ hơn hoặc bằng Đến tháng).');
    }

    const validItems = params.items.filter(it => it.amount > 0);
    if (validItems.length === 0) {
        throw new Error('Vui lòng nhập số tiền > 0 cho ít nhất 1 khoản định phí cần áp dụng.');
    }

    const firstDate = `${months[0]}-01`;
    const [lastY, lastM] = months[months.length - 1].split('-').map(Number);
    const lastDay = new Date(lastY, lastM, 0).getDate();
    const lastDate = `${months[months.length - 1]}-${String(lastDay).padStart(2, '0')}`;

    const existingInPeriod = await fetchFinancialTransactions(firstDate, lastDate);

    let createdCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (const monthStr of months) {
        const [y, m] = monthStr.split('-').map(Number);
        const maxDayInMonth = new Date(y, m, 0).getDate();

        for (const item of validItems) {
            const day = Math.min(maxDayInMonth, Math.max(1, item.template.day_of_month || 1));
            const txDate = `${monthStr}-${String(day).padStart(2, '0')}`;

            const matchedExisting = existingInPeriod.find(
                tx =>
                    tx.type === 'EXPENSE' &&
                    tx.cost_type === 'FIXED' &&
                    tx.accounting_month === monthStr &&
                    (tx.template_id === item.template.id ||
                        (tx.category_id === item.template.category_id && tx.description.includes(item.template.name)))
            );

            if (matchedExisting) {
                if (params.duplicateMode === 'SKIP_EXISTING') {
                    skippedCount += 1;
                    continue;
                } else {
                    await saveFinancialTransaction(
                        {
                            id: matchedExisting.id,
                            transaction_date: txDate,
                            type: 'EXPENSE',
                            cost_type: 'FIXED',
                            category_id: item.template.category_id,
                            category_name: item.category_name,
                            amount: item.amount,
                            payment_method: item.template.default_payment_method,
                            fund_source: 'COMPANY_FUND',
                            description: `[Định phí T${String(m).padStart(2, '0')}/${y}] ${item.template.name}${item.template.note ? ' — ' + item.template.note : ''}`,
                            template_id: item.template.id,
                        },
                        params.userId,
                        params.userName
                    );
                    updatedCount += 1;
                }
            } else {
                await saveFinancialTransaction(
                    {
                        transaction_date: txDate,
                        type: 'EXPENSE',
                        cost_type: 'FIXED',
                        category_id: item.template.category_id,
                        category_name: item.category_name,
                        amount: item.amount,
                        payment_method: item.template.default_payment_method,
                        fund_source: 'COMPANY_FUND',
                        description: `[Định phí T${String(m).padStart(2, '0')}/${y}] ${item.template.name}${item.template.note ? ' — ' + item.template.note : ''}`,
                        template_id: item.template.id,
                    },
                    params.userId,
                    params.userName
                );
                createdCount += 1;
            }
        }
    }

    return {
        createdCount,
        updatedCount,
        skippedCount,
        monthsCount: months.length,
    };
}
