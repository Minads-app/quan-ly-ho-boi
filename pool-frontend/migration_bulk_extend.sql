-- ========== 1. Bảng bulk_extensions ==========
CREATE TABLE IF NOT EXISTS public.bulk_extensions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    closed_start DATE NOT NULL,
    closed_end DATE NOT NULL,
    days_extended INT NOT NULL,
    total_tickets INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID REFERENCES public.profiles(id)
);

-- ========== 2. Bảng ticket_extension_logs ==========
CREATE TABLE IF NOT EXISTS public.ticket_extension_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE,
    bulk_extension_id UUID REFERENCES public.bulk_extensions(id) ON DELETE CASCADE,
    old_valid_until DATE,
    new_valid_until DATE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_ext_ticket_id ON public.ticket_extension_logs(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_ext_bulk_id ON public.ticket_extension_logs(bulk_extension_id);

-- ========== 3. RPC execute_bulk_extend ==========
CREATE OR REPLACE FUNCTION execute_bulk_extend(
    p_start_date DATE, 
    p_end_date DATE, 
    p_user_id UUID
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_days INT;
    v_bulk_id UUID;
    v_count INT := 0;
BEGIN
    v_days := (p_end_date - p_start_date) + 1;
    IF v_days <= 0 THEN
        RETURN 0;
    END IF;

    -- Create bulk extension record
    INSERT INTO public.bulk_extensions (closed_start, closed_end, days_extended, created_by)
    VALUES (p_start_date, p_end_date, v_days, p_user_id)
    RETURNING id INTO v_bulk_id;

    -- Insert into logs based on criteria
    INSERT INTO public.ticket_extension_logs (ticket_id, bulk_extension_id, old_valid_until, new_valid_until)
    SELECT 
        id, 
        v_bulk_id, 
        valid_until::date, 
        valid_until::date + v_days
    FROM public.tickets
    WHERE valid_from IS NOT NULL
      AND valid_until IS NOT NULL
      AND status != 'CANCELLED'
      AND valid_until::date >= p_start_date;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    IF v_count > 0 THEN
        -- Update the actual tickets
        UPDATE public.tickets
        SET valid_until = valid_until + v_days,
            updated_at = NOW()
        WHERE id IN (
            SELECT ticket_id FROM public.ticket_extension_logs WHERE bulk_extension_id = v_bulk_id
        );

        -- Update total count in bulk_extensions
        UPDATE public.bulk_extensions 
        SET total_tickets = v_count 
        WHERE id = v_bulk_id;
    ELSE
        -- If no tickets found, remove the bulk record
        DELETE FROM public.bulk_extensions WHERE id = v_bulk_id;
    END IF;

    RETURN v_count;
END;
$$;
