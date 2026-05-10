-- ============================================================
-- 056_checkin_logs.sql
-- Tạo bảng lịch sử check-in riêng biệt, không phụ thuộc vào
-- vé lượt con. Giải quyết:
-- 1. Loại gói hiện sai (luôn hiện "VÉ BƠI VÃNG LAI")
-- 2. Bóng rổ không in vé → không có lịch sử
-- ============================================================

-- 1. Drop bảng cũ nếu có (để tạo lại đúng FK)
DROP TABLE IF EXISTS public.checkin_logs;

-- 2. Tạo bảng checkin_logs
CREATE TABLE public.checkin_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_ticket_id UUID REFERENCES public.tickets(id),     -- Gói gốc bị trừ buổi
    gate_ticket_id UUID REFERENCES public.tickets(id),       -- Vé lượt tạo ra (NULL nếu không in vé)
    customer_id UUID REFERENCES public.customers(id),
    customer_name TEXT,
    card_code TEXT,
    ticket_type_name TEXT NOT NULL,                           -- Tên gói gốc (VD: "BÓNG RỔ CƠ BẢN", "VÉ 10 BUỔI")
    ticket_category TEXT,                                     -- MULTI, LESSON, MONTHLY
    sport_type TEXT DEFAULT 'SWIMMING',                       -- SWIMMING, BASKETBALL
    remaining_sessions INTEGER,                               -- Số buổi còn lại SAU khi trừ
    is_new_activation BOOLEAN DEFAULT false,                  -- Có phải lần kích hoạt đầu tiên không
    requires_gate_ticket BOOLEAN DEFAULT true,                -- Có tạo vé cổng không
    checked_in_by UUID REFERENCES public.profiles(id),       -- Staff thực hiện (FK -> profiles, NOT auth.users)
    checked_in_at TIMESTAMPTZ DEFAULT now(),                  -- Thời gian check-in
    status TEXT DEFAULT 'SUCCESS'                              -- SUCCESS, CANCELLED
);

-- Index cho query lịch sử
CREATE INDEX IF NOT EXISTS idx_checkin_logs_date ON public.checkin_logs (checked_in_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_customer ON public.checkin_logs (customer_id);
CREATE INDEX IF NOT EXISTS idx_checkin_logs_card ON public.checkin_logs (card_code);

-- 3. RLS
ALTER TABLE public.checkin_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can view checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Staff can insert checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Admin can update checkin logs" ON public.checkin_logs;
CREATE POLICY "Staff can view checkin logs" ON public.checkin_logs FOR SELECT USING (true);
CREATE POLICY "Staff can insert checkin logs" ON public.checkin_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Admin can update checkin logs" ON public.checkin_logs FOR UPDATE USING (true);
