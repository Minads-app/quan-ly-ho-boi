-- ============================================================
-- PHASE 2: QR Manual Gate Control Mode
-- system_settings + check_qr_ticket function
-- ============================================================

-- ============================================================
-- 1. SYSTEM SETTINGS TABLE
-- ============================================================

CREATE TABLE public.system_settings (
    key         TEXT PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  UUID REFERENCES public.profiles(id)
);

COMMENT ON TABLE public.system_settings IS 'Key-value configuration store. Managed by ADMIN.';

-- Default settings
INSERT INTO public.system_settings (key, value) VALUES
    ('gate_control_mode', '"MANUAL_QR"'),       -- "AUTO_GATE" or "MANUAL_QR"
    ('pool_open_time',    '"06:00"'),            -- Pool opening time (HH:MM)
    ('pool_close_time',   '"20:00"');            -- Pool closing time (HH:MM)

-- ============================================================
-- 2. RLS FOR system_settings
-- ============================================================

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read settings
CREATE POLICY "settings_select_authenticated"
    ON public.system_settings FOR SELECT
    TO authenticated
    USING (true);

-- Only ADMIN can modify settings
CREATE POLICY "settings_insert_admin"
    ON public.system_settings FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "settings_update_admin"
    ON public.system_settings FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "settings_delete_admin"
    ON public.system_settings FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- ============================================================
-- 3. CHECK QR TICKET FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION public.check_qr_ticket(
    p_ticket_id     UUID,
    p_checked_by    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket        RECORD;
    v_ticket_type   RECORD;
    v_fail_reason   TEXT;
    v_open_time     TIME;
    v_close_time    TIME;
    v_now           TIMESTAMPTZ;
    v_current_time  TIME;
BEGIN
    v_now := now();
    v_current_time := v_now::time;

    -- ========================================
    -- Step 1: Get pool operating hours
    -- ========================================
    SELECT (value #>> '{}')::time INTO v_open_time
    FROM public.system_settings WHERE key = 'pool_open_time';

    SELECT (value #>> '{}')::time INTO v_close_time
    FROM public.system_settings WHERE key = 'pool_close_time';

    -- Default fallback
    v_open_time  := COALESCE(v_open_time,  '06:00'::time);
    v_close_time := COALESCE(v_close_time, '20:00'::time);

    -- ========================================
    -- Step 2: Check if pool is currently open
    -- ========================================
    IF v_current_time < v_open_time OR v_current_time > v_close_time THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'POOL_CLOSED',
            'message', format('Hồ bơi đã đóng cửa. Giờ hoạt động: %s - %s',
                v_open_time::text, v_close_time::text)
        );
    END IF;

    -- ========================================
    -- Step 3: Lock and fetch ticket
    -- ========================================
    SELECT t.*, tt.category, tt.name AS type_name
    INTO v_ticket
    FROM public.tickets t
    JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
    WHERE t.id = p_ticket_id
    FOR UPDATE;

    -- Ticket not found
    IF NOT FOUND THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, 'IN', false, 'TICKET_NOT_FOUND', p_checked_by, 'MANUAL_QR');

        RETURN jsonb_build_object(
            'success', false,
            'error', 'TICKET_NOT_FOUND',
            'message', 'Mã QR không hợp lệ. Vé không tồn tại trong hệ thống.'
        );
    END IF;

    -- ========================================
    -- Step 4: Validate ticket
    -- ========================================

    -- Check if ticket was sold today (for daily tickets)
    IF v_ticket.category = 'DAILY' THEN
        IF v_ticket.sold_at::date <> v_now::date THEN
            v_fail_reason := 'TICKET_EXPIRED';
        ELSIF v_ticket.status = 'IN' THEN
            v_fail_reason := 'ALREADY_INSIDE';
        ELSIF v_ticket.status = 'OUT' THEN
            v_fail_reason := 'DAILY_TICKET_USED';
        ELSIF v_ticket.status = 'EXPIRED' THEN
            v_fail_reason := 'TICKET_EXPIRED';
        ELSIF v_ticket.status <> 'UNUSED' THEN
            v_fail_reason := 'INVALID_STATUS';
        END IF;

    -- Monthly ticket validation
    ELSIF v_ticket.category = 'MONTHLY' THEN
        IF v_ticket.valid_until IS NOT NULL AND CURRENT_DATE > v_ticket.valid_until THEN
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now()
            WHERE id = p_ticket_id;
            v_fail_reason := 'MONTHLY_PASS_EXPIRED';
        ELSIF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
            v_fail_reason := 'MONTHLY_PASS_NOT_STARTED';
        ELSIF v_ticket.status = 'IN' OR v_ticket.last_scan_direction = 'IN' THEN
            v_fail_reason := 'ALREADY_INSIDE';
        ELSIF v_ticket.status = 'EXPIRED' THEN
            v_fail_reason := 'MONTHLY_PASS_EXPIRED';
        END IF;
    END IF;

    -- ========================================
    -- Step 5: Apply result
    -- ========================================
    IF v_fail_reason IS NOT NULL THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, 'IN', false, v_fail_reason, p_checked_by, 'MANUAL_QR');

        RETURN jsonb_build_object(
            'success', false,
            'error', v_fail_reason,
            'message', CASE v_fail_reason
                WHEN 'ALREADY_INSIDE'           THEN 'Khách đã ở bên trong. Vé đã được sử dụng.'
                WHEN 'DAILY_TICKET_USED'        THEN 'Vé lượt đã sử dụng. Không thể tái sử dụng.'
                WHEN 'TICKET_EXPIRED'           THEN 'Vé đã hết hạn (không phải hôm nay hoặc hết giờ).'
                WHEN 'MONTHLY_PASS_EXPIRED'     THEN 'Vé tháng đã hết hạn.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Vé tháng chưa đến ngày bắt đầu.'
                WHEN 'INVALID_STATUS'           THEN 'Trạng thái vé không hợp lệ.'
                ELSE 'Lỗi không xác định.'
            END,
            'ticket_id', p_ticket_id,
            'ticket_status', v_ticket.status
        );
    ELSE
        -- Success: mark ticket as IN
        UPDATE public.tickets
        SET
            status = 'IN',
            last_scan_direction = 'IN',
            last_scan_at = v_now,
            updated_at = v_now
        WHERE id = p_ticket_id;

        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, 'IN', true, NULL, p_checked_by, 'MANUAL_QR');

        RETURN jsonb_build_object(
            'success', true,
            'message', 'Vé hợp lệ ✓ Cho khách vào!',
            'ticket_id', p_ticket_id,
            'ticket_status', 'IN',
            'type_name', v_ticket.type_name,
            'category', v_ticket.category,
            'customer_name', COALESCE(v_ticket.customer_name, ''),
            'pool_close_time', v_close_time::text
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION public.check_qr_ticket IS
'Manual QR gate check. Validates ticket against pool hours, status, and expiry. Only for MANUAL_QR gate mode.';

-- ============================================================
-- DONE — Phase 2 Migration Complete
-- ============================================================
