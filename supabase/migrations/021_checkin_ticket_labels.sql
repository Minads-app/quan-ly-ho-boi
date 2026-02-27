-- ============================================================
-- 021_checkin_ticket_labels.sql
-- Cập nhật hàm check-in:
--   1. Trả thêm category để frontend phân biệt VÉ BƠI TRẢ TRƯỚC vs VÉ HỌC BƠI
--   2. Cảnh báo lễ tân khi gói hiện tại hết buổi và cần kích hoạt gói mới
--      (p_confirm_new_package = false → trả needs_confirmation,
--       p_confirm_new_package = true  → kích hoạt gói mới)
-- ============================================================

CREATE OR REPLACE FUNCTION public.checkin_pass_and_issue_ticket(
    p_pass_id TEXT,
    p_staff_id UUID,
    p_confirm_new_package BOOLEAN DEFAULT false
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
    v_checkin_type_name TEXT;
    v_is_new_package BOOLEAN := false;
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

        -- Tìm thấy gói chưa kích hoạt
        IF v_ticket IS NOT NULL THEN
            v_is_new_package := true;

            -- =====================================================
            -- CẢNH BÁO LỄ TÂN: Gói cũ hết buổi, cần kích hoạt gói mới
            -- Trả về needs_confirmation nếu chưa được xác nhận
            -- =====================================================
            IF NOT p_confirm_new_package THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'needs_confirmation', true,
                    'message', 'Gói hiện tại đã HẾT BUỔI. Tìm thấy gói mới chưa kích hoạt. Bạn có muốn kích hoạt gói mới và trừ 1 buổi không?',
                    'new_package_info', jsonb_build_object(
                        'customer_name', v_ticket.customer_name,
                        'type_name', v_ticket.type_name,
                        'category', v_ticket.category,
                        'total_sessions', v_ticket.total_sessions,
                        'remaining_sessions', v_ticket.remaining_sessions
                    )
                );
            END IF;

            -- Đã xác nhận → Kích hoạt gói mới
            IF v_ticket.duration_unit = 'months' AND v_ticket.duration_months IS NOT NULL THEN
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

    -- Xác định tên loại vé check-in dựa trên category
    IF v_ticket.category = 'LESSON' THEN
        v_checkin_type_name := 'VÉ HỌC BƠI';
    ELSE
        v_checkin_type_name := 'VÉ BƠI TRẢ TRƯỚC';
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE WHEN v_is_new_package
            THEN 'Đã KÍCH HOẠT GÓI MỚI và trừ 1 buổi.'
            ELSE 'Check-in thành công. Đã trừ 1 buổi.'
        END,
        'is_new_package', v_is_new_package,
        'pass_status', jsonb_build_object(
            'customer_name', v_ticket.customer_name,
            'type_name', v_ticket.type_name,
            'category', v_ticket.category,
            'remaining_sessions', CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE null END,
            'total_sessions', v_ticket.total_sessions,
            'valid_from', v_ticket.valid_from,
            'valid_until', v_ticket.valid_until
        ),
        'new_ticket', jsonb_build_object(
            'id', v_new_ticket_id,
            'type_name', v_checkin_type_name,
            'price_paid', 0,
            'sold_at', now(),
            'pool_close_time', v_close_time,
            'customer_name', v_ticket.customer_name
        )
    );
END;
$$;
