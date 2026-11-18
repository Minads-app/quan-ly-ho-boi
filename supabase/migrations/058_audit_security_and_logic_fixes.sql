-- ============================================================================
-- 058_audit_security_and_logic_fixes.sql
-- Bản vá toàn diện theo Báo cáo Kiểm toán Mã nguồn (AUDIT_REPORT.md):
-- 1. Khắc phục lỗ hổng RLS (USING true) trên coaches, coach_attendances,
--    checkin_logs, promotion_vouchers, promotion_usage, bulk_extensions.
-- 2. Đồng bộ Schema: coaches.specialty, tickets.extra_students,
--    tickets.coach_id, orders.idempotency_key, FK ON DELETE SET NULL cho checkin_logs.
-- 3. Nâng cấp RPC create_checkout_order (chống âm tồn kho FOR UPDATE,
--    trừ voucher nguyên tử trong transaction, lưu extra_students & coach_id,
--    chống double-submit bằng idempotency_key).
-- 4. Nâng cấp RPC checkin_pass_and_issue_ticket (chặn gói CANCELLED,
--    xuất đủ vé cổng cho gói Học bơi Kèm riêng 1-N / extra_students).
-- 5. Nâng cấp RPC cancel_ticket & thêm RPC cancel_checkin_log (hoàn buổi chính xác
--    theo source_ticket_id, cập nhật checkin_logs.status = 'CANCELLED' để không
--    tính nhầm lương HLV, hỗ trợ hủy cả lượt điểm danh không in vé cổng).
-- 6. Đồng bộ RPC check_qr_ticket_text & validate_and_scan (chặn vé CANCELLED,
--    xử lý đủ 4 category DAILY / MONTHLY / MULTI / LESSON).
-- 7. Bổ sung RPC Transaction: process_inventory_slip, change_customer_card_code,
--    update_package_financials.
-- 8. Bổ sung bảng audit_logs, accounting_months và Trigger kiểm toán / khóa sổ.
-- ============================================================================

-- ============================================================================
-- PHẦN 1: ĐẢM BẢO SCHEMA ĐẦY ĐỦ & ĐỒNG BỘ KHÓA NGOẠI
-- ============================================================================

-- 1.1. Bảng coaches & cột specialty (bị thiếu trong migration_coach.sql gốc)
CREATE TABLE IF NOT EXISTS public.coaches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    specialty TEXT,
    is_active BOOLEAN DEFAULT true,
    note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.coaches ADD COLUMN IF NOT EXISTS specialty TEXT;
CREATE INDEX IF NOT EXISTS idx_coaches_profile_id ON public.coaches(profile_id);
CREATE INDEX IF NOT EXISTS idx_coaches_is_active ON public.coaches(is_active);

-- 1.2. Bảng coach_attendances
CREATE TABLE IF NOT EXISTS public.coach_attendances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    coach_id UUID NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
    class_name TEXT NOT NULL DEFAULT 'Lớp nhóm',
    teaching_date DATE NOT NULL DEFAULT CURRENT_DATE,
    amount NUMERIC(12, 0) NOT NULL DEFAULT 0,
    note TEXT,
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coach_attendances_coach_id ON public.coach_attendances(coach_id);
CREATE INDEX IF NOT EXISTS idx_coach_attendances_date ON public.coach_attendances(teaching_date);

-- 1.3. Bảng bulk_extensions & ticket_extension_logs
CREATE TABLE IF NOT EXISTS public.bulk_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closed_start DATE NOT NULL,
    closed_end DATE NOT NULL,
    days_extended INT NOT NULL,
    total_tickets INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.ticket_extension_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
    bulk_extension_id UUID REFERENCES public.bulk_extensions(id) ON DELETE CASCADE,
    old_valid_until DATE,
    new_valid_until DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ticket_ext_ticket_id ON public.ticket_extension_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ext_bulk_id ON public.ticket_extension_logs(bulk_extension_id);

-- 1.4. Mở rộng cột trên bảng tickets và orders
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS coach_id UUID REFERENCES public.coaches(id) ON DELETE SET NULL;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS extra_students JSONB DEFAULT '[]'::jsonb;
ALTER TABLE public.tickets ADD COLUMN IF NOT EXISTS parent_ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_coach_id ON public.tickets(coach_id);
CREATE INDEX IF NOT EXISTS idx_tickets_parent_ticket_id ON public.tickets(parent_ticket_id);

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

-- 1.5. Chuẩn hóa Foreign Keys trên checkin_logs sang ON DELETE SET NULL
-- (Tránh lỗi không thể xóa gói thẻ hoặc khách hàng khi đã có lịch sử check-in)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'checkin_logs') THEN
        ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_source_ticket_id_fkey;
        ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_gate_ticket_id_fkey;
        ALTER TABLE public.checkin_logs DROP CONSTRAINT IF EXISTS checkin_logs_customer_id_fkey;

        ALTER TABLE public.checkin_logs
            ADD CONSTRAINT checkin_logs_source_ticket_id_fkey
            FOREIGN KEY (source_ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;

        ALTER TABLE public.checkin_logs
            ADD CONSTRAINT checkin_logs_gate_ticket_id_fkey
            FOREIGN KEY (gate_ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;

        ALTER TABLE public.checkin_logs
            ADD CONSTRAINT checkin_logs_customer_id_fkey
            FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 1.6. Chuẩn hóa Foreign Keys trên promotion_usage để không chặn xóa khách hàng/vé
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotion_usage') THEN
        ALTER TABLE public.promotion_usage DROP CONSTRAINT IF EXISTS promotion_usage_customer_id_fkey;
        ALTER TABLE public.promotion_usage DROP CONSTRAINT IF EXISTS promotion_usage_ticket_id_fkey;
        ALTER TABLE public.promotion_usage ALTER COLUMN customer_id DROP NOT NULL;

        ALTER TABLE public.promotion_usage
            ADD CONSTRAINT promotion_usage_customer_id_fkey
            FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE SET NULL;

        ALTER TABLE public.promotion_usage
            ADD CONSTRAINT promotion_usage_ticket_id_fkey
            FOREIGN KEY (ticket_id) REFERENCES public.tickets(id) ON DELETE SET NULL;
    END IF;
END $$;

-- 1.7. Đảm bảo View coach_checkin_summary tồn tại và lọc đúng status != 'CANCELLED'
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
  AND t.status != 'CANCELLED'
  AND t.coach_id IS NOT NULL;

-- ============================================================================
-- PHẦN 2: SIẾT CHẶT BẢO MẬT ROW-LEVEL SECURITY (RLS)
-- ============================================================================

-- Helper kiểm tra quyền ADMIN
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'ADMIN'
    );
$$;

-- 2.1. RLS cho bảng coaches
ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coaches_select_all" ON public.coaches;
DROP POLICY IF EXISTS "coaches_insert_admin" ON public.coaches;
DROP POLICY IF EXISTS "coaches_update_admin" ON public.coaches;
DROP POLICY IF EXISTS "coaches_delete_admin" ON public.coaches;

CREATE POLICY "coaches_select_authenticated"
    ON public.coaches FOR SELECT TO authenticated USING (true);
CREATE POLICY "coaches_insert_admin"
    ON public.coaches FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());
CREATE POLICY "coaches_update_admin"
    ON public.coaches FOR UPDATE TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE POLICY "coaches_delete_admin"
    ON public.coaches FOR DELETE TO authenticated USING (public.is_admin_user());

-- 2.2. RLS cho bảng coach_attendances
ALTER TABLE public.coach_attendances ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "coach_attendances_select_all" ON public.coach_attendances;
DROP POLICY IF EXISTS "coach_attendances_insert" ON public.coach_attendances;
DROP POLICY IF EXISTS "coach_attendances_update" ON public.coach_attendances;
DROP POLICY IF EXISTS "coach_attendances_delete" ON public.coach_attendances;

CREATE POLICY "coach_attendances_select_auth"
    ON public.coach_attendances FOR SELECT TO authenticated
    USING (
        public.is_admin_user()
        OR EXISTS (SELECT 1 FROM public.coaches c WHERE c.id = coach_id AND c.profile_id = auth.uid())
    );
CREATE POLICY "coach_attendances_insert_admin"
    ON public.coach_attendances FOR INSERT TO authenticated WITH CHECK (public.is_admin_user());
CREATE POLICY "coach_attendances_update_admin"
    ON public.coach_attendances FOR UPDATE TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE POLICY "coach_attendances_delete_admin"
    ON public.coach_attendances FOR DELETE TO authenticated USING (public.is_admin_user());

