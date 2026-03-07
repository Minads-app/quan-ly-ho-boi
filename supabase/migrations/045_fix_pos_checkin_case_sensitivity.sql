-- ============================================================
-- 045_fix_pos_checkin_case_sensitivity.sql
-- Fix case sensitivity for POS Checkin (Quét Thẻ Tháng/Gói)
-- Removes strict casing requirement for checkin_pass_and_issue_ticket
-- ============================================================

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
BEGIN
    -- 1. Tìm Vé Lượt Trả Trước (exact match)
    SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name = 'Vé Lượt Trả Trước' AND is_active = true LIMIT 1;
    
    -- 2. Fallback: Nếu không tìm thấy, thử tìm Vé Lượt (cùng nghĩa)
    IF v_new_ticket_type_id IS NULL THEN
        SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name ILIKE '%Lượt%' AND category = 'DAILY' AND is_active = true LIMIT 1;
    END IF;

    -- 3. Fallback cuối cùng: Lấy bất kỳ vé DAILY nào đang active
    IF v_new_ticket_type_id IS NULL THEN
        SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE category = 'DAILY' AND is_active = true LIMIT 1;
    END IF;

    SELECT value INTO v_close_time FROM public.system_settings WHERE key = 'pool_close_time';
    IF v_close_time IS NULL THEN v_close_time := '20:00'; END IF;
    v_close_time := REPLACE(v_close_time, '"', '');

    BEGIN
        p_pass_id := UPPER(TRIM(p_pass_id));
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
    -- PHẦN B: QUÉT TÌM CÁC GÓI
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
        WHERE (v_pass_uuid IS NOT NULL AND t.id = v_pass_uuid OR UPPER(TRIM(t.card_code)) = p_pass_id)
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
                WHERE (v_pass_uuid IS NOT NULL AND t.id = v_pass_uuid OR UPPER(TRIM(t.card_code)) = p_pass_id)
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

    -- === ĐỔI TÊN VÉ CHECK-IN ĐÚNG THEO LOẠI DỊCH VỤ ===
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
