-- ============================================================
-- 033_customer_hotkey.sql
-- Thêm cột hotkey cho khách hàng (phím tắt F6-F10)
-- ============================================================

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS hotkey TEXT UNIQUE
CHECK (hotkey IS NULL OR hotkey IN ('F6', 'F7', 'F8', 'F9', 'F10'));

COMMENT ON COLUMN public.customers.hotkey IS 'Phím tắt (F6-F10) để nhanh chóng điền thông tin KH trong POS. Mỗi phím chỉ gán cho 1 KH.';
