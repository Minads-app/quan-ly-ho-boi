-- ============================================================
-- 019_lesson_packages.sql
-- Gói Khóa Học Bơi: Enum, cột mới, bảng lịch học, cập nhật check-in
-- ============================================================

-- 1. Enum loại lớp học
DO $$ BEGIN
    CREATE TYPE public.lesson_class_type AS ENUM ('GROUP', 'ONE_ON_ONE', 'ONE_ON_TWO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2. Thêm category LESSON
ALTER TYPE public.ticket_category ADD VALUE IF NOT EXISTS 'LESSON';

-- 3. Cột mới trên ticket_types
ALTER TABLE public.ticket_types
ADD COLUMN IF NOT EXISTS duration_months NUMERIC(4,1),
ADD COLUMN IF NOT EXISTS duration_unit TEXT DEFAULT 'days',
ADD COLUMN IF NOT EXISTS lesson_class_type public.lesson_class_type,
ADD COLUMN IF NOT EXISTS lesson_schedule_type TEXT;

-- 4. Bảng lịch học cố định (cho lớp GROUP)
CREATE TABLE IF NOT EXISTS public.lesson_schedules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_type_id  UUID NOT NULL REFERENCES public.ticket_types(id) ON DELETE CASCADE,
    day_of_week     SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=CN,1=T2..6=T7
    start_time      TIME NOT NULL,
    end_time        TIME NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.lesson_schedules IS 'Lịch học cố định cho các gói khóa học bơi lớp nhóm.';

-- 5. RLS cho lesson_schedules
ALTER TABLE public.lesson_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lesson_schedules_select_authenticated"
    ON public.lesson_schedules FOR SELECT
    TO authenticated
    USING (true);

CREATE POLICY "lesson_schedules_insert_admin"
    ON public.lesson_schedules FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "lesson_schedules_update_admin"
    ON public.lesson_schedules FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "lesson_schedules_delete_admin"
    ON public.lesson_schedules FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- 6. Cập nhật trigger generate_package_code: thêm LESSON
CREATE OR REPLACE FUNCTION public.generate_package_code()
RETURNS TRIGGER AS $$
DECLARE
    v_date TEXT;
    v_seq INT;
BEGIN
    IF NEW.package_code IS NULL THEN
        SELECT category INTO v_date FROM public.ticket_types WHERE id = NEW.ticket_type_id;
        IF v_date IN ('MONTHLY', 'MULTI', 'LESSON') THEN
            v_seq := nextval('public.package_code_seq');
            NEW.package_code := 'PKG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. Cập nhật hàm checkin_pass_and_issue_ticket với logic Kích hoạt chậm + FIFO
CREATE OR REPLACE FUNCTION public.checkin_pass_and_issue_ticket(
    p_pass_id TEXT,
    p_staff_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket RECORD;
    v_ticket_type RECORD;
    v_new_ticket_type_id UUID;
    v_new_ticket_id UUID;
    v_close_time TEXT := '20:00';
    v_pass_uuid UUID;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    v_valid_until DATE;
BEGIN
    -- Lấy ticket type "Vé Lượt (Từ Thẻ)"
    SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name = 'Vé Lượt (Từ Thẻ)' LIMIT 1;

    -- Lấy giờ đóng cửa
    SELECT value INTO v_close_time FROM public.system_settings WHERE key = 'pool_close_time';
    IF v_close_time IS NULL THEN v_close_time := '20:00'; END IF;
    v_close_time := REPLACE(v_close_time, '"', '');

    -- =========================================================
    -- BƯỚC 1: Tìm gói ĐÃ KÍCH HOẠT (valid_from IS NOT NULL)
    --         + còn buổi + chưa hết hạn → FIFO theo sold_at
    -- =========================================================
    BEGIN
        v_pass_uuid := p_pass_id::UUID;
        SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months, tt.duration_unit
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE (t.id = v_pass_uuid OR t.card_code = p_pass_id)
          AND tt.category IN ('MONTHLY', 'MULTI', 'LESSON')
          AND t.status != 'EXPIRED'::public.ticket_status
          AND t.valid_from IS NOT NULL  -- ĐÃ KÍCH HOẠT
          AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0)
          AND (t.valid_until IS NULL OR v_today <= t.valid_until)
        ORDER BY t.sold_at ASC
        LIMIT 1
        FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
        SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months, tt.duration_unit
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.card_code = p_pass_id
          AND tt.category IN ('MONTHLY', 'MULTI', 'LESSON')
          AND t.status != 'EXPIRED'::public.ticket_status
          AND t.valid_from IS NOT NULL
          AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0)
          AND (t.valid_until IS NULL OR v_today <= t.valid_until)
        ORDER BY t.sold_at ASC
        LIMIT 1
        FOR UPDATE;
    END;

    -- =========================================================
    -- BƯỚC 2: Không tìm thấy gói đã kích hoạt → Tìm gói CHƯA KÍCH HOẠT
    --         (valid_from IS NULL, status = UNUSED) → Kích hoạt gói cũ nhất
    -- =========================================================
    IF v_ticket IS NULL THEN
        BEGIN
            v_pass_uuid := p_pass_id::UUID;
            SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months, tt.duration_unit
            INTO v_ticket
            FROM public.tickets t
            JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
            WHERE (t.id = v_pass_uuid OR t.card_code = p_pass_id)
              AND tt.category IN ('MONTHLY', 'MULTI', 'LESSON')
              AND t.status = 'UNUSED'::public.ticket_status
              AND t.valid_from IS NULL
            ORDER BY t.sold_at ASC
            LIMIT 1
            FOR UPDATE;
        EXCEPTION WHEN invalid_text_representation THEN
            SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months, tt.duration_unit
            INTO v_ticket
            FROM public.tickets t
            JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
            WHERE t.card_code = p_pass_id
              AND tt.category IN ('MONTHLY', 'MULTI', 'LESSON')
              AND t.status = 'UNUSED'::public.ticket_status
              AND t.valid_from IS NULL
            ORDER BY t.sold_at ASC
            LIMIT 1
            FOR UPDATE;
        END;

        -- Kích hoạt gói: set valid_from + valid_until
        IF v_ticket IS NOT NULL THEN
            -- Tính valid_until dựa trên duration_unit
            IF v_ticket.duration_unit = 'months' AND v_ticket.duration_months IS NOT NULL THEN
                v_valid_until := v_today + (v_ticket.duration_months * 30)::INTEGER;
            ELSIF v_ticket.validity_days IS NOT NULL THEN
                v_valid_until := v_today + v_ticket.validity_days;
            ELSE
                v_valid_until := NULL; -- Không giới hạn thời gian
            END IF;

            UPDATE public.tickets
            SET valid_from = v_today,
                valid_until = v_valid_until,
                status = 'IN'::public.ticket_status,
                updated_at = now()
            WHERE id = v_ticket.id;

            -- Cập nhật record local
            v_ticket.valid_from := v_today;
            v_ticket.valid_until := v_valid_until;
        END IF;
    END IF;

    -- =========================================================
    -- BƯỚC 3: Không tìm thấy gói nào → Trả lỗi
    -- =========================================================
    IF v_ticket IS NULL THEN
        DECLARE v_any_ticket RECORD;
        BEGIN
            BEGIN
                v_pass_uuid := p_pass_id::UUID;
                SELECT t.*, tt.category INTO v_any_ticket
                FROM public.tickets t
                JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
                WHERE (t.id = v_pass_uuid OR t.card_code = p_pass_id)
                ORDER BY t.sold_at DESC LIMIT 1;
            EXCEPTION WHEN invalid_text_representation THEN
                SELECT t.*, tt.category INTO v_any_ticket
                FROM public.tickets t
                JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
                WHERE t.card_code = p_pass_id
                ORDER BY t.sold_at DESC LIMIT 1;
            END;

            IF v_any_ticket IS NULL THEN
                RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy thẻ (mã không hợp lệ).');
            ELSIF v_any_ticket.category = 'DAILY' THEN
                RETURN jsonb_build_object('success', false, 'message', 'Đây là vé lượt, không phải thẻ tháng/nhiều buổi/học bơi.');
            ELSE
                RETURN jsonb_build_object('success', false, 'message', 'Tất cả gói trên thẻ này đã HẾT LƯỢT hoặc HẾT HẠN. Vui lòng nạp thêm gói.');
            END IF;
        END;
    END IF;

    -- =========================================================
    -- BƯỚC 4: Trừ lượt & tạo vé lượt phụ
    -- =========================================================
    IF v_ticket.remaining_sessions IS NOT NULL THEN
        UPDATE public.tickets
        SET remaining_sessions = remaining_sessions - 1,
            status = CASE WHEN remaining_sessions - 1 <= 0 THEN 'EXPIRED'::public.ticket_status ELSE 'IN'::public.ticket_status END,
            updated_at = now()
        WHERE id = v_ticket.id;
    ELSE
        UPDATE public.tickets SET status = 'IN'::public.ticket_status, updated_at = now() WHERE id = v_ticket.id;
    END IF;

    -- Tạo vé lượt phụ
    INSERT INTO public.tickets (
        ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until, sold_by, price_paid, remaining_sessions, total_sessions
    ) VALUES (
        v_new_ticket_type_id, 'UNUSED'::public.ticket_status, v_ticket.customer_name, v_ticket.customer_phone, v_today, v_today, p_staff_id, 0, 1, 1
    ) RETURNING id INTO v_new_ticket_id;

    RETURN jsonb_build_object(
        'success', true,
        'message', 'Check-in thành công. Đã trừ 1 lượt.',
        'pass_status', jsonb_build_object(
            'customer_name', v_ticket.customer_name,
            'type_name', v_ticket.type_name,
            'remaining_sessions', CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE null END,
            'total_sessions', v_ticket.total_sessions,
            'valid_from', v_ticket.valid_from,
            'valid_until', v_ticket.valid_until
        ),
        'new_ticket', jsonb_build_object(
            'id', v_new_ticket_id,
            'type_name', 'Vé Lượt (Từ Thẻ)',
            'price_paid', 0,
            'sold_at', now(),
            'pool_close_time', v_close_time,
            'customer_name', v_ticket.customer_name
        )
    );
END;
$$;
