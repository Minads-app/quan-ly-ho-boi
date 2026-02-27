-- ============================================================
-- 022_lesson_age_pricing.sql
-- Thêm tính năng cấu hình giá theo độ tuổi cho gói học bơi
-- ============================================================

-- 1. Thêm cột age_price_tiers vào bảng ticket_types để cấu hình các mức giá
-- Lưu trữ dưới dạng JSONB mảng các object: [{ "minAge": 0, "maxAge": 10, "price": 100000 }]
ALTER TABLE public.ticket_types
ADD COLUMN IF NOT EXISTS age_price_tiers JSONB;

COMMENT ON COLUMN public.ticket_types.age_price_tiers IS 'Mảng mức giá theo độ tuổi cho gói học bơi (vd: [{minAge: 0, maxAge: 10, price: ...}])';


-- 2. Thêm cột customer_birth_year vào bảng tickets (vé đã bán)
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS customer_birth_year SMALLINT;

COMMENT ON COLUMN public.tickets.customer_birth_year IS 'Năm sinh của học viên để đối chiếu độ tuổi tính giá học phí';


-- 3. Cập nhật view in vé để hiển thị được customer_birth_year nếu cần
CREATE OR REPLACE VIEW public.print_ticket AS
SELECT 
    t.id AS ticket_id,
    t.card_code AS ticket_code,
    t.customer_name,
    t.customer_phone,
    t.customer_birth_year,
    t.price_paid AS final_price,
    t.sold_at,
    t.valid_from,
    t.valid_until,
    t.total_sessions AS session_count,
    (t.total_sessions - t.remaining_sessions) AS used_sessions,
    t.payment_method,
    tt.name::text AS ticket_name,
    tt.category AS ticket_category,
    tt.price AS original_price,
    tt.lesson_class_type,
    p.name::text AS promo_name
FROM tickets t
JOIN ticket_types tt ON t.ticket_type_id = tt.id
LEFT JOIN promotions p ON t.promotion_id = p.id;
