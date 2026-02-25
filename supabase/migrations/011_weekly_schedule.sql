-- ============================================================
-- 011_weekly_schedule.sql
-- Giờ hoạt động từng ngày trong tuần
-- ============================================================

-- 1. Thêm setting pool_weekly_schedule dạng JSON
-- Format: {"mon":{"open":"06:00","close":"20:00","closed":false}, ...}
INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('pool_weekly_schedule', '{
  "mon": {"open": "06:00", "close": "20:00", "closed": false},
  "tue": {"open": "06:00", "close": "20:00", "closed": false},
  "wed": {"open": "06:00", "close": "20:00", "closed": false},
  "thu": {"open": "06:00", "close": "20:00", "closed": false},
  "fri": {"open": "06:00", "close": "20:00", "closed": false},
  "sat": {"open": "06:00", "close": "21:00", "closed": false},
  "sun": {"open": "06:00", "close": "21:00", "closed": false}
}'::jsonb, now())
ON CONFLICT (key) DO NOTHING;

-- 2. Cập nhật hàm check_qr_ticket_text → kiểm tra giờ hoạt động theo ngày
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
BEGIN
    -- 0a. Kiểm tra giờ hoạt động theo ngày trong tuần
    SELECT value INTO v_schedule FROM public.system_settings WHERE key = 'pool_weekly_schedule';
    IF v_schedule IS NOT NULL THEN
        -- Lấy ngày trong tuần (mon, tue, ...)
        v_day_key := lower(to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'Dy'));
        -- PostgreSQL returns Mon, Tue... -> lowercase first 3 chars
        v_day_schedule := v_schedule -> v_day_key;

        IF v_day_schedule IS NOT NULL THEN
            -- Kiểm tra ngày nghỉ
            IF (v_day_schedule ->> 'closed')::boolean = true THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED', 'message', 'Hồ bơi hôm nay NGHỈ. Vui lòng quay lại vào ngày khác.');
            END IF;

            -- Kiểm tra trong khung giờ
            v_now_time := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::TIME;
            v_open_time := (v_day_schedule ->> 'open')::TIME;
            v_close_time := (v_day_schedule ->> 'close')::TIME;

            IF v_now_time < v_open_time THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_NOT_OPEN', 'message', 'Hồ bơi chưa mở cửa. Giờ mở: ' || (v_day_schedule ->> 'open') || '. Vui lòng quay lại sau.');
            END IF;

            -- Cho phép quét ra sau giờ đóng cửa, chỉ chặn quét vào
            IF p_direction = 'IN' AND v_now_time > v_close_time THEN
                RETURN jsonb_build_object('success', false, 'error', 'POOL_CLOSED_NOW', 'message', 'Hồ bơi đã đóng cửa. Giờ đóng: ' || (v_day_schedule ->> 'close') || '.');
            END IF;
        END IF;
    ELSE
        -- Fallback: dùng pool_open_time / pool_close_time cũ
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

    -- 0b. Tìm vé theo Text (UUID hoặc card_code)
    BEGIN
        v_ticket_id := p_ticket_code::UUID;
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.id = v_ticket_id OR t.card_code = p_ticket_code
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.card_code = p_ticket_code
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE;
    END;

    IF v_ticket IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'TICKET_NOT_FOUND', 'message', 'Vé/Thẻ không tồn tại trong hệ thống.');
    END IF;

    v_ticket_id := v_ticket.id;

    -- 2. Xử lý logic theo Category
    IF v_ticket.category = 'DAILY' THEN
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

    ELSIF v_ticket.category IN ('MONTHLY', 'MULTI') THEN
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
