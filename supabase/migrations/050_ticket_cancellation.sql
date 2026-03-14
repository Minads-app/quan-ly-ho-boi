-- Add CANCELLED status (need robust way to add to enum)
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'ticket_status' AND e.enumlabel = 'CANCELLED') THEN
    ALTER TYPE ticket_status ADD VALUE 'CANCELLED';
  END IF;
END $$;

-- Create cancelled_tickets table
CREATE TABLE IF NOT EXISTS cancelled_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    parent_ticket_id UUID REFERENCES tickets(id) ON DELETE SET NULL,
    cancelled_by UUID NOT NULL REFERENCES profiles(id),
    reason TEXT NOT NULL,
    sessions_restored INTEGER NOT NULL DEFAULT 0,
    cancelled_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE cancelled_tickets ENABLE ROW LEVEL SECURITY;

-- Add RLS policy for admins to view
CREATE POLICY "Admins can view cancelled tickets" ON cancelled_tickets
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- (Function to cancel ticket will go here)
CREATE OR REPLACE FUNCTION cancel_ticket(
    p_ticket_id UUID,
    p_reason TEXT,
    p_cancelled_by UUID
) RETURNS json AS $$
DECLARE
    v_ticket_record RECORD;
    v_parent_ticket RECORD;
    v_caller_role TEXT;
    v_sessions_restored INTEGER := 0;
BEGIN
    -- Verify caller is admin
    SELECT role INTO v_caller_role FROM profiles WHERE id = p_cancelled_by;
    IF v_caller_role != 'ADMIN' THEN
        RETURN json_build_object('success', false, 'message', 'Chỉ Quản trị viên mới có quyền hủy vé.');
    END IF;

    -- Get ticket record
    SELECT t.*, tt.name as type_name, tt.category as type_category
    INTO v_ticket_record
    FROM tickets t
    JOIN ticket_types tt ON t.ticket_type_id = tt.id
    WHERE t.id = p_ticket_id;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'Không tìm thấy vé.');
    END IF;

    IF v_ticket_record.status = 'CANCELLED' THEN
        RETURN json_build_object('success', false, 'message', 'Vé này đã bị hủy trước đó.');
    END IF;

    -- Only process return if it's a pass ticket ("Vé Lượt (Từ Thẻ)" price 0)
    -- and we have customer contact info to find the parent package
    IF v_ticket_record.price_paid = 0 AND v_ticket_record.customer_phone IS NOT NULL THEN
        -- Find the active parent package that has remaining sessions to restore to
        -- Use similar logic as the check-in to find the correct package
        SELECT t.*
        INTO v_parent_ticket
        FROM tickets t
        JOIN ticket_types tt ON t.ticket_type_id = tt.id
        WHERE t.customer_phone = v_ticket_record.customer_phone
          AND (t.customer_name = v_ticket_record.customer_name OR t.customer_name IS NULL OR v_ticket_record.customer_name IS NULL)
          AND tt.category IN ('MULTI', 'LESSON')
          AND t.remaining_sessions IS NOT NULL
          AND t.valid_from <= NOW()
        ORDER BY
            CASE WHEN t.status = 'IN' THEN 0 ELSE 1 END,
            t.created_at DESC
        LIMIT 1;

        IF FOUND THEN
            -- Restore session
            UPDATE tickets
            SET
                remaining_sessions = remaining_sessions + 1,
                status = CASE 
                    WHEN status = 'EXPIRED' AND valid_until >= CURRENT_DATE THEN 'UNUSED'
                    ELSE status
                END,
                updated_at = NOW()
            WHERE id = v_parent_ticket.id;
            
            v_sessions_restored := 1;
        END IF;
    END IF;

    -- Update ticket status to CANCELLED
    UPDATE tickets
    SET status = 'CANCELLED', updated_at = NOW()
    WHERE id = p_ticket_id;

    -- Insert log
    INSERT INTO cancelled_tickets (ticket_id, parent_ticket_id, cancelled_by, reason, sessions_restored)
    VALUES (p_ticket_id, v_parent_ticket.id, p_cancelled_by, p_reason, v_sessions_restored);

    RETURN json_build_object(
        'success', true, 
        'message', 'Hủy vé thành công.' || CASE WHEN v_sessions_restored > 0 THEN ' Đã cộng trả 1 buổi.' ELSE '' END
    );
