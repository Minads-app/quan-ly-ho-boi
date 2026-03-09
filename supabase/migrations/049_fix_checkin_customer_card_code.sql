-- ============================================================
-- 049_fix_checkin_customer_card_code.sql
-- Khắc phục lỗi nhầm lẫn ký tự khi quét mã thẻ
-- (l ↔ I, O ↔ 0, 1 ↔ L)
-- Tạo hàm normalize_card_code() để chuẩn hóa trước khi so sánh
-- ============================================================

-- 1. Hàm chuẩn hóa mã thẻ: thay thế ký tự dễ nhầm lẫn
CREATE OR REPLACE FUNCTION public.normalize_card_code(code TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    -- Chuyển hoa → thay I→L, O→0, 1→L để tất cả ký tự nhầm lẫn thành 1 dạng duy nhất
    SELECT REPLACE(
             REPLACE(
               REPLACE(
                 UPPER(TRIM(COALESCE(code, ''))),
                 'I', 'L'    -- I hoa → L (vì l thường lên hoa cũng là L)
               ),
               'O', '0'     -- O hoa → 0 (số không)
             ),
             '1', 'L'       -- số 1 → L
           )
$$;


-- 2. Cập nhật hàm checkin_pass_and_issue_ticket (POS Check-in)
CREATE OR REPLACE FUNCTION public.checkin_pass_and_issue_ticket(
    p_pass_id TEXT,
    p_staff_id UUID,
    p_confirm_new_package BOOLEAN DEFAULT false,
    p_selected_ticket_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket RECORD;
    v_new_ticket_type_id UUID;
    v_new_ticket_id UUID;
    v_new_ticket_id_2 UUID;
    v_close_time TEXT := '20:00';
    v_pass_uuid UUID;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
    v_valid_until DATE;
    v_checkin_type_name TEXT;
    v_is_new_package BOOLEAN := false;
    v_tickets_issued JSONB;
    v_available_tickets JSONB := '[]'::jsonb;
    v_available_count INTEGER := 0;
    v_normalized_code TEXT;
BEGIN
    -- Chuẩn hóa mã đầu vào
    p_pass_id := UPPER(TRIM(p_pass_id));
    v_normalized_code := public.normalize_card_code(p_pass_id);

    -- Tìm ticket type để xuất vé lượt
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

    -- =========================================================================
    -- PHẦN A: NẾU ĐÃ CÓ p_selected_ticket_id
    -- =========================================================================
    IF p_selected_ticket_id IS NOT NULL THEN
        SELECT t.*, tt.category, tt.name AS type_name, tt.validity_days, tt.duration_months, tt.duration_unit, tt.lesson_class_type
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.id = p_selected_ticket_id
        FOR UPDATE;

        IF v_ticket IS NULL THEN
            RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy gói đã chọn.');
        END IF;

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

    -- =========================================================================
    -- PHẦN B: QUÉT TÌM CÁC GÓI (dùng normalize_card_code để so sánh)
    -- =========================================================================
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
                'sold_at', t.sold_at
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
          AND t.status != 'EXPIRED'::public.ticket_status
          AND (
              (t.valid_from IS NOT NULL AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0) AND (t.valid_until IS NULL OR v_today <= t.valid_until))
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
                ELSE
                    RETURN jsonb_build_object('success', false, 'message', 'Tất cả gói trên thẻ này đã HẾT LƯỢT hoặc HẾT HẠN. Vui lòng nạp thêm gói.');
                END IF;
            END;
        END IF;

        IF v_available_count > 1 THEN
            RETURN jsonb_build_object(
                'success', false,
                'needs_package_selection', true,
                'message', 'Khách có nhiều gói. Vui lòng chọn gói muốn sử dụng.',
                'available_packages', v_available_tickets
            );
        END IF;

        DECLARE
            v_only_ticket_json JSONB := v_available_tickets->0;
            v_only_ticket_id UUID := (v_only_ticket_json->>'id')::UUID;
        BEGIN
            RETURN public.checkin_pass_and_issue_ticket(p_pass_id, p_staff_id, p_confirm_new_package, v_only_ticket_id);
        END;
    END IF;

    -- =========================================================================
    -- PHẦN C: TRỪ LƯỢT & XUẤT VÉ
    -- =========================================================================
    IF v_ticket.remaining_sessions IS NOT NULL THEN
        UPDATE public.tickets
        SET remaining_sessions = remaining_sessions - 1,
            status = CASE WHEN remaining_sessions - 1 <= 0 THEN 'EXPIRED'::public.ticket_status ELSE 'IN'::public.ticket_status END,
            updated_at = now()
        WHERE id = v_ticket.id;
    ELSE
        UPDATE public.tickets SET status = 'IN'::public.ticket_status, updated_at = now() WHERE id = v_ticket.id;
    END IF;

    -- Đổi tên vé check-in đúng loại
    IF v_ticket.category = 'LESSON' THEN
        IF v_ticket.lesson_class_type = 'ONE_ON_TWO' THEN
             v_checkin_type_name := 'Vé Học Bơi 1 Kèm 2';
        ELSIF v_ticket.lesson_class_type = 'GROUP' THEN
             v_checkin_type_name := 'Vé Học Bơi Nhóm';
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

    -- Tạo vé lượt phụ 1
    INSERT INTO public.tickets (
        ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until, sold_by, price_paid, remaining_sessions, total_sessions
    ) VALUES (
        v_new_ticket_type_id, 'UNUSED'::public.ticket_status, v_ticket.customer_name, v_ticket.customer_phone, v_today, v_today, p_staff_id, 0, 1, 1
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

    -- Tạo vé lượt phụ 2 (nếu là lớp 1 kèm 2)
    IF v_ticket.category = 'LESSON' AND v_ticket.lesson_class_type = 'ONE_ON_TWO' THEN
        INSERT INTO public.tickets (
            ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until, sold_by, price_paid, remaining_sessions, total_sessions
        ) VALUES (
            v_new_ticket_type_id, 'UNUSED'::public.ticket_status, COALESCE(v_ticket.customer_name_2, 'Học viên 2'), v_ticket.customer_phone, v_today, v_today, p_staff_id, 0, 1, 1
        ) RETURNING id INTO v_new_ticket_id_2;

        v_tickets_issued := v_tickets_issued || jsonb_build_array(
            jsonb_build_object(
                'id', v_new_ticket_id_2,
                'type_name', v_checkin_type_name,
                'price_paid', 0,
                'sold_at', now(),
                'pool_close_time', v_close_time,
                'customer_name', COALESCE(v_ticket.customer_name_2, 'Học viên 2')
            )
        );
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
            'lesson_class_type', v_ticket.lesson_class_type,
            'remaining_sessions', CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE null END,
            'total_sessions', v_ticket.total_sessions,
            'valid_from', v_ticket.valid_from,
            'valid_until', v_ticket.valid_until
        ),
        'new_tickets', v_tickets_issued
    );
END;
$$;


-- 3. Cập nhật hàm check_qr_ticket_text (Cổng kiểm soát) - dùng normalize_card_code
CREATE OR REPLACE FUNCTION public.check_qr_ticket_text(
    p_ticket_code TEXT,
    p_direction public.scan_direction,
    p_scanned_by UUID,
    p_gate_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket_id     UUID;
    v_ticket        RECORD;
    v_new_status    public.ticket_status;
    v_fail_reason   TEXT;
    v_result        JSONB;
    v_schedule      JSONB;
    v_day_key       TEXT;
    v_day_schedule  JSONB;
    v_now_time      TIME;
    v_open_time     TIME;
    v_close_time    TIME;
    v_normalized_code TEXT;
BEGIN
    -- Chuẩn hóa mã đầu vào
    p_ticket_code := UPPER(TRIM(p_ticket_code));
    v_normalized_code := public.normalize_card_code(p_ticket_code);

    -- 0a. Kiểm tra giờ hoạt động theo ngày trong tuần
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
                RETURN jsonb_build_object('success', false, 'error', 'POOL_NOT_OPEN', 'message', 'Hồ bơi chưa mở cửa. Giờ mở: ' || (v_day_schedule ->> 'open') || '. Vui lòng quay lại sau.');
            END IF;

            IF p_direction = 'IN' AND v_now_time > v_close_time THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED_NOW', 'message', 'Hồ bơi đã đóng cửa. Giờ đóng: ' || (v_day_schedule ->> 'close') || '.');
            END IF;
        END IF;
    ELSE
        DECLARE v_open TEXT; v_close TEXT;
        BEGIN
            SELECT REPLACE(value::TEXT, '"', '') INTO v_open FROM public.system_settings WHERE key = 'pool_open_time';
            SELECT REPLACE(value::TEXT, '"', '') INTO v_close FROM public.system_settings WHERE key = 'pool_close_time';
            IF v_open IS NOT NULL AND v_close IS NOT NULL THEN
                v_now_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;
                IF v_now_time < v_open::TIME THEN
                    RETURN jsonb_build_object('success', false, 'error', 'POOL_NOT_OPEN', 'message', 'Hồ bơi chưa mở cửa.');
                END IF;
                IF p_direction = 'IN' AND v_now_time > v_close::TIME THEN
                    RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED_NOW', 'message', 'Hồ bơi đã đóng cửa.');
                END IF;
            END IF;
        END;
    END IF;

    -- 0b. Tìm vé (dùng normalize_card_code để so sánh)
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
        ORDER BY t.created_at DESC
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
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE OF t;
    END;

    IF v_ticket IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TICKET_NOT_FOUND', 'message', 'Vé/Thẻ không tồn tại trong hệ thống.');
    END IF;

    v_ticket_id := v_ticket.id;

    -- 2. Xử lý logic theo Category
    IF v_ticket.category = 'DAILY' THEN
        IF (v_ticket.created_at AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE < (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE THEN
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
                END IF;
            ELSIF p_direction = 'OUT' THEN
                IF v_ticket.status = 'IN' THEN v_new_status := 'OUT';
                ELSIF v_ticket.status = 'UNUSED' THEN v_fail_reason := 'NOT_CHECKED_IN';
                ELSIF v_ticket.status = 'OUT' THEN v_fail_reason := 'ALREADY_EXITED';
                ELSIF v_ticket.status = 'EXPIRED' THEN v_fail_reason := 'TICKET_EXPIRED';
                END IF;
            END IF;
        END IF;

    ELSIF v_ticket.category IN ('MONTHLY', 'MULTI', 'LESSON') THEN
        IF v_ticket.valid_until IS NOT NULL AND CURRENT_DATE > v_ticket.valid_until THEN
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = v_ticket_id;
            v_fail_reason := 'TICKET_EXPIRED';
        ELSIF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
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
                IF v_ticket.last_scan_direction = 'IN' THEN
                    v_new_status := 'OUT';
                ELSE
                    v_fail_reason := 'ANTI_PASSBACK_VIOLATION';
                END IF;
            END IF;
        END IF;
    END IF;

    -- 3. Ghi nhận kết quả
    IF v_fail_reason IS NOT NULL THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (v_ticket_id, p_direction, false, v_fail_reason, p_scanned_by, p_gate_id);

        RETURN jsonb_build_object(
            'success', false,
            'error', v_fail_reason,
            'message', CASE v_fail_reason
                WHEN 'ALREADY_INSIDE'           THEN 'Khách đã ở bên trong.'
                WHEN 'DAILY_TICKET_USED'        THEN 'Vé lượt đã sử dụng.'
                WHEN 'TICKET_EXPIRED'           THEN 'Vé/Thẻ đã hết hạn.'
                WHEN 'NOT_CHECKED_IN'           THEN 'Chưa quét vào.'
                WHEN 'ALREADY_EXITED'           THEN 'Khách đã ra ngoài.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Thẻ chưa đến ngày bắt đầu hiệu lực.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Lỗi vòng lặp thẻ.'
                WHEN 'NO_SESSIONS_LEFT'         THEN 'Đã hết số buổi bơi (0 lượt).'
                ELSE 'Lỗi: ' || v_fail_reason
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
            SET status = v_new_status, last_scan_direction = p_direction,
                last_scan_at = now(), remaining_sessions = v_final_remaining, updated_at = now()
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
                'message', CASE p_direction WHEN 'IN' THEN 'MỜI VÀO CỔNG' ELSE 'TẠM BIỆT' END
            );
        END;
    END IF;
END;
$$;
