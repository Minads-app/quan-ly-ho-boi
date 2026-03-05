-- Bảng Quản lý Ngân hàng thẻ (Card Bank)

CREATE TABLE public.card_bank (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    card_code TEXT UNIQUE NOT NULL,
    prefix TEXT NOT NULL,
    month_year TEXT NOT NULL,
    sequence_number INTEGER NOT NULL,
    random_string TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'UNUSED' CHECK (status IN ('UNUSED', 'USED', 'REVOKED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.card_bank ENABLE ROW LEVEL SECURITY;

-- Tạo index để tìm kiếm nhanh theo mã thẻ
CREATE INDEX idx_card_bank_card_code ON public.card_bank(card_code);
CREATE INDEX idx_card_bank_status ON public.card_bank(status);

-- Policies
-- Admin có thể insert, update, select tất cả
CREATE POLICY "Admin can full access card_bank" 
ON public.card_bank 
FOR ALL 
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role = 'ADMIN'
    )
);

-- Staff chỉ có thể select, update state sang USED (nếu cần, nhưng có logic ở frontend check rồi)
CREATE POLICY "Staff can select and update card_bank" 
ON public.card_bank 
FOR SELECT 
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role IN ('ADMIN', 'STAFF', 'CASHIER')
    )
);

CREATE POLICY "Staff can update card_bank status" 
ON public.card_bank 
FOR UPDATE 
USING (
    EXISTS (
        SELECT 1 FROM public.profiles
        WHERE profiles.id = auth.uid() AND profiles.role IN ('ADMIN', 'STAFF', 'CASHIER')
    )
);
