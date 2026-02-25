-- ============================================================
-- PHASE 1: Pool Ticket & Access Control System
-- Database Schema, Functions, RLS Policies, and Views
-- ============================================================
-- Run this in Supabase SQL Editor or as a migration file.
-- Requires: Supabase project with Auth enabled.
-- ============================================================

-- ============================================================
-- 1. ENUM TYPES
-- ============================================================

CREATE TYPE public.ticket_category AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE public.ticket_status AS ENUM ('UNUSED', 'IN', 'OUT', 'EXPIRED');
CREATE TYPE public.scan_direction AS ENUM ('IN', 'OUT');
CREATE TYPE public.user_role AS ENUM ('ADMIN', 'STAFF');

-- ============================================================
-- 2. TABLES
-- ============================================================

-- ----------------------------------------------------------
-- 2a. profiles — Staff / Admin accounts
-- Linked 1:1 to auth.users via trigger
-- ----------------------------------------------------------
CREATE TABLE public.profiles (
    id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name       TEXT NOT NULL DEFAULT '',
    role            public.user_role NOT NULL DEFAULT 'STAFF',
    avatar_url      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.profiles IS 'Staff and admin accounts, auto-created on signup via trigger.';

-- ----------------------------------------------------------
-- 2b. ticket_types — Configurable ticket pricing
-- e.g. Adult-Daily, Child-Daily, Adult-Monthly, Child-Monthly
-- ----------------------------------------------------------
CREATE TABLE public.ticket_types (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                              -- e.g. "Vé người lớn"
    category        public.ticket_category NOT NULL,            -- DAILY or MONTHLY
    price           INTEGER NOT NULL CHECK (price >= 0),        -- Price in VND (integer, no decimals)
    description     TEXT DEFAULT '',
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.ticket_types IS 'Ticket type catalog with pricing. Managed by ADMIN.';

-- Seed some default ticket types
INSERT INTO public.ticket_types (name, category, price, description) VALUES
    ('Người lớn - Vé lượt',  'DAILY',   80000,  'Vé bơi 1 lượt cho người lớn'),
    ('Trẻ em - Vé lượt',     'DAILY',   50000,  'Vé bơi 1 lượt cho trẻ em (6-15 tuổi)'),
    ('Người lớn - Vé tháng', 'MONTHLY', 800000, 'Vé bơi tháng cho người lớn'),
    ('Trẻ em - Vé tháng',    'MONTHLY', 500000, 'Vé bơi tháng cho trẻ em (6-15 tuổi)');

-- ----------------------------------------------------------
-- 2c. tickets — Individual tickets (QR / RFID)
-- Each ticket has a unique UUID used as the QR code value
-- ----------------------------------------------------------
CREATE TABLE public.tickets (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- This IS the QR code value
    ticket_type_id      UUID NOT NULL REFERENCES public.ticket_types(id),
    status              public.ticket_status NOT NULL DEFAULT 'UNUSED',
    
    -- For monthly passes: customer identification
    customer_name       TEXT,
    customer_phone      TEXT,
    
    -- For monthly passes: validity window
    valid_from          DATE,
    valid_until         DATE,
    
    -- Anti-passback tracking
    last_scan_direction public.scan_direction,  -- NULL = never scanned
    last_scan_at        TIMESTAMPTZ,
    
    -- Sale metadata
    sold_by             UUID REFERENCES public.profiles(id),  -- Staff who sold the ticket
    sold_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    price_paid          INTEGER NOT NULL CHECK (price_paid >= 0), -- Actual price paid (VND)
    
    -- Timestamps
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.tickets IS 'Individual tickets. UUID primary key doubles as QR code value.';

-- Index for quick lookups during scanning
CREATE INDEX idx_tickets_status ON public.tickets(status);
CREATE INDEX idx_tickets_sold_at ON public.tickets(sold_at);

-- ----------------------------------------------------------
-- 2d. scan_logs — Immutable audit trail of ALL scan attempts
-- ----------------------------------------------------------
CREATE TABLE public.scan_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id       UUID NOT NULL REFERENCES public.tickets(id),
    direction       public.scan_direction NOT NULL,
    success         BOOLEAN NOT NULL DEFAULT false,
    failure_reason  TEXT,                                        -- NULL if success, otherwise reason
    scanned_by      UUID REFERENCES public.profiles(id),        -- Staff who performed the scan
    gate_id         TEXT DEFAULT 'GATE_01',                      -- Identifier for multi-gate setups
    scanned_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.scan_logs IS 'Immutable audit log. Every scan attempt (success or fail) is recorded.';

CREATE INDEX idx_scan_logs_ticket_id ON public.scan_logs(ticket_id);
CREATE INDEX idx_scan_logs_scanned_at ON public.scan_logs(scanned_at);

-- ============================================================
-- 3. SERVER-SIDE FUNCTIONS
-- ============================================================

-- ----------------------------------------------------------
-- 3a. validate_and_scan — Core anti-passback + ticket scan logic
-- Runs as SECURITY DEFINER to bypass RLS (trusted server code)
-- Called from API routes / Edge Functions, NEVER from client
-- ----------------------------------------------------------
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
                WHEN 'MONTHLY_PASS_NOT_STARTED' THEN 'Vé tháng chưa đến ngày bắt đầu.'
                WHEN 'ANTI_PASSBACK_VIOLATION'  THEN 'Vi phạm anti-passback. Phải quét ra trước khi quét vào lại.'
                ELSE 'Lỗi không xác định.'
            END,
            'ticket_id', p_ticket_id,
            'ticket_status', v_ticket.status,
            'direction', p_direction
        );
    ELSE
        -- SUCCESS — update ticket and log
        UPDATE public.tickets
        SET 
            status = v_new_status,
            last_scan_direction = p_direction,
            last_scan_at = now(),
            updated_at = now()
        WHERE id = p_ticket_id;

        INSERT INTO public.scan_logs (ticket_id, direction, success, failure_reason, scanned_by, gate_id)
        VALUES (p_ticket_id, p_direction, true, NULL, p_scanned_by, p_gate_id);

        RETURN jsonb_build_object(
            'success', true,
            'message', CASE p_direction
                WHEN 'IN'  THEN 'Quét vào thành công. Chào mừng!'
                WHEN 'OUT' THEN 'Quét ra thành công. Hẹn gặp lại!'
            END,
            'ticket_id', p_ticket_id,
            'ticket_status', v_new_status,
            'direction', p_direction,
            'type_name', v_ticket.type_name,
            'category', v_ticket.category,
            'customer_name', COALESCE(v_ticket.customer_name, '')
        );
    END IF;
END;
$$;

COMMENT ON FUNCTION public.validate_and_scan IS 
'Core scan function. Validates ticket, enforces anti-passback, updates status, and logs attempt. Must only be called from trusted server context.';

-- ----------------------------------------------------------
-- 3b. handle_new_user — Auto-create profile on signup
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
        COALESCE((NEW.raw_user_meta_data->>'role')::public.user_role, 'STAFF')
    );
    RETURN NEW;
END;
$$;

-- Trigger: fire after a new user is created in auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------
-- 3c. update_updated_at — Auto-update updated_at column
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_ticket_types_updated_at
    BEFORE UPDATE ON public.ticket_types
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Note: tickets.updated_at is managed by validate_and_scan function

-- ============================================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ticket_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scan_logs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------
-- 4a. profiles — RLS Policies
-- ----------------------------------------------------------

-- All authenticated users can see all profiles (for UI lookups like staff names)
CREATE POLICY "profiles_select_authenticated"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (true);

-- Users can only update their own profile (name, avatar)
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Insert is handled by the trigger, no direct insert allowed
-- Delete is cascaded from auth.users, no direct delete allowed

-- ----------------------------------------------------------
-- 4b. ticket_types — RLS Policies
-- ----------------------------------------------------------

-- All authenticated users can read ticket types (needed for POS)
CREATE POLICY "ticket_types_select_authenticated"
    ON public.ticket_types FOR SELECT
    TO authenticated
    USING (true);

-- Only ADMIN can manage ticket types
CREATE POLICY "ticket_types_insert_admin"
    ON public.ticket_types FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "ticket_types_update_admin"
    ON public.ticket_types FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

CREATE POLICY "ticket_types_delete_admin"
    ON public.ticket_types FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- ----------------------------------------------------------
-- 4c. tickets — RLS Policies
-- ----------------------------------------------------------

-- All authenticated can read tickets (for POS, scanning, dashboard)
CREATE POLICY "tickets_select_authenticated"
    ON public.tickets FOR SELECT
    TO authenticated
    USING (true);

-- ADMIN and STAFF can sell tickets (insert)
CREATE POLICY "tickets_insert_staff"
    ON public.tickets FOR INSERT
    TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role IN ('ADMIN', 'STAFF')
        )
    );

