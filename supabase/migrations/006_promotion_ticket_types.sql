-- ============================================================
-- 006_promotion_ticket_types.sql
-- Thêm cột tính năng: Áp dụng KM cho từng loại vé cụ thể
-- ============================================================

ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS applicable_ticket_types UUID[] DEFAULT NULL;

COMMENT ON COLUMN public.promotions.applicable_ticket_types IS 'Array chứa ID thẻ vé được áp dụng. Nếu NULL, áp dụng cho tất cả loại vé.';
