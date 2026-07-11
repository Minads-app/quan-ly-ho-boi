-- ============================================================
-- Add TRANSFER_COMPANY payment method
-- ============================================================

-- 1. Add new value to the public.payment_method ENUM
ALTER TYPE public.payment_method ADD VALUE IF NOT EXISTS 'TRANSFER_COMPANY';

-- 2. Update CHECK constraint on orders table
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_payment_method_check;
ALTER TABLE public.orders ADD CONSTRAINT orders_payment_method_check CHECK (payment_method IN ('CASH', 'TRANSFER', 'CARD', 'TRANSFER_COMPANY'));