-- No direct UPDATE from client — updates go through validate_and_scan (SECURITY DEFINER)
-- No DELETE allowed

-- ----------------------------------------------------------
-- 4d. scan_logs — RLS Policies
-- ----------------------------------------------------------

-- All authenticated can read scan logs (for dashboard & audit)
CREATE POLICY "scan_logs_select_authenticated"
    ON public.scan_logs FOR SELECT
    TO authenticated
    USING (true);

-- No direct INSERT from client — inserts go through validate_and_scan (SECURITY DEFINER)
-- No UPDATE or DELETE allowed (immutable audit trail)

-- ============================================================
-- 5. REPORTING VIEWS
-- ============================================================

-- ----------------------------------------------------------
-- 5a. daily_revenue_summary — Today's sales aggregated by ticket type
-- ----------------------------------------------------------
CREATE OR REPLACE VIEW public.daily_revenue_summary AS
SELECT
    tt.id AS ticket_type_id,
    tt.name AS ticket_type_name,
    tt.category,
    COUNT(t.id) AS tickets_sold,
    COALESCE(SUM(t.price_paid), 0) AS total_revenue
FROM public.ticket_types tt
LEFT JOIN public.tickets t
    ON t.ticket_type_id = tt.id
    AND t.sold_at::date = CURRENT_DATE
