-- ============================================================
-- 020_promo_lesson_types.sql
-- Thêm cột: Áp dụng KM cho các gói khóa học bơi
-- ============================================================

ALTER TABLE public.promotions
ADD COLUMN IF NOT EXISTS applicable_lesson_types UUID[] DEFAULT NULL;

COMMENT ON COLUMN public.promotions.applicable_lesson_types IS 'Array chứa ID gói khóa học được áp dụng. Nếu NULL, áp dụng cho tất cả gói khóa học (hoặc không áp dụng cho khóa học).';
