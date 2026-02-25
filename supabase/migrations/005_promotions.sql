-- ============================================================
-- 005_promotions.sql
-- Thêm hệ thống Quản lý Khuyến Mãi (Promotions)
-- Hỗ trợ Giảm tiền, Giảm % và Tặng lượt. Hỗ trợ vô thời hạn.
-- ============================================================

-- 1. Tạo ENUM cho loại Khuyến mãi
DO $$ BEGIN
    CREATE TYPE public.discount_type AS ENUM ('AMOUNT', 'PERCENT', 'BONUS_SESSION');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Tạo bảng Promotions
CREATE TABLE IF NOT EXISTS public.promotions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,                              -- Tên chương trình KM (VD: "Giảm 10% Hè", "Mua 10 tặng 2")
    type            public.discount_type NOT NULL,              -- Kiểu KM: Trừ tiền, Trừ %, Tặng buổi
    value           INTEGER NOT NULL CHECK (value > 0),         -- Giá trị (Số tiền / Số % / Số buổi tặng)
    valid_from      TIMESTAMPTZ,                                -- Ngày bắt đầu (Tùy chọn)
    valid_until     TIMESTAMPTZ,                                -- Ngày kết thúc (Tùy chọn - Để NULL là vô thời hạn)
    is_active       BOOLEAN NOT NULL DEFAULT true,              -- Bật/Tắt thủ công
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.promotions IS 'Các chương trình khuyến mãi (Giảm giá, Tặng buổi).';

-- 3. Cập nhật bảng Tickets để lưu vết Khuyến mãi đã dùng
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS promotion_id UUID REFERENCES public.promotions(id);

-- 4. Thêm một số dữ liệu seed làm ví dụ (Vô thời hạn)
INSERT INTO public.promotions (name, type, value, valid_from, valid_until, is_active)
VALUES 
    ('Chương trình Tặng 2 lượt (Combo 10+2)', 'BONUS_SESSION', 2, NULL, NULL, true),
    ('Khuyến mãi Khai trương giảm 10%', 'PERCENT', 10, NULL, NULL, true)
ON CONFLICT DO NOTHING;