WHERE tt.is_active = true
GROUP BY tt.id, tt.name, tt.category
ORDER BY tt.category, tt.name;

COMMENT ON VIEW public.daily_revenue_summary IS 'Aggregated ticket sales and revenue for today, grouped by ticket type.';

-- ----------------------------------------------------------
-- 5b. recent_scan_activity — Last 50 scan events
-- ----------------------------------------------------------
CREATE OR REPLACE VIEW public.recent_scan_activity AS
SELECT
    sl.id AS scan_id,
    sl.ticket_id,
    sl.direction,
    sl.success,
    sl.failure_reason,
    sl.scanned_at,
    sl.gate_id,
    t.status AS current_ticket_status,
    t.customer_name,
    tt.name AS ticket_type_name,
    tt.category AS ticket_category,
    p.full_name AS scanned_by_name
FROM public.scan_logs sl
JOIN public.tickets t ON sl.ticket_id = t.id
JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
LEFT JOIN public.profiles p ON sl.scanned_by = p.id
ORDER BY sl.scanned_at DESC
LIMIT 50;

COMMENT ON VIEW public.recent_scan_activity IS 'Last 50 scan events with full ticket and staff details for dashboard display.';

-- ============================================================
-- 6. REALTIME — Enable for scan_logs (Bridge Agent listens)
-- ============================================================

-- The Local Bridge Agent subscribes to scan_logs INSERT events
-- to trigger the physical gate relay.
-- Enable Realtime on scan_logs table via Supabase Dashboard:
--   Table Editor > scan_logs > Enable Realtime
-- Or programmatically:
ALTER PUBLICATION supabase_realtime ADD TABLE public.scan_logs;

-- ============================================================
-- DONE — Phase 1 Complete
-- ============================================================
-- Next steps:
--   1. Run this SQL in your Supabase SQL Editor
--   2. Create your first ADMIN user via Supabase Auth
--   3. Proceed to Phase 2: POS UI
-- ============================================================
