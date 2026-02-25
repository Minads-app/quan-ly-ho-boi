-- ============================================================
-- 003_user_roles.sql
-- Thêm các Enum vai trò (Role) mới và siết chặt bảo mật (RLS)
-- ============================================================

-- 1. Thêm 2 kiểu Enum mới vào public.user_role
-- (PostgreSQL không hỗ trợ CREATE TYPE IF NOT EXISTS cho ENUM giá trị)
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'CASHIER';
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'GATE_KEEPER';

-- 2. Cập nhật RLS Policy cho bảng profiles
-- Mặc định ở Migration 001 là: "users có thể update profile của chính mình"
-- Tuy nhiên, nếu cho phép họ tự update profile, họ CÓ THỂ tự update 'role' của mình thành 'ADMIN'.
-- Vì vậy, phải chặn Update cột 'role' đối với user thường, và CHỈ CHO PHÉP 'ADMIN' update tất cả.

-- Xóa Policy cũ (cho phép user tự sửa mọi thứ)
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;

-- Thêm Policy 1: User thường được tự cập nhật Tên và Avatar của mình (NHƯNG KHÔNG ĐƯỢC sửa Role)
CREATE POLICY "profiles_update_own_details_only"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id AND role = (SELECT role FROM public.profiles WHERE id = auth.uid())); 
    -- Ràng buộc check: role mới nhập vào phải giống role cũ trong DB -> Ngăn tự nâng quyền

-- Thêm Policy 2: User có role 'ADMIN' được quyền UPDATE toàn bộ bảng profiles (để phân quyền cho người khác)
CREATE POLICY "profiles_update_all_by_admin"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ADMIN')
    WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'ADMIN');

-- Tóm lại:
-- - Mọi người có thể đọc bảng profiles (để lấy danh sách).
-- - User bị giới hạn chỉ sửa thông tin cá nhân của họ mà không thay đổi được chức vụ.
-- - Chỉ Admin mới sửa được chức vụ của bất kỳ ai.
