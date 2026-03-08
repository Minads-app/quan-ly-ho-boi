-- ============================================================
-- 046_fix_checkout_customer_id.sql
-- Fix: Gói dịch vụ không được nạp vào thẻ khách khi đăng ký
-- Nguyên nhân: create_checkout_order không tạo ticket record
-- ============================================================

-- 0. PHỤC HỒI: Tạo lại tickets bị thiếu từ order_items
-- (Trường hợp order_items tồn tại nhưng tickets KHÔNG được tạo)
INSERT INTO public.tickets (
    ticket_type_id, status, customer_name, customer_phone,
    card_code, customer_id, sold_by, price_paid,
    remaining_sessions, total_sessions,
    payment_method, order_id, sold_at
)
SELECT 
    oi.ticket_type_id,
    'UNUSED',
    o.customer_name,
    o.customer_phone,
    c.card_code,
    c.id AS customer_id,
    o.created_by AS sold_by,
    oi.unit_price AS price_paid,
    tt.session_count AS remaining_sessions,
    tt.session_count AS total_sessions,
    o.payment_method::public.payment_method,
    oi.order_id,
    o.created_at AS sold_at
FROM public.order_items oi
JOIN public.orders o ON o.id = oi.order_id
JOIN public.ticket_types tt ON tt.id = oi.ticket_type_id
LEFT JOIN public.customers c ON c.phone = o.customer_phone
WHERE oi.ticket_type_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.tickets t 
    WHERE t.order_id = oi.order_id 
      AND t.ticket_type_id = oi.ticket_type_id
  );

-- 1a. Fix dữ liệu hiện tại: gán customer_id cho tickets đã có card_code nhưng thiếu customer_id
UPDATE public.tickets t
SET customer_id = c.id
FROM public.customers c
WHERE t.card_code = c.card_code
  AND t.customer_id IS NULL
  AND t.card_code IS NOT NULL
  AND t.card_code != '';

-- 1b. Fix tickets KHÔNG có card_code: match bằng customer_phone → gán cả customer_id VÀ card_code
UPDATE public.tickets t
SET customer_id = c.id,
    card_code = c.card_code
FROM public.customers c
WHERE t.customer_phone = c.phone
  AND t.customer_id IS NULL
  AND (t.card_code IS NULL OR t.card_code = '')
  AND t.customer_phone IS NOT NULL
  AND t.customer_phone != ''
  AND c.phone != '';

-- 2. Cập nhật function create_checkout_order để tự động gán customer_id
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
    v_card_code TEXT;
    v_customer_id UUID;
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
            
            -- Tìm customer_id từ card_code hoặc customer_phone
            v_card_code := NULLIF(v_item->'ticket_metadata'->>'card_code', '');
            v_customer_id := NULL;
            IF v_card_code IS NOT NULL THEN
                SELECT id INTO v_customer_id
                FROM public.customers
                WHERE card_code = v_card_code
                LIMIT 1;
            END IF;
            -- Fallback: tìm qua customer_phone nếu không có card_code
            IF v_customer_id IS NULL AND NULLIF(v_item->'ticket_metadata'->>'customer_phone', '') IS NOT NULL THEN
                SELECT id, card_code INTO v_customer_id, v_card_code
                FROM public.customers
                WHERE phone = v_item->'ticket_metadata'->>'customer_phone'
                LIMIT 1;
            END IF;

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
                    order_id, customer_id
                ) VALUES (
                    (v_item->>'id')::UUID,
                    'UNUSED',
                    NULLIF(v_item->'ticket_metadata'->>'customer_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'customer_phone', ''),
                    (NULLIF(v_item->'ticket_metadata'->>'valid_from', ''))::DATE,
                    (NULLIF(v_item->'ticket_metadata'->>'valid_until', ''))::DATE,
                    p_user_id,
                    (v_item->>'unit_price')::INTEGER,
                    (v_item->'ticket_metadata'->>'remaining_sessions')::INTEGER,
                    (v_item->'ticket_metadata'->>'total_sessions')::INTEGER,
                    (NULLIF(v_item->'ticket_metadata'->>'promotion_id', ''))::UUID,
                    v_card_code,
                    p_payment_method::public.payment_method,
                    (v_item->'ticket_metadata'->>'customer_birth_year')::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'customer_name_2', ''),
                    (v_item->'ticket_metadata'->>'customer_birth_year_2')::INTEGER,
                    (v_item->'ticket_metadata'->>'custom_duration_months')::NUMERIC,
                    (v_item->'ticket_metadata'->>'custom_validity_days')::INTEGER,
                    NULLIF(v_item->'ticket_metadata'->>'guardian_name', ''),
                    NULLIF(v_item->'ticket_metadata'->>'guardian_phone', ''),
                    v_order_id,
                    v_customer_id
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
