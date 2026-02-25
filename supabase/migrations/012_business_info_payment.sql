-- ============================================================
-- 012_business_info_payment.sql
-- Thêm thông tin doanh nghiệp, tài khoản ngân hàng và hình thức thanh toán
-- ============================================================

-- 1. Thêm các key cài đặt mặc định vào bảng system_settings
INSERT INTO public.system_settings (key, value, updated_at)
VALUES 
    ('business_name', '"Hệ Thống Vé Bơi"', now()),
    ('business_address', '""', now()),
    ('business_phone', '""', now()),
    ('business_email', '""', now()),
    ('business_logo', '""', now()),
    ('bank_name', '""', now()),
    ('bank_account_number', '""', now()),
    ('bank_account_name', '""', now())
ON CONFLICT (key) DO NOTHING;

-- 2. Tạo ENUM cho hình thức thanh toán
DO $$ BEGIN
    CREATE TYPE public.payment_method AS ENUM ('CASH', 'TRANSFER', 'CARD');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 3. Thêm cột payment_method vào bảng tickets
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS payment_method public.payment_method NOT NULL DEFAULT 'CASH';

-- 4. Tạo index cho payment_method để xuất báo cáo nhanh hơn
CREATE INDEX IF NOT EXISTS idx_tickets_payment_method ON public.tickets(payment_method);
