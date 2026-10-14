-- ============================================================
-- 057_financial_pnl_system.sql
-- Hệ thống Quản lý Thu - Chi Kế Toán (Định phí, Biến phí, Thu khác)
-- & Báo cáo Kết quả Kinh doanh (P&L) — Dành riêng cho ADMIN
-- ============================================================

-- 1. BẢNG DANH MỤC THU - CHI (financial_categories)
CREATE TABLE IF NOT EXISTS public.financial_categories (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    type            VARCHAR(20) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    cost_type       VARCHAR(20) CHECK (
        (type = 'INCOME' AND cost_type IS NULL) OR
        (type = 'EXPENSE' AND cost_type IN ('FIXED', 'VARIABLE'))
    ),
    description     TEXT,
    sort_order      INTEGER NOT NULL DEFAULT 100,
    is_system       BOOLEAN NOT NULL DEFAULT false,
    is_active       BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.financial_categories IS 'Danh mục Thu khác, Chi phí cố định (FIXED) và Chi phí biến đổi (VARIABLE). Chỉ ADMIN quản lý.';

-- 2. BẢNG MẪU CHI PHÍ CỐ ĐỊNH HÀNG THÁNG (fixed_cost_templates)
CREATE TABLE IF NOT EXISTS public.fixed_cost_templates (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT NOT NULL,
    category_id             UUID REFERENCES public.financial_categories(id) ON DELETE SET NULL,
    default_amount          BIGINT NOT NULL DEFAULT 0 CHECK (default_amount >= 0),
    default_payment_method  VARCHAR(50) NOT NULL DEFAULT 'TRANSFER' CHECK (default_payment_method IN ('CASH', 'TRANSFER', 'TRANSFER_COMPANY', 'CARD')),
    day_of_month            INTEGER NOT NULL DEFAULT 1 CHECK (day_of_month >= 1 AND day_of_month <= 28),
    note                    TEXT,
    is_active               BOOLEAN NOT NULL DEFAULT true,
    created_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixed_cost_templates IS 'Danh sách mẫu các khoản chi phí cố định hàng tháng để áp dụng nhanh cho 1 tháng hoặc khoảng thời gian.';

-- 3. BẢNG GIAO DỊCH THU - CHI KẾ TOÁN (financial_transactions)
CREATE TABLE IF NOT EXISTS public.financial_transactions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    transaction_date        DATE NOT NULL DEFAULT CURRENT_DATE,
    accounting_month        VARCHAR(7) NOT NULL, -- Định dạng YYYY-MM
    type                    VARCHAR(20) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
    cost_type               VARCHAR(20) CHECK (
        (type = 'INCOME' AND cost_type IS NULL) OR
        (type = 'EXPENSE' AND cost_type IN ('FIXED', 'VARIABLE'))
    ),
    category_id             UUID REFERENCES public.financial_categories(id) ON DELETE SET NULL,
    category_name           TEXT NOT NULL,
    amount                  BIGINT NOT NULL CHECK (amount > 0),
    payment_method          VARCHAR(50) NOT NULL DEFAULT 'TRANSFER' CHECK (payment_method IN ('CASH', 'TRANSFER', 'TRANSFER_COMPANY', 'CARD')),
    fund_source             VARCHAR(30) NOT NULL DEFAULT 'COMPANY_FUND' CHECK (fund_source IN ('SHIFT_CASH', 'COMPANY_FUND')),
    description             TEXT NOT NULL DEFAULT '',
    template_id             UUID REFERENCES public.fixed_cost_templates(id) ON DELETE SET NULL,
    created_by              UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.financial_transactions IS 'Sổ bút toán Thu khác và Chi phí (Định phí / Biến phí), hỗ trợ chọn ngày quá khứ (transaction_date). Chỉ ADMIN thực hiện.';

CREATE INDEX IF NOT EXISTS idx_fin_tx_date ON public.financial_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_tx_month ON public.financial_transactions(accounting_month);
CREATE INDEX IF NOT EXISTS idx_fin_tx_type ON public.financial_transactions(type, cost_type);
CREATE INDEX IF NOT EXISTS idx_fin_tx_template_month ON public.financial_transactions(template_id, accounting_month);

-- Trigger tự động đồng bộ accounting_month từ transaction_date
CREATE OR REPLACE FUNCTION public.sync_financial_tx_month()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.accounting_month := to_char(NEW.transaction_date, 'YYYY-MM');
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_financial_tx_month ON public.financial_transactions;
CREATE TRIGGER trg_sync_financial_tx_month
    BEFORE INSERT OR UPDATE ON public.financial_transactions
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_financial_tx_month();

-- 4. BẢO MẬT RLS: CHỈ ADMIN MỚI CÓ QUYỀN TRUY CẬP VÀ THỰC HIỆN
ALTER TABLE public.financial_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fixed_cost_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fin_categories_admin_all" ON public.financial_categories;
CREATE POLICY "fin_categories_admin_all"
    ON public.financial_categories FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

DROP POLICY IF EXISTS "fixed_templates_admin_all" ON public.fixed_cost_templates;
CREATE POLICY "fixed_templates_admin_all"
    ON public.fixed_cost_templates FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

DROP POLICY IF EXISTS "fin_transactions_admin_all" ON public.financial_transactions;
CREATE POLICY "fin_transactions_admin_all"
    ON public.financial_transactions FOR ALL
    TO authenticated
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'))
    WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN'));

-- 5. KHỞI TẠO (SEED) DANH MỤC CHI PHÍ TỐI THIỂU & THU KHÁC GỢI Ý
INSERT INTO public.financial_categories (id, name, type, cost_type, description, sort_order, is_system)
VALUES
    -- ĐỊNH PHÍ (FIXED COSTS)
    ('11111111-0001-4000-8000-000000000001', 'Thuê mặt bằng / Khấu hao cơ sở hạ tầng', 'EXPENSE', 'FIXED', 'Tiền thuê đất, mặt bằng hoặc trích khấu hao xây dựng hồ bơi, mái che, hệ thống lọc', 10, true),
    ('11111111-0001-4000-8000-000000000002', 'Lương cơ bản nhân sự cố định', 'EXPENSE', 'FIXED', 'Lương cứng Quản lý, Lễ tân/Thu ngân, Soát vé, Cứu hộ, Bảo vệ, Tạp vụ', 20, true),
    ('11111111-0001-4000-8000-000000000003', 'BHXH, BHYT & Phúc lợi cố định', 'EXPENSE', 'FIXED', 'Chi phí bảo hiểm bắt buộc, phụ cấp ăn ca/đồng phục định kỳ hàng tháng', 30, true),
    ('11111111-0001-4000-8000-000000000004', 'Internet, Phần mềm & Viễn thông', 'EXPENSE', 'FIXED', 'Cước cáp quang, phần mềm quản lý, tên miền/máy chủ, điện thoại cố định', 40, true),
    ('11111111-0001-4000-8000-000000000005', 'Bảo trì định kỳ thiết bị & Hệ thống lọc', 'EXPENSE', 'FIXED', 'Chi phí bảo dưỡng định kỳ máy bơm tuần hoàn, bình lọc cát, máy gia nhiệt (Heat pump)', 50, true),

    -- BIẾN PHÍ (VARIABLE COSTS)
    ('22222222-0002-4000-8000-000000000001', 'Hóa chất xử lý nước hồ bơi', 'EXPENSE', 'VARIABLE', 'Chlorine (Clo), PAC lắng cặn, Soda nâng pH, Axit HCl, Đồng sunfat diệt rêu, thuốc thử nước', 110, true),
    ('22222222-0002-4000-8000-000000000002', 'Tiền Điện & Nước cấp hồ bơi', 'EXPENSE', 'VARIABLE', 'Điện vận hành bơm lọc, bơm nhiệt, chiếu sáng; Nước cấp bù bay hơi và sục rửa bình lọc', 120, true),
    ('22222222-0002-4000-8000-000000000003', 'Thù lao & Hoa hồng Huấn luyện viên (HLV)', 'EXPENSE', 'VARIABLE', 'Lương dạy bơi kèm, dạy nhóm, dạy bóng rổ và hoa hồng bán khóa học', 130, true),
    ('22222222-0002-4000-8000-000000000004', 'Lương nhân viên thời vụ / Tăng ca', 'EXPENSE', 'VARIABLE', 'Chi phí thuê cứu hộ, lễ tân part-time mùa cao điểm hoặc làm thêm giờ', 140, true),
    ('22222222-0002-4000-8000-000000000005', 'Giá vốn nhập hàng bán lẻ (POS)', 'EXPENSE', 'VARIABLE', 'Nhập nước giải khát, đồ ăn nhẹ, kính bơi, mũ bơi, phao bơi, đồ bơi', 150, true),
    ('22222222-0002-4000-8000-000000000006', 'Vật tư tiêu hao & Vệ sinh', 'EXPENSE', 'VARIABLE', 'Giấy in hóa đơn nhiệt, phôi thẻ từ RFID/QR, nước lau sàn, xà phòng, giấy vệ sinh', 160, true),
    ('22222222-0002-4000-8000-000000000007', 'Sửa chữa thiết bị phát sinh', 'EXPENSE', 'VARIABLE', 'Thay thế linh kiện hỏng đột xuất (vòi sen, đèn hồ, cổng xoay Tripod, đầu đọc thẻ...)', 170, true),
    ('22222222-0002-4000-8000-000000000008', 'Marketing, Quảng cáo & Sự kiện', 'EXPENSE', 'VARIABLE', 'Quảng cáo Facebook/Zalo, in ấn băng rôn chiêu sinh, tổ chức giải bơi', 180, true),
    ('22222222-0002-4000-8000-000000000009', 'Chi phí vận hành phát sinh khác', 'EXPENSE', 'VARIABLE', 'Tiếp khách, phí ngân hàng/POS, chi phí hành chính đột xuất khác', 190, true),

    -- THU KHÁC (OTHER INCOME)
    ('33333333-0003-4000-8000-000000000001', 'Cho thuê làn bơi / Thuê hồ tổ chức giải', 'INCOME', NULL, 'Cho trường học, CLB, công ty thuê làn bơi tập luyện hoặc tổ chức thi đấu', 210, true),
    ('33333333-0003-4000-8000-000000000002', 'Thu phí dịch vụ phụ trợ (Thẻ từ, Tủ đồ, Khăn...)', 'INCOME', NULL, 'Phí cấp lại thẻ từ bị mất/hỏng, phí thuê tủ khóa (locker), thuê đồ bơi/khăn tắm', 220, true),
    ('33333333-0003-4000-8000-000000000003', 'Thu tài trợ, Quảng cáo & Hợp tác', 'INCOME', NULL, 'Thu tiền đặt biển quảng cáo tại hồ bơi, tài trợ giải đấu, hoa hồng đối tác', 230, true),
    ('33333333-0003-4000-8000-000000000004', 'Thu thanh lý & Thu nhập khác', 'INCOME', NULL, 'Thanh lý thiết bị cũ, phế liệu, tiền đền bù hư hỏng tài sản, lãi tiền gửi', 240, true)
ON CONFLICT (id) DO NOTHING;

-- 6. KHỞI TẠO MẪU ĐỊNH PHÍ HÀNG THÁNG CƠ BẢN (MẶC ĐỊNH = 0 ĐỂ ADMIN ĐIỀN SỐ TIỀN)
INSERT INTO public.fixed_cost_templates (id, name, category_id, default_amount, default_payment_method, day_of_month, note, is_active)
VALUES
    ('44444444-0004-4000-8000-000000000001', 'Tiền thuê mặt bằng / Khấu hao cơ sở hàng tháng', '11111111-0001-4000-8000-000000000001', 0, 'TRANSFER_COMPANY', 1, 'Chi phí mặt bằng hoặc trích khấu hao cố định hàng tháng', true),
    ('44444444-0004-4000-8000-000000000002', 'Lương cơ bản bộ phận Quản lý, Lễ tân, Cứu hộ, Vệ sinh', '11111111-0001-4000-8000-000000000002', 0, 'TRANSFER_COMPANY', 5, 'Quỹ lương cứng nhân viên cố định hàng tháng', true),
    ('44444444-0004-4000-8000-000000000003', 'Chi phí BHXH & Phụ cấp cố định nhân sự', '11111111-0001-4000-8000-000000000003', 0, 'TRANSFER_COMPANY', 5, 'Đóng BHXH và phụ cấp cố định hàng tháng', true),
    ('44444444-0004-4000-8000-000000000004', 'Cước Internet cáp quang & Phần mềm quản lý', '11111111-0001-4000-8000-000000000004', 0, 'TRANSFER', 10, 'Cước viễn thông, phần mềm định kỳ', true),
    ('44444444-0004-4000-8000-000000000005', 'Chi phí bảo trì định kỳ hệ thống lọc & bơm nhiệt', '11111111-0001-4000-8000-000000000005', 0, 'TRANSFER', 15, 'Khoán bảo dưỡng hệ thống kỹ thuật hàng tháng', true)
ON CONFLICT (id) DO NOTHING;
