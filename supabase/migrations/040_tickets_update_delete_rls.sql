-- ============================================================
-- 040_tickets_update_delete_rls.sql
-- Cho phép ADMIN update và delete tickets từ client
-- (Trước đây chỉ có validate_and_scan SECURITY DEFINER mới update được)
-- ============================================================

-- Cho phép ADMIN cập nhật tickets (sửa gói thẻ, lượt, ngày...)
CREATE POLICY "tickets_update_admin"
    ON public.tickets FOR UPDATE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );

-- Cho phép ADMIN xóa tickets
CREATE POLICY "tickets_delete_admin"
    ON public.tickets FOR DELETE
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = auth.uid() AND role = 'ADMIN'
        )
    );
