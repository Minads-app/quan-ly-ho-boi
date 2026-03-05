-- ============================================================
-- 038_import_source.sql
-- Thêm cột source cho card_bank và tickets
-- để phân biệt dữ liệu hệ thống vs import thủ công
-- ============================================================

-- 1. Thêm cột source vào card_bank ('SYSTEM' = tạo bằng hệ thống, 'MANUAL' = thủ công/import)
ALTER TABLE public.card_bank 
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'SYSTEM'
CHECK (source IN ('SYSTEM', 'MANUAL'));

-- 2. Thêm cột source vào tickets ('POS' = bán tại quầy, 'IMPORT' = import từ hệ thống cũ)
ALTER TABLE public.tickets 
ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'POS'
CHECK (source IN ('POS', 'IMPORT'));

-- 3. Cập nhật dữ liệu cũ (tất cả card_bank hiện có là SYSTEM, tickets là POS)
UPDATE public.card_bank SET source = 'SYSTEM' WHERE source IS NULL;
UPDATE public.tickets SET source = 'POS' WHERE source IS NULL;

-- 4. Cho phép card_bank MANUAL không cần prefix/month_year/sequence_number/random_string
-- Bằng cách cho các cột đó có thể NULL
ALTER TABLE public.card_bank ALTER COLUMN prefix DROP NOT NULL;
ALTER TABLE public.card_bank ALTER COLUMN month_year DROP NOT NULL;
ALTER TABLE public.card_bank ALTER COLUMN sequence_number DROP NOT NULL;
ALTER TABLE public.card_bank ALTER COLUMN random_string DROP NOT NULL;
