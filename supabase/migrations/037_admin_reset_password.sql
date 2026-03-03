-- ============================================================
-- 037_admin_reset_password.sql
-- Allow ADMIN to reset other users' passwords
-- ============================================================

-- Bật extension pgcrypto nếu chưa có
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.admin_reset_user_password(
    p_user_id UUID,
    p_new_password TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Kiểm tra người gọi có quyền ADMIN không
    IF NOT EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'ADMIN'
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Chỉ tài khoản ADMIN mới có quyền đổi mật khẩu người khác.');
    END IF;

    -- Cập nhật mật khẩu mã hóa vào bảng auth.users
    UPDATE auth.users
    SET encrypted_password = crypt(p_new_password, gen_salt('bf')),
        updated_at = now()
    WHERE id = p_user_id;

    RETURN jsonb_build_object('success', true);
END;
$$;
