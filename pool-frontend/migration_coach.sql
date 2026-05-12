-- ============================================================
-- Migration: Tính năng Quản lý & Chấm công Huấn Luyện Viên (HLV)
-- Chạy TOÀN BỘ script này trên Supabase Dashboard > SQL Editor
-- ============================================================

-- ========== 1. Tạo bảng coaches (Danh sách HLV) ==========
CREATE TABLE IF NOT EXISTS public.coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    is_active BOOLEAN DEFAULT true,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index cho truy vấn nhanh
CREATE INDEX IF NOT EXISTS idx_coaches_profile_id ON public.coaches(profile_id);
CREATE INDEX IF NOT EXISTS idx_coaches_is_active ON public.coaches(is_active);

-- RLS policies cho coaches
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coaches' AND policyname = 'coaches_select_all') THEN
        CREATE POLICY "coaches_select_all" ON public.coaches FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coaches' AND policyname = 'coaches_insert_admin') THEN
        CREATE POLICY "coaches_insert_admin" ON public.coaches FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coaches' AND policyname = 'coaches_update_admin') THEN
        CREATE POLICY "coaches_update_admin" ON public.coaches FOR UPDATE USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coaches' AND policyname = 'coaches_delete_admin') THEN
        CREATE POLICY "coaches_delete_admin" ON public.coaches FOR DELETE USING (true);
    END IF;
END $$;

-- ========== 2. Thêm cột coach_id vào bảng tickets ==========
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS coach_id UUID REFERENCES public.coaches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_coach_id ON public.tickets(coach_id);

-- ========== 3. Tạo bảng coach_attendances (Chấm công Lớp nhóm) ==========
CREATE TABLE IF NOT EXISTS public.coach_attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
    class_name TEXT NOT NULL DEFAULT 'Lớp nhóm',
    teaching_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_attendances_coach_id ON public.coach_attendances(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_attendances_date ON public.coach_attendances(teaching_date);

-- RLS policies cho coach_attendances
ALTER TABLE public.coach_attendances ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coach_attendances' AND policyname = 'coach_attendances_select_all') THEN
        CREATE POLICY "coach_attendances_select_all" ON public.coach_attendances FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coach_attendances' AND policyname = 'coach_attendances_insert') THEN
        CREATE POLICY "coach_attendances_insert" ON public.coach_attendances FOR INSERT WITH CHECK (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coach_attendances' AND policyname = 'coach_attendances_update') THEN
        CREATE POLICY "coach_attendances_update" ON public.coach_attendances FOR UPDATE USING (true);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'coach_attendances' AND policyname = 'coach_attendances_delete') THEN
        CREATE POLICY "coach_attendances_delete" ON public.coach_attendances FOR DELETE USING (true);
    END IF;
END $$;

-- ========== 4. Tạo View tổng hợp chấm công HLV từ check-in (Lớp kèm) ==========
CREATE OR REPLACE VIEW public.coach_checkin_summary AS
SELECT
    t.coach_id,
    c.full_name AS coach_name,
    cl.id AS checkin_log_id,
    cl.checked_in_at,
    cl.customer_name,
    cl.ticket_type_name,
    cl.ticket_category,
    cl.source_ticket_id,
    t.price_paid,
    t.total_sessions,
    CASE
        WHEN t.total_sessions IS NOT NULL AND t.total_sessions > 0
        THEN ROUND(t.price_paid::NUMERIC / t.total_sessions, 0)
        ELSE 0
    END AS per_session_amount
FROM public.checkin_logs cl
JOIN public.tickets t ON t.id = cl.source_ticket_id
JOIN public.coaches c ON c.id = t.coach_id
WHERE cl.status != 'CANCELLED'
  AND t.coach_id IS NOT NULL;

-- ============================================================
-- GHI CHÚ VỀ RPC create_checkout_order:
-- KHÔNG cần sửa hàm RPC. Frontend đã xử lý gán coach_id
-- bằng cách UPDATE tickets ngay sau khi checkout thành công.
-- ============================================================
-- HOÀN TẤT. Sau khi chạy xong → Deploy frontend mới.
-- ============================================================
