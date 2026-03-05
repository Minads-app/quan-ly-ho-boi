-- ============================================================
-- 041_add_in_use_status.sql
-- Thêm giá trị 'IN_USE' vào enum ticket_status
-- Để hỗ trợ trạng thái "Đang sử dụng" khi admin kích hoạt gói thẻ
-- ============================================================

ALTER TYPE public.ticket_status ADD VALUE IF NOT EXISTS 'IN_USE';
