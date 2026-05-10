-- ============================================================
-- 055_gate_ticket_config.sql
-- Thêm cấu hình có/không in vé vào cổng soát khi check-in.
-- Ví dụ: Khóa bóng rổ không cần in vé vì không qua cổng soát vào hồ.
-- ============================================================

-- 1. Thêm cột requires_gate_ticket vào ticket_types
ALTER TABLE public.ticket_types
ADD COLUMN IF NOT EXISTS requires_gate_ticket BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.ticket_types.requires_gate_ticket IS 'Khi check-in, có tạo vé lượt để qua cổng soát vé không? false = chỉ điểm danh, không in vé.';

-- 2. Tự động set false cho các gói bóng rổ hiện có
UPDATE public.ticket_types SET requires_gate_ticket = false WHERE sport_type = 'BASKETBALL';
