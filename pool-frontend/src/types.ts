export type UserRole = 'ADMIN' | 'STAFF' | 'CASHIER' | 'GATE_KEEPER';
export type TicketCategory = 'DAILY' | 'MONTHLY' | 'MULTI' | 'LESSON';
export type TicketStatus = 'UNUSED' | 'IN' | 'OUT' | 'EXPIRED';
export type LessonClassType = 'GROUP' | 'ONE_ON_ONE' | 'ONE_ON_TWO';

export interface PermissionsMatrix {
    pos: { view: boolean };
    gate: { view: boolean };
    customers: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    packages: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    reports: { view: boolean; export: boolean };
    staff: { view: boolean; create: boolean; edit: boolean; delete: boolean };
    settings: { view: boolean; edit: boolean };
}

export interface Profile {
    id: string;
    full_name: string;
    role: UserRole;
    avatar_url: string | null;
    created_at: string;
    is_active?: boolean;
    can_use_camera?: boolean;
    permissions?: PermissionsMatrix;
}

export interface TicketType {
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
    lesson_class_type: LessonClassType | null;
    lesson_schedule_type: 'FIXED' | 'FLEXIBLE' | null;
    age_price_tiers: { minAge: number, maxAge: number, price: number }[] | null;
}

export interface LessonSchedule {
    id: string;
    ticket_type_id: string;
    day_of_week: number;
    start_time: string;
    end_time: string;
}

export interface Ticket {
    id: string;
    ticket_type_id: string;
    status: TicketStatus;
    customer_name: string | null;
    customer_phone: string | null;
    customer_birth_year: number | null;
    valid_from: string | null;
    valid_until: string | null;
    sold_by: string | null;
    sold_at: string;
    price_paid: number;
    last_scan_direction: 'IN' | 'OUT' | null;
    last_scan_at: string | null;
    created_at: string;
    updated_at: string;
}

export interface SystemSetting {
    key: string;
    value: string;
    updated_at: string;
}

export interface CheckQrResult {
    success: boolean;
    error?: string;
    message: string;
    ticket_id?: string;
    ticket_status?: string;
    type_name?: string;
    category?: string;
    customer_name?: string;
    pool_close_time?: string;
    remaining_sessions?: number | null;
}
