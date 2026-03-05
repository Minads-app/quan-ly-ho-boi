-- ============================================================
-- 039_card_batch.sql
-- Thêm cột số lô (batch_number) và ghi chú lô (batch_note) 
-- để quản lý thẻ in đại trà.
-- ============================================================

-- Bổ sung các cột
ALTER TABLE public.card_bank
ADD COLUMN IF NOT EXISTS batch_number INTEGER;

ALTER TABLE public.card_bank
ADD COLUMN IF NOT EXISTS batch_note TEXT;

-- (Tùy chọn) Cập nhật các thẻ hiện có (SYSTEM) thành lô mặc định (nếu muốn)
-- Ở đây ta cứ để NULL để tránh ảnh hưởng dữ liệu cũ. NULL sẽ được hiểu là Không rành lô.
