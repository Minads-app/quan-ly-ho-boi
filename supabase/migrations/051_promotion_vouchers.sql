-- ============================================================
-- 051_promotion_vouchers.sql
-- Hệ thống Voucher Khuyến Mãi (Chống lạm dụng)
-- - Thêm customer_condition vào promotions
-- - Tạo bảng promotion_vouchers (kho mã)
-- - Tạo bảng promotion_usage (lịch sử sử dụng)
-- - RPC function generate_vouchers & validate_voucher
-- ============================================================

-- 1. Cập nhật bảng promotions: thêm customer_condition
ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS customer_condition TEXT NOT NULL DEFAULT 'ALL'
CHECK (customer_condition IN ('ALL', 'NEW_CUSTOMER', 'OLD_CUSTOMER'));

COMMENT ON COLUMN public.promotions.customer_condition IS 'Điều kiện khách hàng: ALL (Tất cả), NEW_CUSTOMER (Chưa từng mua), OLD_CUSTOMER (Đã từng mua).';

-- 2. Tạo bảng promotion_vouchers (Kho Mã Voucher)
CREATE TABLE IF NOT EXISTS public.promotion_vouchers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    promotion_id    UUID NOT NULL REFERENCES public.promotions(id) ON DELETE CASCADE,
    code            TEXT NOT NULL,
    max_uses        INTEGER DEFAULT 1 CHECK (max_uses IS NULL OR max_uses > 0),  -- NULL = Không giới hạn lượt
    used_count      INTEGER NOT NULL DEFAULT 0,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint (case-insensitive) để không bị trùng mã
CREATE UNIQUE INDEX IF NOT EXISTS idx_promotion_vouchers_code_unique ON public.promotion_vouchers (UPPER(code));

COMMENT ON TABLE public.promotion_vouchers IS 'Kho mã Voucher khuyến mãi. Mỗi mã thuộc 1 chương trình (promotion).';
COMMENT ON COLUMN public.promotion_vouchers.max_uses IS 'Số lượt dùng tối đa. NULL = Không giới hạn. 1 = Mã dùng 1 lần.';

