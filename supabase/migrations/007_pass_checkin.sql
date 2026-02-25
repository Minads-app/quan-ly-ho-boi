-- ============================================================
-- 007_pass_checkin.sql
-- Thêm chức năng Check-in Thẻ (Tháng / Nhiều lượt) để tạo vé lượt phụ (0đ)
-- ============================================================

-- 1. Tạo một Loại vé nội bộ chuyên dùng để in vé lượt từ Thẻ
-- Check xem đã có chưa để tránh lỗi duplicate
DO $$
DECLARE
    v_type_id UUID;
BEGIN
    SELECT id INTO v_type_id FROM public.ticket_types WHERE name = 'Vé Lượt (Từ Thẻ)' LIMIT 1;
    
    IF v_type_id IS NULL THEN
        INSERT INTO public.ticket_types (name, category, price, description, is_active, validity_days, session_count)
        VALUES ('Vé Lượt (Từ Thẻ)', 'DAILY', 0, 'Vé in tự động khi khách check-in bằng thẻ Tháng/Nhiều buổi (Giá 0đ)', false, 1, 1);
    END IF;
END $$;

-- 2. Tạo Function xử lý Check-in Thẻ
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
    v_close_time TEXT := '20:00'; -- Default
    v_result JSONB;
    v_pass_uuid UUID;
BEGIN
    -- Lấy thông tin vé lượt nội bộ
    SELECT id INTO v_new_ticket_type_id FROM public.ticket_types WHERE name = 'Vé Lượt (Từ Thẻ)' LIMIT 1;

    -- Lấy giờ đóng cửa từ settings
    SELECT value INTO v_close_time FROM public.system_settings WHERE key = 'pool_close_time';
    IF v_close_time IS NULL THEN v_close_time := '20:00'; END IF;
    -- Bỏ dấu ngoặc kép JSONB nếu có
    v_close_time := REPLACE(v_close_time, '"', '');

    -- Tìm thẻ gốc theo UUID hoặc card_code
    BEGIN
        v_pass_uuid := p_pass_id::UUID;
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.id = v_pass_uuid OR t.card_code = p_pass_id
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
        -- Không phải UUID -> tìm theo card_code
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.card_code = p_pass_id
        ORDER BY t.created_at DESC
        LIMIT 1
        FOR UPDATE;
    END;

    -- Kiểm tra thẻ có tồn tại không
    IF NOT FOUND THEN
         RETURN jsonb_build_object('success', false, 'message', 'Không tìm thấy thẻ (QR Code không hợp lệ).');
    END IF;

    -- Kiểm tra loại thẻ
    IF v_ticket.category = 'DAILY' THEN
         RETURN jsonb_build_object('success', false, 'message', 'Đây là vé lượt, không phải thẻ tháng/nhiều buổi. Xin mời khách cầm thẳng qua cổng kiểm soát.');
    END IF;

    -- Kiểm tra ngày hiệu lực
    IF v_ticket.valid_until IS NOT NULL AND CURRENT_DATE > v_ticket.valid_until THEN
         UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = v_ticket.id;
         RETURN jsonb_build_object('success', false, 'message', 'Thẻ này đã HẾT HẠN sử dụng.');
    END IF;

    IF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
         RETURN jsonb_build_object('success', false, 'message', 'Thẻ này chưa đến ngày bắt đầu sử dụng.');
    END IF;

    -- Kiểm tra số lượt (nếu có giới hạn)
    IF v_ticket.remaining_sessions IS NOT NULL THEN
        IF v_ticket.remaining_sessions <= 0 THEN
             RETURN jsonb_build_object('success', false, 'message', 'Thẻ này đã HẾT SỐ LƯỢT bơi.');
        END IF;
        
        -- Trừ 1 lượt
        UPDATE public.tickets 
        SET remaining_sessions = remaining_sessions - 1, updated_at = now() 
        WHERE id = v_ticket.id;
    END IF;

    -- Tạo 1 vé DAILY (Vé phụ) giá 0đ
    INSERT INTO public.tickets (
        ticket_type_id, status, customer_name, customer_phone, valid_from, valid_until, sold_by, price_paid, remaining_sessions
    ) VALUES (
        v_new_ticket_type_id, 'UNUSED', v_ticket.customer_name, v_ticket.customer_phone, CURRENT_DATE, CURRENT_DATE, p_staff_id, 0, 1
    ) RETURNING id INTO v_new_ticket_id;

    -- Thành công
    RETURN jsonb_build_object(
        'success', true,
        'message', 'Check-in thành công. Đã trừ 1 lượt.',
        'pass_status', jsonb_build_object(
            'customer_name', v_ticket.customer_name,
            'type_name', v_ticket.type_name,
            'remaining_sessions', CASE WHEN v_ticket.remaining_sessions IS NOT NULL THEN v_ticket.remaining_sessions - 1 ELSE null END
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
