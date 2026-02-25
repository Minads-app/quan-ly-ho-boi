-- ============================================================
-- 004_advanced_tickets.sql
-- Nâng cấp hệ thống vé: Thêm vé Nhiều buổi (MULTI), Thời hạn (validity_days)
-- và Số lượt quét (session_count / remaining_sessions)
-- ============================================================

-- 1. Thêm loại MULTI vào ENUM ticket_category
ALTER TYPE public.ticket_category ADD VALUE IF NOT EXISTS 'MULTI';

-- 2. Cập nhật bảng ticket_types (Thêm cấu hình Hạn sử dụng & Số lượt)
ALTER TABLE public.ticket_types
ADD COLUMN IF NOT EXISTS validity_days INTEGER,    -- Số ngày sử dụng (Tự động tính expire date)
ADD COLUMN IF NOT EXISTS session_count INTEGER;      -- Tổng số lượt cho phép quét IN (Dành cho MULTI hoặc MONTHLY giới hạn)

-- Cập nhật dữ liệu cũ (Vé lượt mặc định Hết hạn trong 1 ngày, vé tháng = 30 ngày)
UPDATE public.ticket_types SET validity_days = 1 WHERE category = 'DAILY' AND validity_days IS NULL;
UPDATE public.ticket_types SET validity_days = 30 WHERE category = 'MONTHLY' AND validity_days IS NULL;

-- 3. Cập nhật bảng tickets (Thêm trường theo dõi số lượt còn lại)
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS remaining_sessions INTEGER;

-- 4. Xóa hàm cũ đi để tạo lại (Phòng ngừa lỗi trùng lặp khi đổi cấu trúc Return)
DROP FUNCTION IF EXISTS public.check_qr_ticket(uuid, public.scan_direction, uuid, uuid);

-- 5. Tạo lại hàm check_qr_ticket với logic xử lý số lượt cọ xát (remaining_sessions)
CREATE OR REPLACE FUNCTION public.check_qr_ticket(
    p_ticket_id UUID,
    p_direction public.scan_direction,
    p_scanned_by UUID,
    p_gate_id UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_ticket        RECORD;
    v_new_status    public.ticket_status;
    v_fail_reason   TEXT;
    v_result        JSONB;
BEGIN
    -- 1. Khóa row để tránh Race Condition (quét 2 máy cùng lúc)
    SELECT t.*, tt.category, tt.name AS type_name
    INTO v_ticket
    FROM public.tickets t
    JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
    WHERE t.id = p_ticket_id
    FOR UPDATE;

    -- Nếu vé không tồn tại
    IF NOT FOUND THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, p_direction, false, 'TICKET_NOT_FOUND', p_scanned_by, p_gate_id);
        
        RETURN jsonb_build_object('success', false, 'error', 'TICKET_NOT_FOUND', 'message', 'Vé không tồn tại trong hệ thống.');
    END IF;

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
            -- Hết hạn -> Ép status thành EXPIRED
            UPDATE public.tickets SET status = 'EXPIRED', updated_at = now() WHERE id = p_ticket_id;
            v_fail_reason := 'TICKET_EXPIRED';
        
        -- Kiểm tra Ngày bắt đầu (Đã được phép dùng chưa?)
        ELSIF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
            v_fail_reason := 'MONTHLY_PASS_NOT_STARTED';
        
        ELSE
            -- Logic chống quay vòng thẻ (Anti-passback)
            IF p_direction = 'IN' THEN
                -- Có thẻ vào nếu (Chưa dùng hoặc Trước đó đã ra hoặc Hết log)
                IF v_ticket.status = 'UNUSED' OR v_ticket.last_scan_direction = 'OUT' OR v_ticket.last_scan_direction IS NULL THEN
                    
                    -- KIỂM TRA SỐ LƯỢT (Nếu loại vé này BỊ GIỚI HẠN số lượt)
                    IF v_ticket.remaining_sessions IS NOT NULL THEN
                        IF v_ticket.remaining_sessions <= 0 THEN
                            v_fail_reason := 'NO_SESSIONS_LEFT';
                        ELSE
                            v_new_status := 'IN';
                        END IF;
                    ELSE
                        v_new_status := 'IN'; -- Không giới hạn lượt thì cho vào thoải mái
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
        VALUES (p_ticket_id, p_direction, false, v_fail_reason, p_scanned_by, p_gate_id);

        RETURN jsonb_build_object(
            'success', false,
            'error', v_fail_reason,
            'message', CASE v_fail_reason
                WHEN 'ALREADY_INSIDE'           THEN 'Khách đã ở bên trong. Không thể quét vào lần nữa.'
                WHEN 'DAILY_TICKET_USED'        THEN 'Vé lượt đã sử dụng. Không thể tái sử dụng.'
                WHEN 'TICKET_EXPIRED'           THEN 'Vé đã hết hạn.'
                WHEN 'NOT_CHECKED_IN'           THEN 'Chưa quét vào. Không thể quét ra.'
                WHEN 'ALREADY_EXITED'           THEN 'Khách đã ra ngoài.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Vé tháng chưa đến ngày bắt đầu hiệu lực.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Lỗi vòng lặp thẻ (Quét vào 2 lần liên tiếp hoặc ra 2 lần).'
                WHEN 'NO_SESSIONS_LEFT'         THEN 'Đã hết số buổi bơi (0 lượt).'
                ELSE 'Lỗi không xác định: ' || v_fail_reason
            END
        );
    ELSE
        -- Thành công
        
        -- Tính toán trừ lượt nếu đi VÀO và có giới hạn lượt
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
                -- Cập nhật tự động OUT cho vé lẻ luôn để tiết kiệm thao tác nếu cần thiết
                updated_at = now()
            WHERE id = p_ticket_id;

            -- Ghi Log
            INSERT INTO public.scan_logs (ticket_id, direction, success, scanned_by, gate_id)
            VALUES (p_ticket_id, p_direction, true, p_scanned_by, p_gate_id);

            -- Trả về
            RETURN jsonb_build_object(
                'success', true,
                'ticket', jsonb_build_object(
                    'id', p_ticket_id,
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