-- 2.3. RLS cho bảng checkin_logs
ALTER TABLE public.checkin_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Staff can view checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Staff can insert checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Admin can update checkin logs" ON public.checkin_logs;
DROP POLICY IF EXISTS "Admin can delete checkin logs" ON public.checkin_logs;

CREATE POLICY "Staff can view checkin logs"
    ON public.checkin_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "Staff can insert checkin logs"
    ON public.checkin_logs FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Admin can update checkin logs"
    ON public.checkin_logs FOR UPDATE TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
CREATE POLICY "Admin can delete checkin logs"
    ON public.checkin_logs FOR DELETE TO authenticated USING (public.is_admin_user());

-- 2.4. RLS cho bảng bulk_extensions & ticket_extension_logs
ALTER TABLE public.bulk_extensions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_extension_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bulk_extensions_select_auth" ON public.bulk_extensions;
DROP POLICY IF EXISTS "bulk_extensions_write_admin" ON public.bulk_extensions;
CREATE POLICY "bulk_extensions_select_auth"
    ON public.bulk_extensions FOR SELECT TO authenticated USING (true);
CREATE POLICY "bulk_extensions_write_admin"
    ON public.bulk_extensions FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

DROP POLICY IF EXISTS "ticket_ext_logs_select_auth" ON public.ticket_extension_logs;
DROP POLICY IF EXISTS "ticket_ext_logs_write_admin" ON public.ticket_extension_logs;
CREATE POLICY "ticket_ext_logs_select_auth"
    ON public.ticket_extension_logs FOR SELECT TO authenticated USING (true);
CREATE POLICY "ticket_ext_logs_write_admin"
    ON public.ticket_extension_logs FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

-- 2.5. RLS cho bảng promotion_vouchers & promotion_usage
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotion_vouchers') THEN
        DROP POLICY IF EXISTS "Allow all for authenticated" ON public.promotion_vouchers;
        DROP POLICY IF EXISTS "vouchers_select_auth" ON public.promotion_vouchers;
        DROP POLICY IF EXISTS "vouchers_write_admin" ON public.promotion_vouchers;

        CREATE POLICY "vouchers_select_auth"
            ON public.promotion_vouchers FOR SELECT TO authenticated USING (true);
        CREATE POLICY "vouchers_write_admin"
            ON public.promotion_vouchers FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'promotion_usage') THEN
        DROP POLICY IF EXISTS "Allow all for authenticated" ON public.promotion_usage;
        DROP POLICY IF EXISTS "promo_usage_select_auth" ON public.promotion_usage;
        DROP POLICY IF EXISTS "promo_usage_write_admin" ON public.promotion_usage;

        CREATE POLICY "promo_usage_select_auth"
            ON public.promotion_usage FOR SELECT TO authenticated USING (true);
        CREATE POLICY "promo_usage_write_admin"
            ON public.promotion_usage FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());
    END IF;
END $$;

