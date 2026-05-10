-- ============================================================
-- 053_auto_apply_promotions.sql
-- Thêm cột auto_apply và combinable vào bảng promotions
-- - auto_apply: Tự động áp dụng KM vào gói vé phù hợp (không cần voucher)
-- - combinable: Có cho phép áp dụng chung với KM khác hay không
-- ============================================================

-- 1. Thêm cột auto_apply
ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS auto_apply BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.promotions.auto_apply IS 'Nếu TRUE, KM tự động áp dụng khi bán gói vé khớp applicable_ticket_types (không cần voucher/chọn thủ công).';

-- 2. Thêm cột combinable
ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS combinable BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.promotions.combinable IS 'Nếu TRUE, KM này có thể áp dụng chung với KM khác. Nếu FALSE, chỉ được dùng 1 mình.';
