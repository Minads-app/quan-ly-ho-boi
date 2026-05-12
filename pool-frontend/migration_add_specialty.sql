-- Script để thêm trường chuyên môn cho Huấn luyện viên
ALTER TABLE public.coaches
ADD COLUMN IF NOT EXISTS specialty text;

-- Tuỳ chọn: Nếu muốn bắt buộc sđt ở mức Database (Lưu ý có thể lỗi nếu data cũ đang có HLV không có SĐT)
-- Để an toàn, hiện tại đã bắt buộc ở Frontend. Nếu data cũ đã đầy đủ SĐT, bạn có thể chạy lệnh dưới:
-- ALTER TABLE public.coaches ALTER COLUMN phone SET NOT NULL;