-- 3. Tạo bảng promotion_usage (Lịch sử sử dụng - Chống lạm dụng)
CREATE TABLE IF NOT EXISTS public.promotion_usage (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    voucher_id      UUID NOT NULL REFERENCES public.promotion_vouchers(id) ON DELETE CASCADE,
    customer_id     UUID NOT NULL REFERENCES public.customers(id),
    ticket_id       UUID REFERENCES public.tickets(id),
    used_by         UUID REFERENCES auth.users(id),  -- Nhân viên nào đã áp dụng
    used_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.promotion_usage IS 'Lịch sử sử dụng mã Voucher. Dùng để chống lạm dụng và truy vết.';

-- Index cho việc truy vấn nhanh
CREATE INDEX IF NOT EXISTS idx_promotion_usage_voucher ON public.promotion_usage (voucher_id);
CREATE INDEX IF NOT EXISTS idx_promotion_usage_customer ON public.promotion_usage (customer_id);

-- 4. RLS Policies
ALTER TABLE public.promotion_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_usage ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    CREATE POLICY "Allow all for authenticated" ON public.promotion_vouchers FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE POLICY "Allow all for authenticated" ON public.promotion_usage FOR ALL USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 5. RPC: Tạo hàng loạt mã Voucher
CREATE OR REPLACE FUNCTION public.generate_vouchers(
    p_promotion_id UUID,
    p_prefix TEXT,
    p_quantity INTEGER,
    p_max_uses INTEGER DEFAULT 1
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_codes TEXT[] := '{}';
    v_code TEXT;
    v_i INTEGER := 0;
    v_attempts INTEGER := 0;
    v_chars TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- Bỏ I, O, 0, 1 để tránh nhầm lẫn
    v_rand TEXT;
    v_j INTEGER;
BEGIN
    IF p_quantity < 1 OR p_quantity > 500 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Số lượng phải từ 1 đến 500.');
    END IF;

    -- Kiểm tra promotion tồn tại
    IF NOT EXISTS (SELECT 1 FROM public.promotions WHERE id = p_promotion_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Chương trình khuyến mãi không tồn tại.');
    END IF;

    WHILE v_i < p_quantity AND v_attempts < p_quantity * 10 LOOP
        v_attempts := v_attempts + 1;

        -- Sinh chuỗi ngẫu nhiên 4 ký tự
        v_rand := '';
        FOR v_j IN 1..4 LOOP
            v_rand := v_rand || substr(v_chars, floor(random() * length(v_chars) + 1)::int, 1);
        END LOOP;

        v_code := UPPER(COALESCE(p_prefix, '')) || v_rand;

        -- Kiểm tra trùng lặp (case-insensitive)
        IF NOT EXISTS (SELECT 1 FROM public.promotion_vouchers WHERE UPPER(code) = v_code) THEN
            INSERT INTO public.promotion_vouchers (promotion_id, code, max_uses)
            VALUES (p_promotion_id, v_code, p_max_uses);
            v_codes := v_codes || v_code;
            v_i := v_i + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'count', v_i, 'codes', to_jsonb(v_codes));
END;
$$;

-- 6. RPC: Xác thực Voucher khi Thu ngân nhập mã trên POS
CREATE OR REPLACE FUNCTION public.validate_voucher(
    p_code TEXT,
    p_customer_id UUID,
    p_ticket_type_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_voucher RECORD;
    v_promo RECORD;
    v_usage_count INTEGER;
    v_has_history BOOLEAN;
BEGIN
    -- 1. Tìm mã voucher (case-insensitive)
    SELECT pv.*, p.name AS promo_name, p.type AS promo_type, p.value AS promo_value,
           p.valid_from, p.valid_until, p.is_active AS promo_active,
           p.customer_condition, p.applicable_ticket_types, p.applicable_lesson_types
    INTO v_voucher
    FROM public.promotion_vouchers pv
    JOIN public.promotions p ON p.id = pv.promotion_id
    WHERE UPPER(pv.code) = UPPER(TRIM(p_code))
    LIMIT 1;

    IF v_voucher IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Mã Voucher không tồn tại.');
    END IF;

    -- 2. Kiểm tra mã có đang hoạt động
    IF NOT v_voucher.is_active THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Mã Voucher đã bị vô hiệu hóa.');
    END IF;

    -- 3. Kiểm tra chương trình cha có đang hoạt động
    IF NOT v_voucher.promo_active THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Chương trình khuyến mãi "' || v_voucher.promo_name || '" đã tạm dừng.');
    END IF;

    -- 4. Kiểm tra thời hạn chương trình
    IF v_voucher.valid_from IS NOT NULL AND now() < v_voucher.valid_from THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Chương trình chưa bắt đầu.');
    END IF;
    IF v_voucher.valid_until IS NOT NULL AND now() > v_voucher.valid_until THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Chương trình đã hết hạn.');
    END IF;

    -- 5. Kiểm tra lượt dùng
    IF v_voucher.max_uses IS NOT NULL AND v_voucher.used_count >= v_voucher.max_uses THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Mã Voucher đã hết lượt sử dụng.');
    END IF;

    -- 6. Kiểm tra bắt buộc chọn khách hàng
    IF p_customer_id IS NULL THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Vui lòng chọn thông tin Khách hàng trước khi áp dụng Voucher.');
    END IF;

    -- 7. Kiểm tra điều kiện khách hàng (Cũ/Mới)
    IF v_voucher.customer_condition = 'OLD_CUSTOMER' THEN
        SELECT EXISTS (SELECT 1 FROM public.tickets WHERE customer_id = p_customer_id LIMIT 1) INTO v_has_history;
        IF NOT v_has_history THEN
            RETURN jsonb_build_object('valid', false, 'error', 'Mã này chỉ dành cho Khách hàng cũ (đã từng mua vé/gói). Khách hàng này chưa có lịch sử giao dịch.');
        END IF;
    ELSIF v_voucher.customer_condition = 'NEW_CUSTOMER' THEN
        SELECT EXISTS (SELECT 1 FROM public.tickets WHERE customer_id = p_customer_id LIMIT 1) INTO v_has_history;
        IF v_has_history THEN
            RETURN jsonb_build_object('valid', false, 'error', 'Mã này chỉ dành cho Khách hàng mới. Khách hàng này đã có lịch sử giao dịch trước đó.');
        END IF;
    END IF;

    -- 8. Kiểm tra khách đã dùng mã này chưa (mỗi khách chỉ dùng 1 lần / voucher)
    SELECT COUNT(*) INTO v_usage_count FROM public.promotion_usage
    WHERE voucher_id = v_voucher.id AND customer_id = p_customer_id;
    IF v_usage_count > 0 THEN
        RETURN jsonb_build_object('valid', false, 'error', 'Khách hàng này đã sử dụng mã Voucher này trước đó.');
    END IF;

    -- 9. Kiểm tra loại vé/gói có được áp dụng
    IF p_ticket_type_id IS NOT NULL THEN
        -- Kiểm tra applicable_ticket_types
        IF v_voucher.applicable_ticket_types IS NOT NULL AND 
           NOT (p_ticket_type_id = ANY(v_voucher.applicable_ticket_types)) AND
           (v_voucher.applicable_lesson_types IS NULL OR NOT (p_ticket_type_id = ANY(v_voucher.applicable_lesson_types))) THEN
            RETURN jsonb_build_object('valid', false, 'error', 'Mã Voucher này không áp dụng cho loại vé/gói được chọn.');
        END IF;
    END IF;

    -- Hợp lệ! Trả về thông tin khuyến mãi
    RETURN jsonb_build_object(
        'valid', true,
        'voucher_id', v_voucher.id,
        'promotion_id', v_voucher.promotion_id,
        'promo_name', v_voucher.promo_name,
        'promo_type', v_voucher.promo_type,
        'promo_value', v_voucher.promo_value,
        'customer_condition', v_voucher.customer_condition
    );
END;
$$;

-- 7. RPC: Ghi nhận sử dụng voucher (Gọi khi thanh toán thành công)
CREATE OR REPLACE FUNCTION public.use_voucher(
    p_voucher_id UUID,
    p_customer_id UUID,
    p_ticket_id UUID DEFAULT NULL,
    p_used_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Tăng used_count
    UPDATE public.promotion_vouchers
    SET used_count = used_count + 1, updated_at = now()
    WHERE id = p_voucher_id;

    -- Ghi lịch sử
    INSERT INTO public.promotion_usage (voucher_id, customer_id, ticket_id, used_by)
    VALUES (p_voucher_id, p_customer_id, p_ticket_id, p_used_by);

    RETURN jsonb_build_object('success', true);
END;
$$;
