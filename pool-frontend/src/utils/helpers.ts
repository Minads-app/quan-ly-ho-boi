/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from '../lib/supabase';
import type { BusinessInfo, PermissionsMatrix, Profile, UserRole } from '../types';

/**
 * Che một phần mã thẻ từ/QR đối với các vai trò không phải ADMIN.
 */
export function maskCardCode(code: string | null | undefined, role?: UserRole | string | null): string | null {
    if (!code) return null;
    if (role === 'ADMIN') return code;
    if (code.length <= 6) return '***';
    return `${code.substring(0, 5)}***${code.substring(code.length - 4)}`;
}

/**
 * Định dạng nhãn phương thức thanh toán thống nhất toàn hệ thống (bao gồm TRANSFER_COMPANY).
 */
export function formatPaymentMethod(method?: string | null, withIcon = false): string {
    switch (method) {
        case 'CASH':
            return withIcon ? '💵 Tiền mặt' : 'Tiền mặt';
        case 'TRANSFER':
            return withIcon ? '🏦 Chuyển khoản' : 'Chuyển khoản';
        case 'TRANSFER_COMPANY':
            return withIcon ? '🏢 CK Công ty' : 'CK Công ty';
        case 'CARD':
            return withIcon ? '💳 Thẻ POS' : 'Thẻ POS';
        default:
            return withIcon ? '💵 Tiền mặt' : 'Tiền mặt';
    }
}

/**
 * Đọc và chuẩn hóa thông tin cấu hình doanh nghiệp từ bảng system_settings.
 */
export async function fetchBusinessSettings(): Promise<BusinessInfo> {
    const { data, error } = await supabase
        .from('system_settings')
        .select('key, value');

    if (error || !data) {
        return {};
    }

    const info: Record<string, any> = {};
    for (const row of data) {
        if (row.value === null || row.value === undefined) continue;
        if (typeof row.value === 'string') {
            info[row.key] = row.value.replace(/^"|"$/g, '');
        } else {
            info[row.key] = JSON.stringify(row.value).replace(/^"|"$/g, '');
        }
    }
    return info as BusinessInfo;
}

/**
 * Trả về ngày cuối cùng của tháng theo giờ địa phương (YYYY-MM-DD),
 * tránh lỗi lùi 1 ngày khi dùng new Date(y, m, 0).toISOString() ở múi giờ UTC+7.
 */
export function getLastDayOfMonthLocal(year: number, month1Based: number): string {
    const lastDay = new Date(year, month1Based, 0).getDate();
    return `${year}-${String(month1Based).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
}

/**
 * Trả về ngày hiện tại theo múi giờ Việt Nam (YYYY-MM-DD).
 */
export function getTodayLocalVN(): string {
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' }));
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * Làm sạch chuỗi tìm kiếm trước khi nối vào biểu thức .or() của PostgREST
 * để tránh vỡ cú pháp filter khi chứa dấu phẩy hoặc ngoặc đơn.
 */
export function sanitizePostgrestTerm(term: string): string {
    return term.replace(/[,()]/g, ' ').trim();
}

/**
 * Kiểm tra phân quyền thống nhất giữa Role và PermissionsMatrix.
 */
export function hasPermission(
    profile: Profile | null | undefined,
    module: keyof PermissionsMatrix,
    action: 'view' | 'create' | 'edit' | 'delete' | 'export' = 'view'
): boolean {
    if (!profile) return false;
    if (profile.role === 'ADMIN') return true;
    const modPerm = profile.permissions?.[module] as Record<string, boolean> | undefined;
    if (modPerm && typeof modPerm[action] === 'boolean') {
        return modPerm[action];
    }
    // Fallback mặc định theo vai trò nếu tài khoản cũ chưa khởi tạo permissions JSON
    if (action === 'view') {
        switch (module) {
            case 'pos':
            case 'customers':
            case 'packages':
                return profile.role === 'CASHIER' || profile.role === 'STAFF';
            case 'gate':
                return profile.role === 'GATE_KEEPER' || profile.role === 'STAFF' || profile.role === 'CASHIER';
            case 'reports':
                return profile.role === 'CASHIER';
            default:
                return false;
        }
    }
    return false;
}
