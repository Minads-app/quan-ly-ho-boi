-- ============================================================
-- 042_card_batches_view.sql
-- Tạo view thống kê các lô thẻ được nhập vào hệ thống
-- ============================================================

CREATE OR REPLACE VIEW public.card_batches_view AS
SELECT 
    batch_number,
    MAX(batch_note) AS batch_note,
    MIN(created_at) AS created_at,
    COUNT(id) AS total_cards,
    COUNT(CASE WHEN status = 'UNUSED' THEN 1 END) AS unused_cards,
    COUNT(CASE WHEN status = 'USED' THEN 1 END) AS used_cards
FROM 
    public.card_bank
WHERE 
    batch_number IS NOT NULL
GROUP BY 
    batch_number;

-- Phân quyền cho View: Ai được xem `card_bank` thì được xem `card_batches_view`
-- Tuy nhiên Views trong Postgres mặc định chạy dưới quyền của người tạo view.
-- Để bảo vệ bằng RLS của các bảng gốc, tạo view với security_invoker = true (Postgres 15+)
ALTER VIEW public.card_batches_view SET (security_invoker = true);
