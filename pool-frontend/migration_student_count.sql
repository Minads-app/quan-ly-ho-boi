-- Migration: Thêm cột student_count vào bảng ticket_types
-- Chạy SQL này trên Supabase Dashboard > SQL Editor

-- Bước 1: Thêm cột student_count
ALTER TABLE ticket_types ADD COLUMN IF NOT EXISTS student_count INTEGER DEFAULT NULL;

-- Bước 2: Cập nhật dữ liệu cũ cho tương thích ngược
UPDATE ticket_types SET student_count = 1 WHERE lesson_class_type = 'ONE_ON_ONE' AND student_count IS NULL;
UPDATE ticket_types SET student_count = 2 WHERE lesson_class_type = 'ONE_ON_TWO' AND student_count IS NULL;
UPDATE ticket_types SET student_count = 0 WHERE lesson_class_type = 'GROUP' AND student_count IS NULL;
