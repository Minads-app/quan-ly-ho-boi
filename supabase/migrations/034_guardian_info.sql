-- ============================================================
-- 034_guardian_info.sql
-- Thêm thông tin người giám hộ cho học viên dưới 18 tuổi
-- ============================================================

-- 1. Thêm cột thông tin người giám hộ vào bảng tickets
ALTER TABLE public.tickets
ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(50);

COMMENT ON COLUMN public.tickets.guardian_name IS 'Họ tên người giám hộ (bắt buộc cho học viên dưới 18 tuổi)';
COMMENT ON COLUMN public.tickets.guardian_phone IS 'Số điện thoại người giám hộ';

-- 2. Cập nhật view in vé để hiển thị thông tin người giám hộ (tuỳ chọn)
DROP VIEW IF EXISTS public.print_ticket;
CREATE OR REPLACE VIEW public.print_ticket AS
SELECT 
    t.id AS ticket_id,
    t.card_code AS ticket_code,
    t.customer_name,
    t.customer_phone,
    t.customer_birth_year,
    t.customer_name_2,
    t.customer_birth_year_2,
    t.guardian_name,
    t.guardian_phone,
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

-- 3. Cập nhật function create_checkout_order để lưu thông tin người giám hộ
CREATE OR REPLACE FUNCTION public.create_checkout_order(
    p_total_amount INTEGER,
    p_payment_method VARCHAR,
    p_customer_name TEXT,
    p_customer_phone TEXT,
    p_note TEXT,
    p_user_id UUID,
    p_items JSONB -- Array of items
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_id UUID;
    v_item JSONB;
    v_product_stock INTEGER;
    v_i INTEGER;
    v_ticket_ids UUID[] := '{}';
    v_new_ticket_id UUID;
BEGIN
    -- 1. Create Order
    INSERT INTO public.orders (total_amount, payment_method, customer_name, customer_phone, note, created_by)
    VALUES (p_total_amount, p_payment_method, p_customer_name, p_customer_phone, p_note, p_user_id)
    RETURNING id INTO v_order_id;
    
    -- 2. Process Items
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        IF v_item->>'type' = 'PRODUCT' THEN
            -- Insert order_item
            INSERT INTO public.order_items (order_id, product_id, quantity, unit_price, subtotal)
            VALUES (v_order_id, (v_item->>'id')::UUID, (v_item->>'quantity')::INTEGER, (v_item->>'unit_price')::INTEGER, (v_item->>'subtotal')::INTEGER);
            
            -- Deduct stock
            UPDATE public.products SET stock_quantity = stock_quantity - (v_item->>'quantity')::INTEGER
            WHERE id = (v_item->>'id')::UUID
            RETURNING stock_quantity INTO v_product_stock;
            
            -- Insert inventory_log
            INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
            VALUES ((v_item->>'id')::UUID, 'SALE', -(v_item->>'quantity')::INTEGER, 'Bán hàng Order: ' || v_order_id, p_user_id);
            
        ELSIF v_item->>'type' = 'TICKET' THEN
            -- Insert order_item
            INSERT INTO public.order_items (order_id, ticket_type_id, quantity, unit_price, subtotal)
            VALUES (v_order_id, (v_item->>'id')::UUID, (v_item->>'quantity')::INTEGER, (v_item->>'unit_price')::INTEGER, (v_item->>'subtotal')::INTEGER);
            
            -- We need to generate N tickets
            FOR v_i IN 1..(v_item->>'quantity')::INTEGER LOOP
                INSERT INTO public.tickets (
                    ticket_type_id, status, customer_name, customer_phone,
                    valid_from, valid_until, sold_by, price_paid,
                    remaining_sessions, total_sessions, promotion_id,
                    card_code, payment_method, customer_birth_year,
                    customer_name_2, customer_birth_year_2,
                    custom_duration_months, custom_validity_days,
                    guardian_name, guardian_phone,
                    order_id
                ) VALUES (
                    (v_item->>'id')::UUID,
                    'UNUSED',
                    NULLIF(v_item->'ticket_metadata'->>'customer_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'customer_phone', ''),
                    (NULLIF(v_item->'ticket_metadata'->>'valid_from', ''))::DATE,
                    (NULLIF(v_item->'ticket_metadata'->>'valid_until', ''))::DATE,
                    p_user_id,
                    (v_item->>'unit_price')::INTEGER, -- unit_price here is the final price per ticket
                    (v_item->'ticket_metadata'->>'remaining_sessions')::INTEGER,
                    (v_item->'ticket_metadata'->>'total_sessions')::INTEGER,
                    (NULLIF(v_item->'ticket_metadata'->>'promotion_id', ''))::UUID,
                    NULLIF(v_item->'ticket_metadata'->>'card_code', ''),
                    p_payment_method::public.payment_method,
                    (v_item->'ticket_metadata'->>'customer_birth_year')::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'customer_name_2', ''),
                    (v_item->'ticket_metadata'->>'customer_birth_year_2')::INTEGER,
                    (v_item->'ticket_metadata'->>'custom_duration_months')::NUMERIC,
                    (v_item->'ticket_metadata'->>'custom_validity_days')::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'guardian_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'guardian_phone', ''),
                    v_order_id
                ) RETURNING id INTO v_new_ticket_id;
                
                v_ticket_ids := array_append(v_ticket_ids, v_new_ticket_id);
            END LOOP;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'order_id', v_order_id, 'ticket_ids', v_ticket_ids);
EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