EXCEPTION WHEN OTHERS THEN
    RETURN json_build_object('success', false, 'message', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update `validate_and_scan` to reject CANCELLED tickets Early
CREATE OR REPLACE FUNCTION public.validate_and_scan(
    p_ticket_id     UUID,
    p_direction     public.scan_direction,
    p_scanned_by    UUID DEFAULT NULL,
    p_gate_id       TEXT DEFAULT 'GATE_01'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_ticket        RECORD;
    v_ticket_type   RECORD;
    v_result        JSONB;
    v_new_status    public.ticket_status;
    v_fail_reason   TEXT;
BEGIN
    -- ========================================
    -- Step 1: Lock the ticket row for update
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
        VALUES (p_ticket_id, p_direction, false, 'TICKET_NOT_FOUND', p_scanned_by, p_gate_id);
        
        RETURN jsonb_build_object(
            'success', false,
            'error', 'TICKET_NOT_FOUND',
            'message', 'Vé không tồn tại trong hệ thống.'
        );
    END IF;

    -- CANCELLED Ticket check
    IF v_ticket.status = 'CANCELLED' THEN
        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, p_direction, false, 'TICKET_CANCELLED', p_scanned_by, p_gate_id);
        
        RETURN jsonb_build_object(
            'success', false,
            'error', 'TICKET_CANCELLED',
            'message', 'Vé này đã bị hủy.'
        );
    END IF;

    -- ========================================
    -- Step 2: Validate based on ticket category
    -- ========================================
    
    -- --- DAILY TICKET LOGIC ---
    IF v_ticket.category = 'DAILY' THEN
        
        -- Trying to enter
        IF p_direction = 'IN' THEN
            IF v_ticket.status = 'UNUSED' THEN
                v_new_status := 'IN';
            ELSIF v_ticket.status = 'IN' THEN
                v_fail_reason := 'ALREADY_INSIDE';
            ELSIF v_ticket.status = 'OUT' THEN
                v_fail_reason := 'DAILY_TICKET_USED';
            ELSIF v_ticket.status = 'EXPIRED' THEN
                v_fail_reason := 'TICKET_EXPIRED';
            END IF;
        
        -- Trying to exit
        ELSIF p_direction = 'OUT' THEN
            IF v_ticket.status = 'IN' THEN
                v_new_status := 'OUT';
            ELSIF v_ticket.status = 'UNUSED' THEN
                v_fail_reason := 'NOT_CHECKED_IN';
            ELSIF v_ticket.status = 'OUT' THEN
                v_fail_reason := 'ALREADY_EXITED';
            ELSIF v_ticket.status = 'EXPIRED' THEN
                v_fail_reason := 'TICKET_EXPIRED';
            END IF;
        END IF;

    -- --- MONTHLY TICKET LOGIC ---
    ELSIF v_ticket.category = 'MONTHLY' THEN
        
        -- Check expiration first
        IF v_ticket.valid_until IS NOT NULL AND CURRENT_DATE > v_ticket.valid_until THEN
            -- Mark as expired
            UPDATE public.tickets
            SET status = 'EXPIRED', updated_at = now()
            WHERE id = p_ticket_id;

            v_fail_reason := 'MONTHLY_PASS_EXPIRED';
        
        -- Check valid_from
        ELSIF v_ticket.valid_from IS NOT NULL AND CURRENT_DATE < v_ticket.valid_from THEN
            v_fail_reason := 'MONTHLY_PASS_NOT_STARTED';
        
        ELSE
            -- Anti-passback: enforce IN -> OUT -> IN cycle
            IF p_direction = 'IN' THEN
                IF v_ticket.status = 'UNUSED' OR v_ticket.last_scan_direction = 'OUT' OR v_ticket.last_scan_direction IS NULL THEN
                    v_new_status := 'IN';
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

    -- ========================================
    -- Step 3: Apply result
    -- ========================================
    IF v_fail_reason IS NOT NULL THEN
        -- FAILED scan — log it and return error
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
                WHEN 'MONTHLY_PASS_EXPIRED'     THEN 'Vé tháng đã hết hạn.'
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Vé tháng chưa đến ngày có hiệu lực.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Vi phạm chống xoay vòng vé.'
                ELSE 'Lỗi không xác định.'
            END
        );
    END IF;

    -- SUCCESSFUL scan
    -- Update ticket status and timestamps
    UPDATE public.tickets
    SET 
        status = COALESCE(v_new_status, status),
        last_scan_direction = p_direction,
        last_scan_at = now(),
        updated_at = now()
    WHERE id = p_ticket_id;

    -- Log successful scan
    INSERT INTO public.scan_logs (ticket_id, direction, success, scanned_by, gate_id)
    VALUES (p_ticket_id, p_direction, true, p_scanned_by, p_gate_id);

    RETURN jsonb_build_object(
        'success', true,
        'message', CASE 
            WHEN p_direction = 'IN'  THEN 'Quét VÀO thành công!'
            WHEN p_direction = 'OUT' THEN 'Quét RA thành công!'
        END,
        'ticket_info', jsonb_build_object(
            'type_name', v_ticket.type_name,
            'category', v_ticket.category,
            'customer_name', v_ticket.customer_name
        )
    );
END;
$$;
