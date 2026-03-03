-- Vô hiệu hóa Trigger và Ràng buộc tạm thời để xóa nhanh
SET session_replication_role = 'replica';

-- 1. Xóa các Logs, Lịch sử kiểm kho & Giao dịch hàng ngày
TRUNCATE TABLE public.scan_logs CASCADE;
TRUNCATE TABLE public.inventory_logs CASCADE;
TRUNCATE TABLE public.inventory_audit_items CASCADE;
TRUNCATE TABLE public.inventory_audits CASCADE;
TRUNCATE TABLE public.cash_transactions CASCADE;

-- 2. Xóa toàn bộ hóa đơn bán hàng và chi tiết
TRUNCATE TABLE public.order_items CASCADE;
TRUNCATE TABLE public.orders CASCADE;

-- 3. Xóa dữ liệu Vé đã bán ra 
TRUNCATE TABLE public.tickets CASCADE;

-- 4. Xóa dữ liệu Khách hàng
TRUNCATE TABLE public.customers CASCADE;

-- (Tùy chọn) 5. Cập nhật lại tồn kho của TẤT CẢ TÀI SẢN VỀ 0
UPDATE public.products SET stock_quantity = 0;

-- (Tùy chọn) 6. Khôi phục lại quỹ tiền mặt mặc định thành 0
UPDATE public.system_settings SET value = '0' WHERE key = 'cash_drawer_balance';


-- Bật lại Ràng buộc ForeignKey
SET session_replication_role = 'origin';
