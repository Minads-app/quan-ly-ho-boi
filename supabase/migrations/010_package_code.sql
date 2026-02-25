-- ============================================================
-- 010_package_code.sql
-- Thêm mã gói (package_code) tự sinh cho mỗi vé/gói bơi
-- ============================================================

-- 1. Thêm cột package_code
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS package_code TEXT;

-- 2. Tạo sequence cho mã gói
CREATE SEQUENCE IF NOT EXISTS public.package_code_seq START 1;

-- 3. Function tự sinh mã gói: PKG-YYYYMMDD-NNN
CREATE OR REPLACE FUNCTION public.generate_package_code()
RETURNS TRIGGER AS $$
DECLARE
    v_date TEXT;
    v_seq INT;
BEGIN
    -- Chỉ sinh mã cho thẻ tháng/nhiều buổi (không sinh cho vé lượt)
    IF NEW.package_code IS NULL THEN
        SELECT category INTO v_date FROM public.ticket_types WHERE id = NEW.ticket_type_id;
        IF v_date IN ('MONTHLY', 'MULTI') THEN
            v_seq := nextval('public.package_code_seq');
            NEW.package_code := 'PKG-' || to_char(now() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. Trigger tự sinh mã gói trước khi INSERT
DROP TRIGGER IF EXISTS trg_generate_package_code ON public.tickets;
CREATE TRIGGER trg_generate_package_code
    BEFORE INSERT ON public.tickets
    FOR EACH ROW
    EXECUTE FUNCTION public.generate_package_code();

-- 5. Sinh mã cho dữ liệu cũ
DO $$
DECLARE
    r RECORD;
    v_seq INT;
BEGIN
    FOR r IN
        SELECT t.id, t.sold_at
        FROM public.tickets t
        JOIN public.ticket_types tt ON t.ticket_type_id = tt.id
        WHERE tt.category IN ('MONTHLY', 'MULTI')
          AND t.package_code IS NULL
        ORDER BY t.sold_at ASC
    LOOP
        v_seq := nextval('public.package_code_seq');
        UPDATE public.tickets
        SET package_code = 'PKG-' || to_char(r.sold_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYYMMDD') || '-' || lpad(v_seq::TEXT, 4, '0')
        WHERE id = r.id;
    END LOOP;
END $$;