-- ============================================================================
-- PHẦN 3: NÂNG CẤP RPC create_checkout_order (ATOMIC STOCK, VOUCHER, 1-N, IDEMPOTENCY)
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_checkout_order(INTEGER, VARCHAR, TEXT, TEXT, TEXT, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.create_checkout_order(
    p_total_amount INTEGER,
    p_payment_method VARCHAR,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_note TEXT,
    p_user_id UUID,
    p_items JSONB,
    p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing_order_id UUID;
    v_order_id UUID;
    v_item JSONB;
    v_qty INTEGER;
    v_product_stock INTEGER;
    v_product_name TEXT;
    v_i INTEGER;
    v_ticket_ids UUID[] := '{}';
    v_new_ticket_id UUID;
    v_card_code TEXT;
    v_customer_id UUID;
    v_coach_id UUID;
    v_voucher_id UUID;
    v_voucher RECORD;
    v_extra_students JSONB;
BEGIN
    -- 0. Chống Double-Submit bằng idempotency_key
    IF p_idempotency_key IS NOT NULL THEN
        SELECT id INTO v_existing_order_id
        FROM public.orders
        WHERE idempotency_key = p_idempotency_key
        LIMIT 1;

        IF v_existing_order_id IS NOT NULL THEN
            SELECT COALESCE(array_agg(id), '{}') INTO v_ticket_ids
            FROM public.tickets
            WHERE order_id = v_existing_order_id;

            RETURN jsonb_build_object(
                'success', true,
                'order_id', v_existing_order_id,
                'ticket_ids', v_ticket_ids,
                'duplicate', true,
                'voucher_processed', true
            );
        END IF;
    END IF;

    -- 1. Tạo Order
    INSERT INTO public.orders (total_amount, payment_method, customer_name, customer_phone, note, created_by, idempotency_key)
    VALUES (p_total_amount, p_payment_method, p_customer_name, p_customer_phone, p_note, p_user_id, p_idempotency_key)
    RETURNING id INTO v_order_id;

    -- 2. Xử lý từng dòng trong giỏ hàng
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_qty := GREATEST(1, COALESCE((v_item->>'quantity')::INTEGER, 1));

        IF v_item->>'type' = 'PRODUCT' THEN
            -- Khóa dòng sản phẩm để kiểm tra tồn kho nguyên tử (chống âm kho khi bán đồng thời)
            SELECT stock_quantity, name INTO v_product_stock, v_product_name
            FROM public.products
            WHERE id = (v_item->>'id')::UUID
            FOR UPDATE;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Sản phẩm không tồn tại.';
            END IF;

            IF v_product_stock < v_qty THEN
                RAISE EXCEPTION 'Sản phẩm "%" không đủ tồn kho (Còn: %, Cần: %).', v_product_name, v_product_stock, v_qty;
            END IF;

            INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, subtotal)
            VALUES (v_order_id, (v_item->>'id')::UUID, v_qty, (v_item->>'unit_price')::INTEGER, (v_item->>'subtotal')::INTEGER);

            UPDATE public.products
            SET stock_quantity = stock_quantity - v_qty
            WHERE id = (v_item->>'id')::UUID;

            INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
            VALUES ((v_item->>'id')::UUID, 'SALE', -v_qty, 'Bán hàng Order: ' || v_order_id, p_user_id);

        ELSIF v_item->>'type' = 'TICKET' THEN
            INSERT INTO public.order_items (order_id, ticket_type_id, quantity, unit_price, subtotal)
            VALUES (v_order_id, (v_item->>'id')::UUID, v_qty, (v_item->>'unit_price')::INTEGER, (v_item->>'subtotal')::INTEGER);

            v_card_code := NULLIF(TRIM(COALESCE(v_item->'ticket_metadata'->>'card_code', '')), '');
            v_customer_id := (NULLIF(v_item->'ticket_metadata'->>'customer_id', ''))::UUID;
            v_coach_id := (NULLIF(v_item->'ticket_metadata'->>'coach_id', ''))::UUID;
            v_voucher_id := (NULLIF(v_item->'ticket_metadata'->>'voucher_id', ''))::UUID;
            v_extra_students := COALESCE(v_item->'ticket_metadata'->'extra_students', '[]'::jsonb);

            IF v_customer_id IS NULL AND v_card_code IS NOT NULL THEN
                SELECT id INTO v_customer_id
                FROM public.customers
                WHERE public.normalize_card_code(card_code) = public.normalize_card_code(v_card_code)
                LIMIT 1;
            END IF;

            IF v_customer_id IS NULL AND NULLIF(v_item->'ticket_metadata'->>'customer_phone', '') IS NOT NULL THEN
                SELECT id, COALESCE(v_card_code, card_code) INTO v_customer_id, v_card_code
                FROM public.customers
                WHERE phone = v_item->'ticket_metadata'->>'customer_phone'
                LIMIT 1;
            END IF;

            -- Tạo N vé theo quantity
            FOR v_i IN 1..v_qty LOOP
                INSERT INTO public.tickets (
                    ticket_type_id, status, customer_name, customer_phone,
                    valid_from, valid_until, sold_by, price_paid,
                    remaining_sessions, total_sessions, promotion_id,
                    card_code, payment_method, customer_birth_year,
                    customer_name_2, customer_birth_year_2,
                    custom_duration_months, custom_validity_days,
                    guardian_name, guardian_phone,
                    order_id, customer_id, coach_id, extra_students
                ) VALUES (
                    (v_item->>'id')::UUID,
                    'UNUSED',
                    NULLIF(v_item->'ticket_metadata'->>'customer_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'customer_phone', ''),
                    (NULLIF(v_item->'ticket_metadata'->>'valid_from', ''))::DATE,
                    (NULLIF(v_item->'ticket_metadata'->>'valid_until', ''))::DATE,
                    p_user_id,
                    (v_item->>'unit_price')::INTEGER,
                    (v_item->'ticket_metadata'->>'remaining_sessions')::INTEGER,
                    (v_item->'ticket_metadata'->>'total_sessions')::INTEGER,
                    (NULLIF(v_item->'ticket_metadata'->>'promotion_id', ''))::UUID,
                    v_card_code,
                    p_payment_method::public.payment_method,
                    (NULLIF(v_item->'ticket_metadata'->>'customer_birth_year', ''))::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'customer_name_2', ''),
                    (NULLIF(v_item->'ticket_metadata'->>'customer_birth_year_2', ''))::INTEGER,
                    (NULLIF(v_item->'ticket_metadata'->>'custom_duration_months', ''))::NUMERIC,
                    (NULLIF(v_item->'ticket_metadata'->>'custom_validity_days', ''))::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'guardian_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'guardian_phone', ''),
                    v_order_id,
                    v_customer_id,
                    v_coach_id,
                    v_extra_students
                ) RETURNING id INTO v_new_ticket_id;

                v_ticket_ids := array_append(v_ticket_ids, v_new_ticket_id);
            END LOOP;

            -- Xử lý trừ lượt Voucher nguyên tử ngay trong Transaction
            IF v_voucher_id IS NOT NULL THEN
                SELECT * INTO v_voucher
                FROM public.promotion_vouchers
                WHERE id = v_voucher_id
                FOR UPDATE;

                IF NOT FOUND OR NOT v_voucher.is_active THEN
                    RAISE EXCEPTION 'Mã Voucher không hợp lệ hoặc đã bị khóa.';
                END IF;

                IF v_voucher.max_uses IS NOT NULL AND v_voucher.used_count >= v_voucher.max_uses THEN
                    RAISE EXCEPTION 'Mã Voucher "%" đã hết lượt sử dụng.', v_voucher.code;
                END IF;

                UPDATE public.promotion_vouchers
                SET used_count = used_count + 1, updated_at = now()
                WHERE id = v_voucher_id;

                INSERT INTO public.promotion_usage (voucher_id, customer_id, ticket_id, used_by)
                VALUES (v_voucher_id, v_customer_id, v_new_ticket_id, p_user_id);
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'order_id', v_order_id,
        'ticket_ids', v_ticket_ids,
        'voucher_processed', true
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ============================================================================
-- PHẦN 4: NÂNG CẤP RPC checkin_pass_and_issue_ticket (1-N STUDENTS & CANCELLED CHECK)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.checkin_pass_and_issue_ticket(
    p_pass_id TEXT,
    p_staff_id UUID,
    p_confirm_new_package BOOLEAN DEFAULT false,
    p_selected_ticket_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket RECORD;
    v_new_ticket_type_id UUID;
    v_new_ticket_id UUID;
    v_sub_ticket_id UUID;
    v_checkin_log_id UUID;
    v_close_time TEXT := '20:00';
    v_pass_uuid UUID;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    v_valid_until DATE;
    v_checkin_type_name TEXT;
    v_is_new_package BOOLEAN := false;
    v_tickets_issued JSONB := '[]'::jsonb;
    v_available_tickets JSONB := '[]'::jsonb;
    v_available_count INTEGER := 0;
    v_normalized_code TEXT;
    v_smart_tickets JSONB := '[]'::jsonb;
    v_smart_count INTEGER := 0;
    v_requires_gate_ticket BOOLEAN := true;
    v_extra_student JSONB;
    v_extra_idx INTEGER := 1;
BEGIN
    p_pass_id := UPPER(TRIM(p_pass_id));
    v_normalized_code := public.normalize_card_code(p_pass_id);

    SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name = 'Vé Lượt Trả Trước' AND is_active = true LIMIT 1;
    IF v_new_ticket_type_id IS NULL THEN
        SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name ILIKE '%Lượt%' AND category = 'DAILY' AND is_active = true LIMIT 1;
    END IF;
    IF v_new_ticket_type_id IS NULL THEN
        SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE category = 'DAILY' AND is_active = true LIMIT 1;
    END IF;

    SELECT REPLACE(COALESCE(value::TEXT, '"20:00"'), '"', '') INTO v_close_time FROM public.system_settings WHERE key = 'pool_close_time';

    BEGIN
        v_pass_uuid := p_pass_id::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        v_pass_uuid := NULL;
    END;

    -- PHẦN A: ĐÃ CHỌN GÓI CỤ THỂ
    IF p_selected_ticket_id IS NOT NULL THEN
        SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months,
               tt.duration_unit, tt.lesson_class_type, COALESCE(tt.student_count, 1) AS type_student_count,
               COALESCE(tt.requires_gate_ticket, true) AS requires_gate_ticket,
               COALESCE(tt.sport_type, 'SWIMMING') AS sport_type
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.id = p_selected_ticket_id
        FOR UPDATE;

        IF v_ticket IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy gói đã chọn.');
        END IF;

        IF v_ticket.status = 'CANCELLED'::public.ticket_status THEN
            RETURN jsonb_build_object('success', false, 'message', 'Gói này đã bị hủy, không thể check-in.');
        END IF;

        IF v_ticket.status = 'EXPIRED'::public.ticket_status
           OR (v_ticket.valid_until IS NOT NULL AND v_today > v_ticket.valid_until)
           OR (v_ticket.remaining_sessions IS NOT NULL AND v_ticket.remaining_sessions <= 0) THEN
            RETURN jsonb_build_object('success', false, 'message', 'Gói này đã hết hạn hoặc hết số buổi.');
        END IF;

        v_requires_gate_ticket := v_ticket.requires_gate_ticket;

        IF v_ticket.valid_from IS NULL AND v_ticket.status = 'UNUSED'::public.ticket_status THEN
            IF NOT p_confirm_new_package THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'needs_confirmation', true,
                    'message', 'Bạn đang chọn gói CHƯA KÍCH HOẠT. Bạn có chắc muốn kích hoạt gói này và trừ 1 buổi không?',
                    'new_package_info', jsonb_build_object(
                        'customer_name', v_ticket.customer_name,
                        'type_name', v_ticket.type_name,
                        'category', v_ticket.category,
                        'total_sessions', v_ticket.total_sessions,
                        'remaining_sessions', v_ticket.remaining_sessions
                    ),
                    'selected_ticket_id', p_selected_ticket_id
                );
            END IF;

            v_is_new_package := true;
            IF v_ticket.custom_duration_months IS NOT NULL THEN
                v_valid_until := v_today + (round(v_ticket.custom_duration_months * 30))::INTEGER;
            ELSIF v_ticket.custom_validity_days IS NOT NULL THEN
                v_valid_until := v_today + v_ticket.custom_validity_days;
            ELSIF v_ticket.duration_unit = 'months' AND v_ticket.duration_months IS NOT NULL THEN
                v_valid_until := v_today + (v_ticket.duration_months * 30)::INTEGER;
            ELSIF v_ticket.validity_days IS NOT NULL THEN
                v_valid_until := v_today + v_ticket.validity_days;
            ELSE
                v_valid_until := NULL;
            END IF;

            UPDATE public.tickets
            SET valid_from = v_today,
                valid_until = v_valid_until,
                status = 'IN'::public.ticket_status,
                updated_at = now()
            WHERE id = v_ticket.id;

            v_ticket.valid_from := v_today;
            v_ticket.valid_until := v_valid_until;
        END IF;

    -- PHẦN B: SMART SELECTION TỰ ĐỘNG QUÉT GÓI
    ELSE
        SELECT jsonb_agg(
            jsonb_build_object(
                'id', t.id,
                'customer_name', t.customer_name,
                'type_name', tt.name,
                'category', tt.category,
                'lesson_class_type', tt.lesson_class_type,
                'total_sessions', t.total_sessions,
                'remaining_sessions', t.remaining_sessions,
                'valid_from', t.valid_from,
                'valid_until', t.valid_until,
                'status', t.status,
                'is_active', CASE WHEN t.valid_from IS NOT NULL THEN true ELSE false END,
                'sold_at', t.sold_at,
                'ticket_type_id', t.ticket_type_id,
                'sport_type', COALESCE(tt.sport_type, 'SWIMMING')
            ) ORDER BY (t.valid_from IS NULL)::int ASC, t.sold_at ASC
        ), count(*)
        INTO v_available_tickets, v_available_count
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        LEFT JOIN public.customers c ON t.customer_id = c.id
        WHERE (
            (v_pass_uuid IS NOT NULL AND t.id = v_pass_uuid)
            OR public.normalize_card_code(t.card_code) = v_normalized_code
            OR public.normalize_card_code(c.card_code) = v_normalized_code
        )
          AND tt.category IN ('MONTHLY', 'MULTI', 'LESSON')
          AND t.status NOT IN ('EXPIRED'::public.ticket_status, 'CANCELLED'::public.ticket_status)
          AND (
              (t.valid_from IS NOT NULL AND v_today >= t.valid_from AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0) AND (t.valid_until IS NULL OR v_today <= t.valid_until))
              OR
              (t.valid_from IS NULL AND t.status = 'UNUSED'::public.ticket_status)
          );

        IF v_available_count = 0 THEN
            DECLARE v_any_ticket RECORD;
            BEGIN
                SELECT t.*, tt.category INTO v_any_ticket
                FROM public.tickets t
                JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
                LEFT JOIN public.customers c ON t.customer_id = c.id
                WHERE (
                    (v_pass_uuid IS NOT NULL AND t.id = v_pass_uuid)
                    OR public.normalize_card_code(t.card_code) = v_normalized_code
                    OR public.normalize_card_code(c.card_code) = v_normalized_code
                )
                ORDER BY t.sold_at DESC LIMIT 1;

                IF v_any_ticket IS NULL THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy thẻ (mã không hợp lệ).');
                ELSIF v_any_ticket.category = 'DAILY' THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Đây là vé lượt, không phải thẻ tháng/nhiều buổi/học bơi.');
                ELSIF v_any_ticket.status = 'CANCELLED'::public.ticket_status THEN
                    RETURN jsonb_build_object('success', false, 'message', 'Gói trên thẻ này đã bị hủy.');
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', 'Tất cả gói trên thẻ này đã HẾT LƯỢT, CHƯA ĐẾN NGÀY hoặc HẾT HẠN.');
                END IF;
            END;
        END IF;

        IF v_available_count = 1 THEN
            RETURN public.checkin_pass_and_issue_ticket(p_pass_id, p_staff_id, p_confirm_new_package, (v_available_tickets->0->>'id')::UUID);
        END IF;

        SELECT jsonb_agg(representative), count(*)
        INTO v_smart_tickets, v_smart_count
        FROM (
            SELECT DISTINCT ON ((elem->>'ticket_type_id')) elem AS representative
            FROM jsonb_array_elements(v_available_tickets) AS elem
            ORDER BY
                (elem->>'ticket_type_id'),
                (CASE WHEN (elem->>'is_active')::boolean THEN 0 ELSE 1 END) ASC,
                (elem->>'sold_at') ASC
        ) sub;

        IF v_smart_count = 1 THEN
            RETURN public.checkin_pass_and_issue_ticket(p_pass_id, p_staff_id, p_confirm_new_package, (v_smart_tickets->0->>'id')::UUID);
        END IF;

        RETURN jsonb_build_object(
            'success', false,
            'needs_package_selection', true,
            'message', 'Khách có nhiều loại gói/dịch vụ. Vui lòng hỏi khách muốn sử dụng dịch vụ nào hôm nay.',
            'available_packages', v_smart_tickets
        );
    END IF;

    -- PHẦN C: TRỪ LƯỢT & XUẤT VÉ QUA CỔNG
    IF v_ticket.remaining_sessions IS NOT NULL THEN
        UPDATE public.tickets
        SET remaining_sessions = remaining_sessions - 1,
            status = CASE WHEN remaining_sessions - 1 <= 0 THEN 'EXPIRED'::public.ticket_status ELSE 'IN'::public.ticket_status END,
            updated_at = now()
        WHERE id = v_ticket.id;
    ELSE
        UPDATE public.tickets SET status = 'IN'::public.ticket_status, updated_at = now() WHERE id = v_ticket.id;
    END IF;

    IF v_ticket.category = 'LESSON' THEN
        IF v_ticket.lesson_class_type = 'ONE_ON_TWO' THEN
            v_checkin_type_name := 'Vé Học Bơi 1 Kèm 2';
        ELSIF v_ticket.lesson_class_type = 'GROUP' THEN
            v_checkin_type_name := 'Vé Học Bơi Nhóm';
        ELSIF v_ticket.type_student_count > 1 THEN
            v_checkin_type_name := 'Vé Học Bơi 1 Kèm ' || v_ticket.type_student_count;
        ELSE
            v_checkin_type_name := 'Vé Học Bơi 1 Kèm 1';
        END IF;
    ELSIF v_ticket.category = 'MULTI' THEN
        v_checkin_type_name := 'Vé Bơi Nhiều Buổi';
    ELSIF v_ticket.category = 'MONTHLY' THEN
        v_checkin_type_name := 'Vé Bơi Tháng';
    ELSE
        v_checkin_type_name := 'Vé Lượt Trả Trước';
    END IF;

    IF v_requires_gate_ticket THEN
        -- Vé cổng cho học viên chính (Học viên 1)
        INSERT INTO public.tickets (
            ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until,
            sold_by, price_paid, remaining_sessions, total_sessions, parent_ticket_id, customer_id, card_code
        ) VALUES (
            v_new_ticket_type_id, 'UNUSED'::public.ticket_status, v_ticket.customer_name, v_ticket.customer_phone,
            v_today, v_today, p_staff_id, 0, 1, 1, v_ticket.id, v_ticket.customer_id, v_ticket.card_code
        ) RETURNING id INTO v_new_ticket_id;

        v_tickets_issued := jsonb_build_array(
            jsonb_build_object(
                'id', v_new_ticket_id,
                'type_name', v_checkin_type_name,
                'price_paid', 0,
                'sold_at', now(),
                'pool_close_time', v_close_time,
                'customer_name', v_ticket.customer_name
            )
        );

        -- Xuất thêm vé cổng cho các học viên phụ (hỗ trợ cả extra_students 1-N và customer_name_2 cũ)
        IF v_ticket.category = 'LESSON' THEN
            IF v_ticket.extra_students IS NOT NULL
               AND jsonb_typeof(v_ticket.extra_students) = 'array'
               AND jsonb_array_length(v_ticket.extra_students) > 0 THEN

                FOR v_extra_student IN SELECT * FROM jsonb_array_elements(v_ticket.extra_students)
                LOOP
                    v_extra_idx := v_extra_idx + 1;
                    INSERT INTO public.tickets (
                        ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until,
                        sold_by, price_paid, remaining_sessions, total_sessions, parent_ticket_id, customer_id, card_code
                    ) VALUES (
                        v_new_ticket_type_id, 'UNUSED'::public.ticket_status,
                        COALESCE(NULLIF(v_extra_student->>'name', ''), 'Học viên ' || v_extra_idx),
                        v_ticket.customer_phone, v_today, v_today, p_staff_id, 0, 1, 1,
                        v_ticket.id, v_ticket.customer_id, v_ticket.card_code
                    ) RETURNING id INTO v_sub_ticket_id;

                    v_tickets_issued := v_tickets_issued || jsonb_build_array(
                        jsonb_build_object(
                            'id', v_sub_ticket_id,
                            'type_name', v_checkin_type_name,
                            'price_paid', 0,
                            'sold_at', now(),
                            'pool_close_time', v_close_time,
                            'customer_name', COALESCE(NULLIF(v_extra_student->>'name', ''), 'Học viên ' || v_extra_idx)
                        )
                    );
                END LOOP;

            ELSIF v_ticket.lesson_class_type = 'ONE_ON_TWO'
               OR v_ticket.customer_name_2 IS NOT NULL
               OR v_ticket.type_student_count >= 2 THEN

                FOR v_extra_idx IN 2..GREATEST(2, v_ticket.type_student_count)
                LOOP
                    INSERT INTO public.tickets (
                        ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until,
                        sold_by, price_paid, remaining_sessions, total_sessions, parent_ticket_id, customer_id, card_code
                    ) VALUES (
                        v_new_ticket_type_id, 'UNUSED'::public.ticket_status,
                        CASE WHEN v_extra_idx = 2 THEN COALESCE(v_ticket.customer_name_2, 'Học viên 2') ELSE 'Học viên ' || v_extra_idx END,
                        v_ticket.customer_phone, v_today, v_today, p_staff_id, 0, 1, 1,
                        v_ticket.id, v_ticket.customer_id, v_ticket.card_code
                    ) RETURNING id INTO v_sub_ticket_id;

                    v_tickets_issued := v_tickets_issued || jsonb_build_array(
                        jsonb_build_object(
                            'id', v_sub_ticket_id,
                            'type_name', v_checkin_type_name,
                            'price_paid', 0,
                            'sold_at', now(),
                            'pool_close_time', v_close_time,
                            'customer_name', CASE WHEN v_extra_idx = 2 THEN COALESCE(v_ticket.customer_name_2, 'Học viên 2') ELSE 'Học viên ' || v_extra_idx END
                        )
                    );
                END LOOP;
            END IF;
        END IF;
    END IF;

    -- GHI LOG CHECK-IN
    BEGIN
        INSERT INTO public.checkin_logs (
            source_ticket_id, gate_ticket_id, customer_id, customer_name, card_code,
            ticket_type_name, ticket_category, sport_type, remaining_sessions,
            is_new_activation, requires_gate_ticket, checked_in_by
        ) VALUES (
            v_ticket.id,
            CASE WHEN v_requires_gate_ticket THEN v_new_ticket_id ELSE NULL END,
            v_ticket.customer_id,
            v_ticket.customer_name,
            COALESCE(v_ticket.card_code, ''),
            COALESCE(v_ticket.type_name, 'N/A'),
            COALESCE(v_ticket.category::TEXT, ''),
            COALESCE(v_ticket.sport_type, 'SWIMMING'),
            CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE NULL END,
            v_is_new_package,
            v_requires_gate_ticket,
            p_staff_id
        ) RETURNING id INTO v_checkin_log_id;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'checkin_logs INSERT failed: %', SQLERRM;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'checkin_log_id', v_checkin_log_id,
        'message', CASE WHEN v_is_new_package
            THEN 'Đã KÍCH HOẠT GÓI MỚI và trừ 1 buổi.'
            ELSE 'Check-in thành công. Đã trừ 1 buổi.'
        END,
        'is_new_package', v_is_new_package,
        'requires_gate_ticket', v_requires_gate_ticket,
        'pass_status', jsonb_build_object(
            'customer_name', v_ticket.customer_name,
            'type_name', v_ticket.type_name,
            'category', v_ticket.category,
            'lesson_class_type', v_ticket.lesson_class_type,
            'remaining_sessions', CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE null END,
            'total_sessions', v_ticket.total_sessions,
            'valid_from', v_ticket.valid_from,
            'valid_until', v_ticket.valid_until
        ),
        'tickets_issued', v_tickets_issued,
        'ticket_issued', CASE WHEN v_requires_gate_ticket AND jsonb_array_length(v_tickets_issued) > 0
            THEN v_tickets_issued->0
            ELSE NULL
        END
    );
