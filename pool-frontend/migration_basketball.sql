-- 1. Thêm trường sport_type vào bảng ticket_types
ALTER TABLE public.ticket_types ADD COLUMN IF NOT EXISTS sport_type VARCHAR(50) DEFAULT 'SWIMMING';

-- Cập nhật tất cả các khóa học hiện tại thành 'SWIMMING' (Bơi lội)
UPDATE public.ticket_types SET sport_type = 'SWIMMING' WHERE sport_type IS NULL;

-- 2. Thêm hàm RPC điểm danh dành riêng cho Bóng rổ
CREATE OR REPLACE FUNCTION checkin_basketball_lesson(p_pass_id UUID, p_staff_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_pass RECORD;
BEGIN
    -- Lấy thông tin vé
    SELECT * INTO v_pass FROM tickets WHERE id = p_pass_id AND status != 'CANCELLED';
    IF NOT FOUND THEN 
        RETURN json_build_object('success', false, 'message', 'Không tìm thấy vé.'); 
    END IF;
    
    IF v_pass.status = 'EXPIRED' THEN 
        RETURN json_build_object('success', false, 'message', 'Khóa học đã hết hạn.'); 
    END IF;
    
    -- Trừ buổi học (nếu có giới hạn buổi)
    IF v_pass.remaining_sessions IS NOT NULL THEN
        IF v_pass.remaining_sessions <= 0 THEN 
            RETURN json_build_object('success', false, 'message', 'Khóa học đã hết buổi.'); 
        END IF;
        
        UPDATE tickets SET 
            remaining_sessions = remaining_sessions - 1, 
            updated_at = NOW(),
            valid_from = COALESCE(valid_from, CURRENT_DATE) -- Kích hoạt vé nếu chưa kích hoạt
        WHERE id = p_pass_id;
    ELSE
        UPDATE tickets SET 
            updated_at = NOW(),
            valid_from = COALESCE(valid_from, CURRENT_DATE)
        WHERE id = p_pass_id;
    END IF;

    -- Lưu lịch sử điểm danh vào bảng scan_logs
    INSERT INTO scan_logs (ticket_id, scanned_at, direction, success, device_id)
    VALUES (p_pass_id, NOW(), 'IN', true, 'BASKETBALL_POS');

    RETURN json_build_object(
        'success', true, 
        'message', 'Điểm danh Bóng rổ thành công!', 
        'remaining_sessions', v_pass.remaining_sessions - 1
    );
END;
$$;
