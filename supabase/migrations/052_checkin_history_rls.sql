-- ============================================================
-- 052_checkin_history_rls.sql
-- Cho phép tất cả nhân viên (authenticated) xem bảng cancelled_tickets
-- để hiển thị trạng thái hủy trong lịch sử check-in thẻ gói
-- ============================================================

-- Thêm policy SELECT cho tất cả authenticated users
CREATE POLICY "Staff can view cancelled tickets"
    ON cancelled_tickets
    FOR SELECT
    TO authenticated
    USING (true);
