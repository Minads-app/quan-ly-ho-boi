-- ============================================================
-- 008_ticket_card_code.sql
-- Thêm cột card_code cho vé Tháng / Nhiều buổi để dùng thẻ cứng
-- ============================================================

-- 1. Thêm cột card_code vào bảng tickets
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS card_code VARCHAR(255);

-- (Tuỳ chọn) Đảm bảo card_code không bị trùng lặp trong hệ thống nếu có nhập
-- Bỏ qua constraints UNIQUE vì có thể thẻ đã hết hạn và số thẻ đó được tái sử dụng cho khách khác sau này.
-- Tạo index để tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_tickets_card_code ON public.tickets(card_code);

-- 2. Cập nhật hàm check_qr_ticket (cho cổng kiểm soát)
-- Để cổng có thể quét UUID (QR vé giấy) HOẶC card_code (Thẻ nhựa)
DROP FUNCTION IF EXISTS public.check_qr_ticket(uuid, public.scan_direction, uuid, uuid);
-- (Chú ý: Gate Agent ở C# hiện đang truyền p_ticket_id là một string UUID. 
-- Nếu mã vạch không phải UUID, Gate Agent C# sẽ cẩn phải sửa lại kịch bản truyền dữ liệu hoặc PostgreSQL phải nhận dạng kiểu TEXT)

-- Sửa kiểu dữ liệu tham số đầu vào của check_qr_ticket thành TEXT
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
BEGIN
    -- 0. Tìm vé theo Text (có thể là UUID hoặc card_code)
    BEGIN
        -- Thử parse UUID trước
        v_ticket_id := p_ticket_code::UUID;
        
        -- Khóa row để tránh Race Condition
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.id = v_ticket_id OR t.card_code = p_ticket_code
        ORDER BY t.created_at DESC -- Ưu tiên vé mới nhất nếu card_code bị trùng
        LIMIT 1
        FOR UPDATE;
    EXCEPTION WHEN invalid_text_representation THEN
        -- Nếu không phải UUID (ví dụ mã vạch 'VIP001') -> Chỉ tìm theo card_code
        SELECT t.*, tt.category, tt.name AS type_name
        INTO v_ticket
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.card_code = p_ticket_code
        ORDER BY t.created_at DESC 
        LIMIT 1
        FOR UPDATE;
    END;

    -- Nếu vé không tồn tại
    IF v_ticket IS NULL THEN
        -- Không ghi scan_log vì ticket_id là NOT NULL
        RETURN jsonb_build_object('success', false, 'error', 'TICKET_NOT_FOUND', 'message', 'Vé/Thẻ không tồn tại trong hệ thống.');
    END IF;

    -- Gán lại ticket_id gốc để xử lý tiếp
    v_ticket_id := v_ticket.id;

    -- 2. Xử lý logic theo Category
    -- ================= DAILY (VÉ LƯỢT 1 LẦN) =================
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

    -- ================= MULTI & MONTHLY (VÉ NHIỀU LẦN / VÉ THÁNG) =================
    ELSIF v_ticket.category IN ('MONTHLY', 'MULTI') THEN
        
        -- Kiểm tra Hạn sử dụng (Hết hạn chưa?)
        IF v_ticket.valid_until IS NOT NULL AND CURRENT_DATE > v_ticket.valid_until THEN
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = v_ticket_id;
            v_fail_reason := 'TICKET_EXPIRED';
        
        -- Kiểm tra Ngày bắt đầu
        ELSIF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
            v_fail_reason := 'MONTHLY_PASS_NOT_STARTED';
        
        ELSE
            -- Logic chống quay vòng thẻ (Anti-passback)
            IF p_direction = 'IN' THEN
                IF v_ticket.status = 'UNUSED' OR v_ticket.last_scan_direction = 'OUT' OR v_ticket.last_scan_direction IS NULL THEN
                    
                    -- KIỂM TRA SỐ LƯỢT
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

    -- 3. Ghi nhận Kết quả
    IF v_fail_reason IS NOT NULL THEN
        -- Ghi lỗi
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (v_ticket_id, p_direction, false, v_fail_reason, p_scanned_by, p_gate_id);

        RETURN jsonb_build_object(
            'success', false,
            'error', v_fail_reason,
            'message', CASE v_fail_reason
                WHEN 'ALREADY_INSIDE'           THEN 'Khách đã ở bên trong. Không thể quét vào lần nữa.'
                WHEN 'DAILY_TICKET_USED'        THEN 'Vé lượt đã sử dụng. Không thể tái sử dụng.'
                WHEN 'TICKET_EXPIRED'           THEN 'Vé/Thẻ đã hết hạn.'
                WHEN 'NOT_CHECKED_IN'           THEN 'Chưa quét vào. Không thể quét ra.'
                WHEN 'ALREADY_EXITED'           THEN 'Khách đã ra ngoài.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Thẻ chưa đến ngày bắt đầu hiệu lực.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Lỗi vòng lặp thẻ.'
                WHEN 'NO_SESSIONS_LEFT'         THEN 'Đã hết số buổi bơi (0 lượt).'
                ELSE 'Lỗi không xác định: ' || v_fail_reason
            END
        );
    ELSE
        -- Thành công
        DECLARE
            v_final_remaining INTEGER := v_ticket.remaining_sessions;
        BEGIN
            IF p_direction = 'IN' AND v_ticket.remaining_sessions IS NOT NULL THEN
                v_final_remaining := v_ticket.remaining_sessions - 1;
            END IF;

            -- Cập nhật bảng Tickets
            UPDATE public.tickets
            SET 
                status = v_new_status,
                last_scan_direction = p_direction,
                last_scan_at = now(),
                remaining_sessions = v_final_remaining,
                updated_at = now()
            WHERE id = v_ticket_id;

            -- Ghi Log
            INSERT INTO public.scan_logs (ticket_id, direction, success, scanned_by, gate_id)
            VALUES (v_ticket_id, p_direction, true, p_scanned_by, p_gate_id);

            -- Trả về
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
