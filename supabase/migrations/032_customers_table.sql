-- ============================================================
-- 032_customers_table.sql
-- Tạo bảng customers riêng để quản lý thông tin khách hàng
-- ============================================================

-- 1. Tạo bảng customers
CREATE TABLE IF NOT EXISTS public.customers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_code   TEXT UNIQUE NOT NULL,
    full_name   TEXT NOT NULL,
    phone       TEXT NOT NULL,
    email       TEXT,
    birth_date  DATE,
    gender      TEXT CHECK (gender IN ('Nam', 'Nữ', 'Khác') OR gender IS NULL),
    note        TEXT,
    address     TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.customers IS 'Bảng quản lý thông tin khách hàng riêng, liên kết với tickets qua card_code hoặc customer_id.';

-- 2. Index nhanh cho tìm kiếm
CREATE INDEX IF NOT EXISTS idx_customers_card_code ON public.customers(card_code);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON public.customers(phone);
CREATE INDEX IF NOT EXISTS idx_customers_full_name ON public.customers USING gin(to_tsvector('simple', full_name));

-- 3. Thêm cột customer_id vào tickets (optional FK)
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL;

-- 4. Migrate dữ liệu KH cũ từ tickets vào customers (deduplicate by card_code)
INSERT INTO public.customers (card_code, full_name, phone)
SELECT DISTINCT ON (t.card_code)
    t.card_code,
    COALESCE(t.customer_name, 'Chưa có tên'),
    COALESCE(t.customer_phone, '')
FROM public.tickets t
WHERE t.card_code IS NOT NULL AND t.card_code != ''
ORDER BY t.card_code, t.sold_at DESC
ON CONFLICT (card_code) DO NOTHING;

-- 5. Liên kết tickets cũ với customers qua card_code  
UPDATE public.tickets t
SET customer_id = c.id
FROM public.customers c
WHERE t.card_code = c.card_code AND t.customer_id IS NULL;

-- 6. RLS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "customers_select_authenticated"
    ON public.customers FOR SELECT TO authenticated USING (true);

CREATE POLICY "customers_insert_authenticated"
    ON public.customers FOR INSERT TO authenticated
    WITH CHECK (true);

CREATE POLICY "customers_update_authenticated"
    ON public.customers FOR UPDATE TO authenticated
    USING (true) WITH CHECK (true);

CREATE POLICY "customers_delete_admin"
    ON public.customers FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- 7. Auto-update updated_at
CREATE TRIGGER trg_customers_updated_at
    BEFORE UPDATE ON public.customers
    FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
