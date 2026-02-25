-- ============================================================
-- 009_customer_management.sql
-- Thêm total_sessions và cập nhật check-in multi-package
-- ============================================================

-- 1. Thêm cột total_sessions (Tổng buổi ban đầu khi mua, bao gồm KM)
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS total_sessions INTEGER;

-- 2. Cập nhật dữ liệu cũ: set total_sessions = session_count từ ticket_types
UPDATE public.tickets t
SET total_sessions = tt.session_count
FROM public.ticket_types tt
WHERE t.ticket_type_id = tt.id
  AND t.total_sessions IS NULL
  AND tt.session_count IS NOT NULL;

-- 3. Cập nhật hàm checkin để hỗ trợ Multi-Package (nhiều gói trên 1 thẻ)
-- Khi quét card_code, ưu tiên gói đang sử dụng (remaining_sessions > 0) trước
-- Khi gói hiện tại hết lượt, tự động mở gói tiếp theo
CREATE OR REPLACE FUNCTION public.checkin_pass_and_issue_ticket(
    p_pass_id TEXT,
    p_staff_id UUID
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket RECORD;
    v_new_ticket_type_id UUID;
    v_new_ticket_id UUID;
    v_close_time TEXT := '20:00';
    v_pass_uuid UUID;
    v_today DATE := (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::DATE;
BEGIN
    SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name = 'Vé Lượt (Từ Thẻ)' LIMIT 1;

    SELECT value INTO v_close_time FROM public.system_settings WHERE key = 'pool_close_time';
    IF v_close_time IS NULL THEN v_close_time := '20:00'; END IF;
    v_close_time := REPLACE(v_close_time, '"', '');

    -- Tìm gói ĐANG ACTIVE trước (remaining > 0, chưa hết hạn)
    -- Ưu tiên: gói có remaining_sessions > 0 VÀ chưa expired, sắp xếp theo sold_at cũ nhất trước (FIFO)
    BEGIN
        v_pass_uuid := p_pass_id::UUID;
        -- Tìm theo UUID hoặc card_code, ưu tiên gói active
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE (t.id = v_pass_uuid OR t.card_code = p_pass_id)
          AND tt.category IN ('MONTHLY', 'MULTI')
          AND t.status != 'EXPIRED'::public.ticket_status
          AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0)
          AND (t.valid_until IS NULL OR v_today <= t.valid_until)
          AND (t.valid_from IS NULL OR v_today >= t.valid_from)
        ORDER BY t.sold_at ASC
        LIMIT 1
        FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
        -- Không phải UUID -> tìm theo card_code
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.card_code = p_pass_id
          AND tt.category IN ('MONTHLY', 'MULTI')
          AND t.status != 'EXPIRED'::public.ticket_status
          AND (t.remaining_sessions IS NULL OR t.remaining_sessions > 0)
          AND (t.valid_until IS NULL OR v_today <= t.valid_until)
          AND (t.valid_from IS NULL OR v_today >= t.valid_from)
        ORDER BY t.sold_at ASC
        LIMIT 1
        FOR UPDATE;
    END;

    -- Nếu không tìm thấy gói active, thử tìm bất kỳ thẻ nào có card_code này
    IF v_ticket IS NULL THEN
        -- Kiểm tra xem có thẻ nào với mã này không (có thể đã hết hạn/hết lượt)
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
                RETURN jsonb_build_object('success', false, 'message', 'Đây là vé lượt, không phải thẻ tháng/nhiều buổi.');
            ELSE
                -- Có thẻ nhưng tất cả gói đã hết
                RETURN jsonb_build_object('success', false, 'message', 'Tất cả gói bơi trên thẻ này đã HẾT LƯỢT hoặc HẾT HẠN. Vui lòng nạp thêm gói.');
            END IF;
        END;
    END IF;

    -- Trừ lượt
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
            'total_sessions', v_ticket.total_sessions
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
