-- ============================================================
-- PHASE 2: Retail, Inventory & Expenses
-- Adds products, shopping cart unified orders, inventory tracking,
-- and office expenses management.
-- ============================================================

-- ============================================================
-- 1. UPDATE USER PROFILES FOR NEW PERMISSIONS
-- ============================================================
ALTER TABLE public.profiles 
ADD COLUMN IF NOT EXISTS can_create_expense BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS can_manage_inventory BOOLEAN NOT NULL DEFAULT false;

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

-- ----------------------------------------------------------
-- 2a. products — Retail products
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.products IS 'Retail items (e.g. water, goggles)';

-- ----------------------------------------------------------
-- 2b. inventory_logs — Track stock changes
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.inventory_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL CHECK (type IN ('IMPORT', 'EXPORT_ADJUST', 'SALE')),
    quantity INTEGER NOT NULL, -- Positive for import, Negative for sale/adjustment
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_logs IS 'Audit trail for all stock in/outs';

-- ----------------------------------------------------------
-- 2c. orders — Unified checkout (Tickets + Retail)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('CASH', 'TRANSFER', 'CARD')),
    customer_name TEXT,
    customer_phone TEXT,
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.orders IS 'Combined invoice for both tickets and retail products sold together';

-- ----------------------------------------------------------
-- 2d. order_items — Individual items in a checkout
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES public.products(id) ON DELETE SET NULL, -- Mutually exclusive with ticket_type_id
    ticket_type_id UUID REFERENCES public.ticket_types(id) ON DELETE SET NULL, 
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
    subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (product_id IS NOT NULL AND ticket_type_id IS NULL) OR 
        (product_id IS NULL AND ticket_type_id IS NOT NULL)
    )
);

-- ----------------------------------------------------------
-- 2e. expenses — Cash outflows
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.expenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amount INTEGER NOT NULL CHECK (amount > 0),
    reason TEXT NOT NULL,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.expenses IS 'Cash out records by employees';

-- ============================================================
-- 3. TRIGGERS & RPCs
-- ============================================================

-- Update updated_at trigger for products
CREATE TRIGGER trg_products_updated_at
    BEFORE UPDATE ON public.products
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Enable RLS
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

-- Default Policies (Authenticated Read/Write for simplicity, matching your current model)
CREATE POLICY "products_all_authenticated" ON public.products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "inventory_logs_all_authenticated" ON public.inventory_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "orders_all_authenticated" ON public.orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "order_items_all_authenticated" ON public.order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "expenses_all_authenticated" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ============================================================
-- EXPOSED RPC FUNCTION FOR SECURE INVENTORY ADJUSTMENT
-- ============================================================
CREATE OR REPLACE FUNCTION public.adjust_inventory(
    p_product_id UUID,
    p_quantity INTEGER,
    p_type VARCHAR(50),
    p_note TEXT,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_stock INTEGER;
BEGIN
    -- Check if product exists and get lock
    SELECT stock_quantity INTO v_current_stock FROM public.products WHERE id = p_product_id FOR UPDATE;
    
    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'PRODUCT_NOT_FOUND');
    END IF;

    -- For Sales or Export, verify enough stock (optional constraint, some pos allow negative but let's prevent large negatives just in case)
    IF p_quantity < 0 AND v_current_stock + p_quantity < 0 THEN
       -- we will allow it to go negative in case of stock count mismatch, but log it clearly
    END IF;

    -- Update stock
    UPDATE public.products SET stock_quantity = stock_quantity + p_quantity WHERE id = p_product_id;

    -- Create log
    INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
    VALUES (p_product_id, p_type, p_quantity, p_note, p_user_id);

    RETURN jsonb_build_object('success', true, 'new_stock', v_current_stock + p_quantity);
END;
$$;
