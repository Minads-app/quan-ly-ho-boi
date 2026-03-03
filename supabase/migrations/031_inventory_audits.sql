-- 031_inventory_audits.sql

-- Bảng lưu trữ Phiếu Kiểm Kho
CREATE TABLE IF NOT EXISTS public.inventory_audits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status VARCHAR(20) NOT NULL DEFAULT 'COMPLETED',
    note TEXT,
    created_by UUID REFERENCES public.profiles(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_audits IS 'Lưu trữ thông tin các phiếu kiểm kho';

-- Bảng lưu trữ Chi tiết sản phẩm trong Phiếu Kiểm Kho
CREATE TABLE IF NOT EXISTS public.inventory_audit_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    audit_id UUID NOT NULL REFERENCES public.inventory_audits(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
    system_quantity INTEGER NOT NULL,
    actual_quantity INTEGER NOT NULL,
    difference INTEGER NOT NULL, -- actual_quantity - system_quantity
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.inventory_audit_items IS 'Chi tiết các sản phẩm được kiểm kê trong phiếu kiểm kho';

-- Hàm RPC Xử lý nút Cân bằng kho
-- items JSON format: [{"product_id": "uuid", "system_quantity": 10, "actual_quantity": 12}, ...]
CREATE OR REPLACE FUNCTION public.balance_inventory_audit(
    p_note TEXT,
    p_user_id UUID,
    p_items JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_audit_id UUID;
    v_item JSONB;
    v_diff INTEGER;
    v_sys_qty INTEGER;
    v_act_qty INTEGER;
    v_product_id UUID;
BEGIN
    -- 1. Tạo Phiếu kiểm kho mới
    INSERT INTO public.inventory_audits (note, created_by)
    VALUES (p_note, p_user_id)
    RETURNING id INTO v_audit_id;

    -- 2. Duyệt qua từng sản phẩm được truyền vào
    FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
    LOOP
        v_product_id := (v_item->>'product_id')::UUID;
        v_sys_qty := (v_item->>'system_quantity')::INTEGER;
        v_act_qty := (v_item->>'actual_quantity')::INTEGER;
        v_diff := v_act_qty - v_sys_qty;

        -- 2.1. Thêm vào chi tiết phiếu kiểm
        INSERT INTO public.inventory_audit_items (audit_id, product_id, system_quantity, actual_quantity, difference)
        VALUES (v_audit_id, v_product_id, v_sys_qty, v_act_qty, v_diff);

        -- 2.2. Kiểm tra chênh lệch và cập nhật số lượng tồn, phát sinh phiếu Nhập/ Xuất
        IF v_diff > 0 THEN
            -- Thực tế > Hệ thống => Nhập số lượng dư vào kho (IMPORT)
            INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
            VALUES (v_product_id, 'IMPORT', v_diff, 'Nhập kiểm kê (' || substr(v_audit_id::text, 1, 8) || ')', p_user_id);
            
            UPDATE public.products
            SET stock_quantity = stock_quantity + v_diff
            WHERE id = v_product_id;

        ELSIF v_diff < 0 THEN
            -- Thực tế < Hệ thống => Xuất số lượng thiếu khỏi kho (EXPORT_ADJUST) 
            -- (Mức chênh lệch âm <=> Export ra)
            INSERT INTO public.inventory_logs (product_id, type, quantity, note, created_by)
            VALUES (v_product_id, 'EXPORT_ADJUST', v_diff, 'Xuất kiểm kê (' || substr(v_audit_id::text, 1, 8) || ')', p_user_id);
            
            UPDATE public.products
            SET stock_quantity = stock_quantity + v_diff  -- V_diff đã là số âm, kho sẽ trừ đi
            WHERE id = v_product_id;
        END IF;

    END LOOP;

    RETURN jsonb_build_object('success', true, 'audit_id', v_audit_id);
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
