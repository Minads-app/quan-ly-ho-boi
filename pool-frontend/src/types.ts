export type UserRole = 'ADMIN' | 'STAFF' | 'CASHIER' | 'GATE_KEEPER';
export type TicketCategory = 'DAILY' | 'MONTHLY';
export type TicketStatus = 'UNUSED' | 'IN' | 'OUT' | 'EXPIRED';

export interface Profile {
    id: string;
    full_name: string;
    role: UserRole;
    avatar_url: string | null;
    created_at: string;
}

export interface TicketType {
    id: string;
    name: string;
    category: 'DAILY' | 'MULTI' | 'MONTHLY';
    price: number;
    description: string;
    validity_days: number | null;
    session_count: number | null;
    is_active: boolean;
}

export interface Ticket {
    id: string;
    ticket_type_id: string;
    status: TicketStatus;
    customer_name: string | null;
    customer_phone: string | null;
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