END;
$$;

-- ============================================================================
-- PHẦN 5: NÂNG CẤP HỦY VÉ & HỦY LƯỢT CHECK-IN (ĐỒNG BỘ checkin_logs & LƯƠNG HLV)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.cancel_ticket(
    p_ticket_id UUID,
    p_reason TEXT,
    p_cancelled_by UUID
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket_record RECORD;
    v_parent_id UUID;
    v_checkin_log RECORD;
    v_caller_role TEXT;
    v_sessions_restored INTEGER := 0;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = p_cancelled_by;
    IF v_caller_role != 'ADMIN' THEN
        RETURN json_build_object('success', false, 'message', 'Chỉ Quản trị viên mới có quyền hủy vé.');
    END IF;

    SELECT t.*, tt.name AS type_name, tt.category AS type_category
    INTO v_ticket_record
    FROM public.tickets t
    JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
    WHERE t.id = p_ticket_id
    FOR UPDATE OF t;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Không tìm thấy vé.');
    END IF;

    IF v_ticket_record.status = 'CANCELLED' THEN
        RETURN json_build_object('success', false, 'message', 'Vé này đã bị hủy trước đó.');
    END IF;

    -- 1. Tìm chính xác gói cha thông qua parent_ticket_id hoặc checkin_logs
    v_parent_id := v_ticket_record.parent_ticket_id;

    SELECT * INTO v_checkin_log
    FROM public.checkin_logs
    WHERE gate_ticket_id = p_ticket_id
      AND status != 'CANCELLED'
    ORDER BY checked_in_at DESC
    LIMIT 1;

    IF v_parent_id IS NULL AND v_checkin_log IS NOT NULL THEN
        v_parent_id := v_checkin_log.source_ticket_id;
    END IF;

    -- Fallback cho dữ liệu cũ trước migration 058 (chưa có parent_ticket_id / checkin_logs)
    IF v_parent_id IS NULL AND v_ticket_record.price_paid = 0 AND v_ticket_record.customer_phone IS NOT NULL THEN
        SELECT t.id INTO v_parent_id
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.customer_phone = v_ticket_record.customer_phone
          AND (t.customer_name = v_ticket_record.customer_name OR t.customer_name IS NULL OR v_ticket_record.customer_name IS NULL)
          AND tt.category IN ('MULTI', 'LESSON')
          AND t.remaining_sessions IS NOT NULL
          AND t.status != 'CANCELLED'
        ORDER BY
            CASE WHEN t.status = 'IN' THEN 0 ELSE 1 END,
            t.created_at DESC
        LIMIT 1;
    END IF;

    -- 2. Nếu là vé cổng 0đ sinh ra từ gói nhiều buổi/học bơi -> hoàn lại 1 buổi (chỉ hoàn 1 lần duy nhất cho cả nhóm vé con)
    IF v_ticket_record.price_paid = 0 AND v_parent_id IS NOT NULL THEN
        -- Nếu đã có 1 vé con khác cùng lần check-in được hủy và hoàn buổi rồi thì không hoàn trùng lần 2
        IF v_checkin_log IS NOT NULL OR NOT EXISTS (
            SELECT 1 FROM public.cancelled_tickets ct
            WHERE ct.parent_ticket_id = v_parent_id
              AND ct.sessions_restored > 0
              AND ABS(EXTRACT(EPOCH FROM (ct.cancelled_at - v_ticket_record.created_at))) < 60
        ) THEN
            UPDATE public.tickets
            SET remaining_sessions = CASE WHEN remaining_sessions IS NOT NULL THEN remaining_sessions + 1 ELSE NULL END,
                status = CASE
                    WHEN status = 'EXPIRED' AND (valid_until IS NULL OR valid_until >= v_today) THEN 'IN'::public.ticket_status
                    ELSE status
                END,
                updated_at = NOW()
            WHERE id = v_parent_id
              AND remaining_sessions IS NOT NULL;

            IF FOUND THEN
                v_sessions_restored := 1;
            END IF;
        END IF;

        -- Đồng bộ trạng thái CANCELLED cho checkin_logs (để loại khỏi bảng lương HLV & lịch sử POS)
        UPDATE public.checkin_logs
        SET status = 'CANCELLED'
        WHERE (gate_ticket_id = p_ticket_id)
           OR (source_ticket_id = v_parent_id
               AND ABS(EXTRACT(EPOCH FROM (checked_in_at - v_ticket_record.created_at))) < 10
               AND status != 'CANCELLED');

        -- Hủy luôn các vé cổng đi kèm trong cùng 1 lần check-in (ví dụ Học viên 2, 3...)
        UPDATE public.tickets
        SET status = 'CANCELLED', updated_at = NOW()
        WHERE parent_ticket_id = v_parent_id
          AND id != p_ticket_id
          AND price_paid = 0
          AND ABS(EXTRACT(EPOCH FROM (created_at - v_ticket_record.created_at))) < 10
          AND status != 'CANCELLED';
    END IF;

    -- 3. Đánh dấu vé hiện tại là CANCELLED
    UPDATE public.tickets
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE id = p_ticket_id;

    INSERT INTO public.cancelled_tickets (ticket_id, parent_ticket_id, cancelled_by, reason, sessions_restored)
    VALUES (p_ticket_id, v_parent_id, p_cancelled_by, p_reason, v_sessions_restored);

    RETURN json_build_object(
        'success', true,
        'sessions_restored', v_sessions_restored,
        'message', 'Hủy vé thành công.' || CASE WHEN v_sessions_restored > 0 THEN ' Đã cộng trả 1 buổi vào gói gốc và cập nhật lịch sử check-in.' ELSE '' END
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$;

-- RPC mới: Hủy trực tiếp từ dòng lịch sử check-in (hỗ trợ cả gói Bóng rổ / requires_gate_ticket = false)
CREATE OR REPLACE FUNCTION public.cancel_checkin_log(
    p_log_id UUID,
    p_reason TEXT,
    p_cancelled_by UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_log RECORD;
    v_caller_role TEXT;
    v_sessions_restored INTEGER := 0;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    v_cancel_res JSONB;
BEGIN
    SELECT role INTO v_caller_role FROM public.profiles WHERE id = p_cancelled_by;
    IF v_caller_role != 'ADMIN' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Chỉ Quản trị viên mới có quyền hủy lượt check-in.');
    END IF;

    SELECT * INTO v_log FROM public.checkin_logs WHERE id = p_log_id FOR UPDATE;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy bản ghi check-in.');
    END IF;

    IF v_log.status = 'CANCELLED' THEN
        RETURN jsonb_build_object('success', false, 'message', 'Lượt check-in này đã bị hủy trước đó.');
    END IF;

    -- Nếu có vé cổng gate_ticket_id thì ủy quyền cho cancel_ticket xử lý đồng bộ
    IF v_log.gate_ticket_id IS NOT NULL THEN
        v_cancel_res := (public.cancel_ticket(v_log.gate_ticket_id, p_reason, p_cancelled_by))::JSONB;
        UPDATE public.checkin_logs SET status = 'CANCELLED' WHERE id = p_log_id;
        RETURN v_cancel_res;
    END IF;

    -- Trường hợp không in vé cổng (requires_gate_ticket = false, ví dụ Bóng rổ)
    IF v_log.source_ticket_id IS NOT NULL THEN
        UPDATE public.tickets
        SET remaining_sessions = CASE WHEN remaining_sessions IS NOT NULL THEN remaining_sessions + 1 ELSE NULL END,
            status = CASE
                WHEN status = 'EXPIRED' AND (valid_until IS NULL OR valid_until >= v_today) THEN 'IN'::public.ticket_status
                ELSE status
            END,
            updated_at = NOW()
        WHERE id = v_log.source_ticket_id
          AND remaining_sessions IS NOT NULL;

        IF FOUND THEN
            v_sessions_restored := 1;
        END IF;
    END IF;

    UPDATE public.checkin_logs SET status = 'CANCELLED' WHERE id = p_log_id;

    RETURN jsonb_build_object(
        'success', true,
        'sessions_restored', v_sessions_restored,
        'message', 'Đã hủy lượt check-in thành công.' || CASE WHEN v_sessions_restored > 0 THEN ' Đã cộng trả 1 buổi vào gói gốc.' ELSE '' END
    );
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'message', SQLERRM);
END;
$$;

-- ============================================================================
-- PHẦN 6: ĐỒNG BỘ RPC KIỂM SOÁT CỔNG (check_qr_ticket_text & validate_and_scan)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.check_qr_ticket_text(
    p_ticket_code TEXT,
    p_direction public.scan_direction,
    p_scanned_by UUID,
    p_gate_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket_id     UUID;
    v_ticket        RECORD;
    v_new_status    public.ticket_status;
    v_fail_reason   TEXT;
    v_schedule      JSONB;
    v_day_key       TEXT;
    v_day_schedule  JSONB;
    v_now_time      TIME;
    v_open_time     TIME;
    v_close_time    TIME;
    v_today         DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    v_normalized_code TEXT;
BEGIN
    p_ticket_code := UPPER(TRIM(p_ticket_code));
    v_normalized_code := public.normalize_card_code(p_ticket_code);

    -- 1. Kiểm tra giờ hoạt động hồ bơi
    SELECT value INTO v_schedule FROM public.system_settings WHERE key = 'pool_weekly_schedule';
    IF v_schedule IS NOT NULL THEN
        v_day_key := lower(to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'Dy'));
        v_day_schedule := v_schedule -> v_day_key;

        IF v_day_schedule IS NOT NULL THEN
            IF (v_day_schedule ->> 'closed')::boolean = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED', 'message', 'Hồ bơi hôm nay NGHỈ. Vui lòng quay lại vào ngày khác.');
            END IF;

            v_now_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;
            v_open_time := (v_day_schedule ->> 'open')::TIME;
            v_close_time := (v_day_schedule ->> 'close')::TIME;

            IF v_now_time < v_open_time THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_NOT_OPEN', 'message', 'Hồ bơi chưa mở cửa. Giờ mở: ' || (v_day_schedule ->> 'open') || '.');
            END IF;

            IF p_direction = 'IN' AND v_now_time > v_close_time THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED_NOW', 'message', 'Hồ bơi đã đóng cửa. Giờ đóng: ' || (v_day_schedule ->> 'close') || '.');
            END IF;
        END IF;
    END IF;

    -- 2. Tìm vé và khóa dòng
    BEGIN
        v_ticket_id := p_ticket_code::UUID;
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        LEFT JOIN public.customers c ON t.customer_id = c.id
        WHERE t.id = v_ticket_id
           OR public.normalize_card_code(t.card_code) = v_normalized_code
           OR public.normalize_card_code(c.card_code) = v_normalized_code
        ORDER BY
            CASE WHEN t.status = 'CANCELLED' THEN 1 ELSE 0 END ASC,
            t.created_at DESC
        LIMIT 1
        FOR UPDATE OF t;
    EXCEPTION WHEN invalid_text_representation THEN
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        LEFT JOIN public.customers c ON t.customer_id = c.id
        WHERE public.normalize_card_code(t.card_code) = v_normalized_code
           OR public.normalize_card_code(c.card_code) = v_normalized_code
        ORDER BY
            CASE WHEN t.status = 'CANCELLED' THEN 1 ELSE 0 END ASC,
            t.created_at DESC
        LIMIT 1
        FOR UPDATE OF t;
    END;

    IF v_ticket IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TICKET_NOT_FOUND', 'message', 'Vé/Thẻ không tồn tại trong hệ thống.');
    END IF;

    v_ticket_id := v_ticket.id;

    -- 3. Chặn triệt để vé đã bị HỦY (CANCELLED)
    IF v_ticket.status = 'CANCELLED' THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (v_ticket_id, p_direction, false, 'TICKET_CANCELLED', p_scanned_by, p_gate_id);

        RETURN jsonb_build_object('success', false, 'error', 'TICKET_CANCELLED', 'message', 'Vé/Thẻ này đã bị hủy.');
    END IF;

    -- 4. Xử lý logic theo Category
    IF v_ticket.category = 'DAILY' THEN
        IF (v_ticket.valid_until IS NOT NULL AND v_today > v_ticket.valid_until)
           OR (v_ticket.valid_until IS NULL AND (v_ticket.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE < v_today) THEN
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = v_ticket_id;
            v_ticket.status := 'EXPIRED';
            v_fail_reason := 'TICKET_EXPIRED';
        END IF;

        IF v_fail_reason IS NULL THEN
            IF p_direction = 'IN' THEN
                IF v_ticket.status = 'UNUSED' THEN v_new_status := 'IN';
                ELSIF v_ticket.status = 'IN' THEN v_fail_reason := 'ALREADY_INSIDE';
                ELSIF v_ticket.status = 'OUT' THEN v_fail_reason := 'DAILY_TICKET_USED';
                ELSIF v_ticket.status = 'EXPIRED' THEN v_fail_reason := 'TICKET_EXPIRED';
                ELSE v_fail_reason := 'INVALID_STATUS';
                END IF;
            ELSIF p_direction = 'OUT' THEN
                IF v_ticket.status = 'IN' THEN v_new_status := 'OUT';
                ELSIF v_ticket.status = 'UNUSED' THEN v_fail_reason := 'NOT_CHECKED_IN';
                ELSIF v_ticket.status = 'OUT' THEN v_fail_reason := 'ALREADY_EXITED';
                ELSIF v_ticket.status = 'EXPIRED' THEN v_fail_reason := 'TICKET_EXPIRED';
                ELSE v_fail_reason := 'INVALID_STATUS';
                END IF;
            END IF;
        END IF;

    ELSIF v_ticket.category IN ('MONTHLY', 'MULTI', 'LESSON') THEN
        IF v_ticket.valid_until IS NOT NULL AND v_today > v_ticket.valid_until THEN
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = v_ticket_id;
            v_fail_reason := 'TICKET_EXPIRED';
        ELSIF v_ticket.valid_from IS NOT NULL AND v_today < v_ticket.valid_from THEN
            v_fail_reason := 'MONTHLY_PASS_NOT_STARTED';
        ELSE
            IF p_direction = 'IN' THEN
                IF v_ticket.status = 'UNUSED' OR v_ticket.last_scan_direction = 'OUT' OR v_ticket.last_scan_direction IS NULL THEN
                    IF v_ticket.remaining_sessions IS NOT NULL THEN
                        IF v_ticket.remaining_sessions <= 0 THEN
                            v_fail_reason := 'NO_SESSIONS_LEFT';
                        ELSE
                            v_new_status := 'IN';
                        END IF;
                    ELSE
                        v_new_status := 'IN';
                    END IF;
                ELSE
                    v_fail_reason := 'ANTI_PASSBACK_VIOLATION';
                END IF;
            ELSIF p_direction = 'OUT' THEN
                IF v_ticket.last_scan_direction = 'IN' OR v_ticket.status = 'IN' THEN
                    v_new_status := 'OUT';
                ELSE
                    v_fail_reason := 'ANTI_PASSBACK_VIOLATION';
                END IF;
            END IF;
        END IF;
    ELSE
        v_fail_reason := 'UNSUPPORTED_CATEGORY';
    END IF;

    -- 5. Ghi nhận kết quả
    IF v_fail_reason IS NOT NULL THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (v_ticket_id, p_direction, false, v_fail_reason, p_scanned_by, p_gate_id);

        RETURN jsonb_build_object(
            'success', false,
            'error', v_fail_reason,
            'message', CASE v_fail_reason
                WHEN 'ALREADY_INSIDE'           THEN 'Khách đã ở bên trong hồ.'
                WHEN 'DAILY_TICKET_USED'        THEN 'Vé lượt đã sử dụng.'
                WHEN 'TICKET_EXPIRED'           THEN 'Vé/Thẻ đã hết hạn.'
                WHEN 'NOT_CHECKED_IN'           THEN 'Vé chưa quét vào nên không thể quét ra.'
                WHEN 'ALREADY_EXITED'           THEN 'Khách đã quét ra ngoài rồi.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Thẻ chưa đến ngày bắt đầu hiệu lực.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Vi phạm chống xoay vòng thẻ (chưa quét ra/vào đúng thứ tự).'
                WHEN 'NO_SESSIONS_LEFT'         THEN 'Thẻ đã hết số buổi bơi (0 lượt).'
                ELSE 'Không hợp lệ: ' || v_fail_reason
            END
        );
    ELSE
        DECLARE
            v_final_remaining INTEGER := v_ticket.remaining_sessions;
        BEGIN
            IF p_direction = 'IN' AND v_ticket.remaining_sessions IS NOT NULL THEN
                v_final_remaining := v_ticket.remaining_sessions - 1;
            END IF;

            UPDATE public.tickets
            SET status = COALESCE(v_new_status, status),
                last_scan_direction = p_direction,
                last_scan_at = now(),
                remaining_sessions = v_final_remaining,
                updated_at = now()
            WHERE id = v_ticket_id;

            INSERT INTO public.scan_logs (ticket_id, direction, success, scanned_by, gate_id)
            VALUES (v_ticket_id, p_direction, true, p_scanned_by, p_gate_id);

            RETURN jsonb_build_object(
                'success', true,
                'ticket', jsonb_build_object(
                    'id', v_ticket_id,
                    'type_name', v_ticket.type_name,
                    'category', v_ticket.category,
                    'customer_name', v_ticket.customer_name,
                    'new_status', v_new_status,
                    'remaining_sessions', v_final_remaining
                ),
                'message', CASE p_direction WHEN 'IN' THEN 'MỜI VÀO CỔNG' ELSE 'TẠM BIỆT - HẸN GẶP LẠI' END
            );
        END;
    END IF;
END;
$$;

-- Đồng bộ validate_and_scan ủy quyền về cùng logic đầy đủ 4 category
CREATE OR REPLACE FUNCTION public.validate_and_scan(
    p_ticket_id     UUID,
    p_direction     public.scan_direction,
    p_scanned_by    UUID DEFAULT NULL,
    p_gate_id       TEXT DEFAULT 'GATE_01'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN public.check_qr_ticket_text(p_ticket_id::TEXT, p_direction, p_scanned_by, NULL);
END;
$$;

-- ============================================================================
-- PHẦN 7: RPC TRANSACTION CHO PHIẾU KHO, ĐỔI MÃ THẺ & ĐỒNG BỘ ĐƠN HÀNG
-- ============================================================================

-- 7.1. Lập phiếu Nhập / Xuất kho nhiều mặt hàng trong 1 Transaction nguyên tử
CREATE OR REPLACE FUNCTION public.process_inventory_slip(
    p_type VARCHAR(50),       -- 'IMPORT' / 'IN' hoặc 'EXPORT_ADJUST' / 'OUT'
    p_items JSONB,            -- [{ "product_id": "...", "quantity": 5 }, ...]
    p_note TEXT,
    p_user_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_item JSONB;
    v_prod_id UUID;
    v_qty INTEGER;
    v_delta INTEGER;
    v_log_type VARCHAR(50);
    v_stock INTEGER;
    v_name TEXT;
    v_processed INTEGER := 0;
BEGIN
    IF p_type NOT IN ('IN', 'OUT', 'IMPORT', 'EXPORT_ADJUST') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Loại phiếu không hợp lệ.');
    END IF;

    v_log_type := CASE WHEN p_type IN ('IN', 'IMPORT') THEN 'IMPORT' ELSE 'EXPORT_ADJUST' END;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_prod_id := (v_item->>'product_id')::UUID;
        v_qty := COALESCE((v_item->>'quantity')::INTEGER, 0);

        IF v_qty <= 0 THEN
            RAISE EXCEPTION 'Số lượng mặt hàng phải lớn hơn 0.';
        END IF;

        SELECT stock_quantity, name INTO v_stock, v_name
        FROM public.products
        WHERE id = v_prod_id
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Không tìm thấy sản phẩm ID %.', v_prod_id;
        END IF;

        IF v_log_type = 'EXPORT_ADJUST' AND v_stock < v_qty THEN
            RAISE EXCEPTION 'Sản phẩm "%" không đủ tồn kho để xuất (Tồn: %, Xuất: %).', v_name, v_stock, v_qty;
        END IF;

        v_delta := CASE WHEN v_log_type = 'IMPORT' THEN v_qty ELSE -v_qty END;

        UPDATE public.products
        SET stock_quantity = stock_quantity + v_delta
        WHERE id = v_prod_id;

        INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
        VALUES (v_prod_id, v_log_type, v_delta, p_note, p_user_id);

        v_processed := v_processed + 1;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'processed_count', v_processed);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 7.2. Đổi mã thẻ khách hàng nguyên tử trong 1 Transaction
CREATE OR REPLACE FUNCTION public.change_customer_card_code(
    p_ticket_id UUID,
    p_customer_id UUID,
    p_old_code TEXT,
    p_new_code TEXT,
    p_actor_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_clean_new TEXT := UPPER(TRIM(COALESCE(p_new_code, '')));
    v_clean_old TEXT := UPPER(TRIM(COALESCE(p_old_code, '')));
    v_bank_card RECORD;
    v_conflict_cust RECORD;
BEGIN
    IF v_clean_new = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mã thẻ mới không được để trống.');
    END IF;

    -- Kiểm tra thẻ mới có đang gắn cho khách hàng khác không
    SELECT id, full_name INTO v_conflict_cust
    FROM public.customers
    WHERE public.normalize_card_code(card_code) = public.normalize_card_code(v_clean_new)
      AND (p_customer_id IS NULL OR id != p_customer_id)
    LIMIT 1;

    IF v_conflict_cust IS NOT NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mã thẻ này đang thuộc về khách hàng "' || v_conflict_cust.full_name || '".');
    END IF;

    -- Kiểm tra kho thẻ card_bank
    SELECT * INTO v_bank_card
    FROM public.card_bank
    WHERE card_code = v_clean_new
    FOR UPDATE;

    IF FOUND AND v_bank_card.status = 'REVOKED' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mã thẻ này đã bị thu hồi vĩnh viễn, không thể cấp lại.');
    END IF;

    IF FOUND AND v_bank_card.status = 'USED' AND v_clean_new != v_clean_old THEN
        RETURN jsonb_build_object('success', false, 'error', 'Mã thẻ này đã được đánh dấu ĐANG SỬ DỤNG trong kho thẻ.');
    END IF;

    -- 1. Cập nhật các gói thẻ liên quan
    IF v_clean_old != '' THEN
        UPDATE public.tickets
        SET card_code = v_clean_new, updated_at = now()
        WHERE (p_customer_id IS NOT NULL AND customer_id = p_customer_id AND public.normalize_card_code(card_code) = public.normalize_card_code(v_clean_old))
           OR id = p_ticket_id;
    ELSE
        UPDATE public.tickets
        SET card_code = v_clean_new, updated_at = now()
        WHERE id = p_ticket_id;
    END IF;

    -- 2. Cập nhật khách hàng
    IF p_customer_id IS NOT NULL THEN
        UPDATE public.customers
        SET card_code = v_clean_new
        WHERE id = p_customer_id;
    END IF;

    -- 3. Cập nhật kho thẻ mới -> USED
    IF v_bank_card IS NOT NULL THEN
        UPDATE public.card_bank SET status = 'USED' WHERE id = v_bank_card.id;
    ELSE
        INSERT INTO public.card_bank (card_code, prefix, month_year, sequence_number, random_suffix, status, batch_note, created_by)
        VALUES (v_clean_new, 'MANUAL', '0000', 0, '00', 'USED', 'Gán thủ công khi đổi thẻ', p_actor_id)
        ON CONFLICT (card_code) DO UPDATE SET status = 'USED';
    END IF;

    -- 4. Thu hồi thẻ cũ -> REVOKED
    IF v_clean_old != '' AND v_clean_old != v_clean_new THEN
        INSERT INTO public.card_bank (card_code, prefix, month_year, sequence_number, random_suffix, status, batch_note, created_by)
        VALUES (v_clean_old, 'OLD', '0000', 0, '00', 'REVOKED', 'Thu hồi tự động do đổi sang thẻ ' || v_clean_new, p_actor_id)
        ON CONFLICT (card_code) DO UPDATE SET status = 'REVOKED';
    END IF;

    RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 7.3. Đồng bộ lại orders & order_items khi Admin sửa giá / phương thức thanh toán hoặc xóa gói thẻ
CREATE OR REPLACE FUNCTION public.sync_order_after_ticket_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_order_id UUID;
    v_tickets_sum BIGINT;
    v_products_sum BIGINT;
BEGIN
    v_order_id := COALESCE(NEW.order_id, OLD.order_id);
    IF v_order_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;

    IF TG_OP = 'UPDATE' THEN
        -- Nếu thay đổi giá hoặc phương thức thanh toán của gói thẻ gắn với đơn hàng
        IF NEW.price_paid IS DISTINCT FROM OLD.price_paid OR NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
            UPDATE public.order_items
            SET unit_price = NEW.price_paid,
                subtotal = NEW.price_paid * quantity
            WHERE order_id = v_order_id
              AND ticket_type_id = NEW.ticket_type_id
              AND quantity = 1;

            SELECT COALESCE(SUM(price_paid), 0) INTO v_tickets_sum
            FROM public.tickets
            WHERE order_id = v_order_id AND status != 'CANCELLED';

            SELECT COALESCE(SUM(subtotal), 0) INTO v_products_sum
            FROM public.order_items
            WHERE order_id = v_order_id AND product_id IS NOT NULL;

            UPDATE public.orders
            SET total_amount = v_tickets_sum + v_products_sum,
                payment_method = COALESCE(NEW.payment_method::TEXT, payment_method)
            WHERE id = v_order_id;
        END IF;
        RETURN NEW;

    ELSIF TG_OP = 'DELETE' THEN
        DELETE FROM public.order_items
        WHERE id IN (
            SELECT id FROM public.order_items
            WHERE order_id = v_order_id AND ticket_type_id = OLD.ticket_type_id
            LIMIT 1
        );

        SELECT COALESCE(SUM(price_paid), 0) INTO v_tickets_sum
        FROM public.tickets
        WHERE order_id = v_order_id AND id != OLD.id AND status != 'CANCELLED';

        SELECT COALESCE(SUM(subtotal), 0) INTO v_products_sum
        FROM public.order_items
        WHERE order_id = v_order_id AND product_id IS NOT NULL;

        UPDATE public.orders
        SET total_amount = v_tickets_sum + v_products_sum
        WHERE id = v_order_id;

        RETURN OLD;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_order_after_ticket_change ON public.tickets;
CREATE TRIGGER trg_sync_order_after_ticket_change
    AFTER UPDATE OF price_paid, payment_method OR DELETE ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_order_after_ticket_change();

-- ============================================================================
-- PHẦN 8: NHẬT KÝ KIỂM TOÁN (audit_logs) & KHÓA KỲ KẾ TOÁN (accounting_months)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.accounting_months (
    month VARCHAR(7) PRIMARY KEY, -- YYYY-MM
    status VARCHAR(20) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED')),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    note TEXT
);

ALTER TABLE public.accounting_months ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "accounting_months_select_auth" ON public.accounting_months;
DROP POLICY IF EXISTS "accounting_months_write_admin" ON public.accounting_months;
CREATE POLICY "accounting_months_select_auth"
    ON public.accounting_months FOR SELECT TO authenticated USING (true);
CREATE POLICY "accounting_months_write_admin"
    ON public.accounting_months FOR ALL TO authenticated USING (public.is_admin_user()) WITH CHECK (public.is_admin_user());

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action VARCHAR(20) NOT NULL,
    table_name VARCHAR(60) NOT NULL,
    record_id TEXT,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_record ON public.audit_logs(table_name, record_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audit_logs_admin_select" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select"
    ON public.audit_logs FOR SELECT TO authenticated USING (public.is_admin_user());

-- Trigger tự động ghi nhận lịch sử sửa/xóa nhạy cảm trên tickets, orders, financial_transactions, expenses
CREATE OR REPLACE FUNCTION public.record_sensitive_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data)
        VALUES (auth.uid(), 'DELETE', TG_TABLE_NAME, OLD.id::TEXT, to_jsonb(OLD));
        RETURN OLD;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Bỏ qua các cập nhật quét cổng tự động (chỉ đổi last_scan_at) để không làm phình bảng log
        IF TG_TABLE_NAME = 'tickets'
           AND OLD.price_paid IS NOT DISTINCT FROM NEW.price_paid
           AND OLD.total_sessions IS NOT DISTINCT FROM NEW.total_sessions
           AND OLD.valid_until IS NOT DISTINCT FROM NEW.valid_until
           AND OLD.card_code IS NOT DISTINCT FROM NEW.card_code
           AND OLD.payment_method IS NOT DISTINCT FROM NEW.payment_method
           AND OLD.sold_at IS NOT DISTINCT FROM NEW.sold_at
           AND NEW.status != 'CANCELLED' THEN
            RETURN NEW;
        END IF;

        INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
        VALUES (auth.uid(), 'UPDATE', TG_TABLE_NAME, NEW.id::TEXT, to_jsonb(OLD), to_jsonb(NEW));
        RETURN NEW;
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_tickets ON public.tickets;
CREATE TRIGGER trg_audit_tickets
    AFTER UPDATE OR DELETE ON public.tickets
    FOR EACH ROW EXECUTE FUNCTION public.record_sensitive_audit_log();

DROP TRIGGER IF EXISTS trg_audit_expenses ON public.expenses;
CREATE TRIGGER trg_audit_expenses
    AFTER UPDATE OR DELETE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.record_sensitive_audit_log();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_transactions') THEN
        DROP TRIGGER IF EXISTS trg_audit_fin_tx ON public.financial_transactions;
        CREATE TRIGGER trg_audit_fin_tx
            AFTER UPDATE OR DELETE ON public.financial_transactions
            FOR EACH ROW EXECUTE FUNCTION public.record_sensitive_audit_log();
    END IF;
END $$;

-- Trigger chặn sửa/xóa giao dịch tài chính thuộc kỳ kế toán đã CLOSED
CREATE OR REPLACE FUNCTION public.enforce_accounting_month_lock()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_month VARCHAR(7);
    v_new_month VARCHAR(7);
BEGIN
    IF TG_TABLE_NAME = 'financial_transactions' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_old_month := to_char(OLD.transaction_date, 'YYYY-MM');
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_month := to_char(NEW.transaction_date, 'YYYY-MM');
        END IF;
    ELSIF TG_TABLE_NAME = 'expenses' THEN
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_old_month := to_char((OLD.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE, 'YYYY-MM');
        END IF;
        IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_month := to_char((NEW.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE, 'YYYY-MM');
        END IF;
    END IF;

    IF v_old_month IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounting_months WHERE month = v_old_month AND status = 'CLOSED') THEN
        RAISE EXCEPTION 'Kỳ kế toán tháng % đã khóa sổ, không thể chỉnh sửa hoặc xóa giao dịch.', v_old_month;
    END IF;

    IF v_new_month IS NOT NULL AND EXISTS (SELECT 1 FROM public.accounting_months WHERE month = v_new_month AND status = 'CLOSED') THEN
        RAISE EXCEPTION 'Kỳ kế toán tháng % đã khóa sổ, không thể thêm hoặc chuyển giao dịch vào tháng này.', v_new_month;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_expenses_month ON public.expenses;
CREATE TRIGGER trg_lock_expenses_month
    BEFORE INSERT OR UPDATE OR DELETE ON public.expenses
    FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_month_lock();

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'financial_transactions') THEN
        DROP TRIGGER IF EXISTS trg_lock_fin_tx_month ON public.financial_transactions;
        CREATE TRIGGER trg_lock_fin_tx_month
            BEFORE INSERT OR UPDATE OR DELETE ON public.financial_transactions
            FOR EACH ROW EXECUTE FUNCTION public.enforce_accounting_month_lock();
    END IF;
END $$;
