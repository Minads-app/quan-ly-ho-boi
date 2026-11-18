# 🔍 BÁO CÁO KIỂM TOÁN MÃ NGUỒN TOÀN DIỆN (COMPREHENSIVE AUDIT REPORT)

**Dự án:** Hệ Thống Quản Lý Vé Bơi & Bán Hàng (Pool Ticket & POS Management System)  
**Ngày kiểm toán:** 05/11/2026  
**Vai trò thực hiện:** Senior QA Automation · System Architect · Business Analyst  
**Chế độ:** `READ-ONLY AUDIT` (Tuyệt đối không chỉnh sửa mã nguồn hay dữ liệu)  
**Phạm vi kiểm toán:**
- **Frontend (`pool-frontend`):** Toàn bộ 14 Pages, 3 Components, Contexts, Utils, Types (`React 19` + `TypeScript` + `Vite`).
- **Backend / Database (`supabase/migrations` & SQL scripts):** Toàn bộ 58 file migrations (`000` → `057`) + `migration_coach.sql`, `migration_bulk_extend.sql` (PostgreSQL Functions/RPCs, Triggers, Views, RLS Policies).
- **Hardware Agent (`pool-gate-agent`):** Dịch vụ Node.js kết nối cổng kiểm soát qua `SerialPort` & `Supabase Realtime`.

---

## 📊 TỔNG KẾT NHANH (EXECUTIVE SUMMARY)

| Mức độ nghiêm trọng | Số lượng phát hiện | Tỷ lệ | Ý nghĩa |
| :--- | :---: | :---: | :--- |
| 🔴 **Critical** | **12** | 19.4% | Lỗi gây crash trang/build, sai lệch tiền bạc/doanh thu, mất dữ liệu khách hàng hoặc lỗ hổng bảo mật RLS nghiêm trọng. Cần khắc phục ngay lập tức. |
| 🟠 **High** | **19** | 30.6% | Lỗi logic nghiệp vụ quan trọng, thiếu Transaction gây dữ liệu rác, sai lệch báo cáo quỹ/lương HLV, race condition. |
| 🟡 **Medium** | **19** | 30.6% | Lỗi UI/UX edge cases, bất đồng bộ trạng thái FE-BE, lỗi múi giờ (UTC vs UTC+7), hiệu năng truy vấn (N+1 / unpaginated). |
| 🔵 **Low** | **12** | 19.4% | Code trùng lặp, thiếu dọn dẹp state, cảnh báo DOM/linter, thiếu tiện ích vận hành phụ trợ. |
| **TỔNG CỘNG** | **62** | **100%** | |

---

## HẠNG MỤC 1: KIỂM TRA LUỒNG THAO TÁC NGƯỜI DÙNG (User Flow & UI/UX Edge Cases)

---

### 1.1 🔴 [Critical] Không có cơ chế khóa đồng bộ chống Double-Submit khi Thanh toán (`doCheckoutOrder`) và Check-in (`doCheckin`)
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L702-L881) — hàm `doCheckoutOrder()`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L1151-L1263) — hàm `doCheckin()`
- **Mô tả chi tiết:**
  - Trong `doCheckoutOrder()`, biến `selling` là React state (`useState(false)`), được kiểm tra ở đầu hàm? Không! Đầu hàm `doCheckoutOrder()` chỉ kiểm tra `if (cart.length === 0) return;` và gọi `setSelling(true)` (cập nhật bất đồng bộ ở chu kỳ render tiếp theo).
  - Nếu thu ngân bấm đúp chuột vào nút **"Thanh toán"** (hoặc bấm phím tắt `F9` / click nhanh 2 lần trước khi React kịp re-render disable nút), `doCheckoutOrder()` sẽ chạy song song 2 lần với cùng `cart`: gọi RPC `create_checkout_order` 2 lần → **tạo 2 đơn hàng trùng lặp**, trừ tồn kho sản phẩm 2 lần, trừ lượt voucher 2 lần và mở chồng modal in vé.
  - Tương tự ở `doCheckin()`, mặc dù có `if (checkinLoading) return;` ở dòng 1152, nhưng vì `checkinLoading` là React state nên 2 sự kiện quét thẻ RFID hoặc click nhanh trong cùng 1 event loop tick đều thấy `checkinLoading === false`, dẫn đến gọi RPC `checkin_pass_and_issue_ticket` 2 lần và **trừ 2 buổi bơi của khách trong cùng 1 lần quét**.
- **Hướng xử lý đề xuất:**
  - Sử dụng `useRef<boolean>(false)` (`isCheckingOutRef`, `isCheckingInRef`) để khóa đồng bộ tức thì (`if (isCheckingOutRef.current) return; isCheckingOutRef.current = true;`) trước khi gọi `await`, và nhả khóa trong khối `finally`.
  - Ở tầng Backend RPC `create_checkout_order`, bổ sung tham số `p_idempotency_key UUID` để chặn trùng lặp tuyệt đối ở cấp Database.

---

### 1.2 🔴 [Critical] Lỗ hổng bảo mật RLS (Row-Level Security): Chính sách `USING (true)` cho phép mọi tài khoản sửa/xóa dữ liệu nhạy cảm
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [migration_coach.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/migration_coach.sql#L25-L38) — bảng `coaches`
  - [migration_coach.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/migration_coach.sql#L63-L76) — bảng `coach_attendances`
  - [056_checkin_logs.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/056_checkin_logs.sql#L41-L43) — bảng `checkin_logs`
  - [migration_bulk_extend.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/migration_bulk_extend.sql#L1-L23) — bảng `bulk_extensions` và `ticket_extension_logs`
- **Mô tả chi tiết:**
  - Trong `migration_coach.sql`, các policy mặc dù được đặt tên là `coaches_insert_admin`, `coaches_update_admin`, `coaches_delete_admin` và `coach_attendances_*`, nhưng nội dung thực tế lại là `FOR INSERT WITH CHECK (true)`, `FOR UPDATE USING (true)`, `FOR DELETE USING (true)` và **không hề giới hạn `TO authenticated` hay kiểm tra role `ADMIN`**.
  - Trong `056_checkin_logs.sql` (dòng 41-43), policy `"Admin can update checkin logs"` cũng viết `FOR UPDATE USING (true)`.
  - Trong `migration_bulk_extend.sql`, hai bảng `bulk_extensions` và `ticket_extension_logs` hoàn toàn **không bật `ENABLE ROW LEVEL SECURITY`**.
  - Vì `VITE_SUPABASE_ANON_KEY` nằm công khai ở Frontend bundle, bất kỳ người dùng nào (kể cả nhân viên cấp thấp hoặc người ngoài lấy được anon key) đều có thể gọi trực tiếp Supabase REST API để tự ý thay đổi tỷ lệ hoa hồng HLV (`commission_rate`), xóa lịch sử điểm danh HLV, hoặc sửa trạng thái `checkin_logs` thành `CANCELLED` để gian lận.
- **Hướng xử lý đề xuất:**
  - Thay thế toàn bộ `USING (true)` / `WITH CHECK (true)` trên các thao tác ghi/sửa/xóa quản trị bằng kiểm tra role thực sự: `EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'ADMIN')`.
  - Bật `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` cho `bulk_extensions` và `ticket_extension_logs`.

---

### 1.3 🔴 [Critical] Mua gói Học bơi Kèm riêng 1-N (`student_count >= 3`) thu tiền đủ N học viên nhưng làm mất dữ liệu từ học viên thứ 3 trở đi
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L964-L1009) — hàm `calculateAdvancedPrice()` & `handleAdvancedSubmit()`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L770-L772) — hàm `doCheckoutOrder()`
  - [046_fix_checkout_customer_id.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/046_fix_checkout_customer_id.sql#L135-L161) — RPC `create_checkout_order`
  - [054_smart_multi_package_checkin.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/054_smart_multi_package_checkin.sql#L288-L306) — RPC `checkin_pass_and_issue_ticket`
- **Mô tả chi tiết:**
  - Giao diện POS cho phép bán vé học bơi `PRIVATE` với số lượng học viên `advStudentCount` từ 1 đến N (ví dụ 1 kèm 3, 1 kèm 4). Form bắt buộc nhập đầy đủ Họ tên và Năm sinh cho tất cả học viên phụ trong mảng `extraStudents` (dòng 943-948), và hàm `calculateAdvancedPrice` nhân giá tiền theo đúng `advStudentCount` (`basePrice = unitPrice * advStudentCount * sess`).
  - Thế nhưng khi thêm vào giỏ hàng (dòng 1006-1007) và khi thanh toán ở `doCheckoutOrder()` (dòng 770-771), code **chỉ lấy duy nhất phần tử đầu tiên `extraStudents[0]`** để truyền vào `customer_name_2` và `customer_birth_year_2`. Toàn bộ thông tin của học viên thứ 3, thứ 4... bị vứt bỏ hoàn toàn mà không lưu vào Database!
  - Nghiêm trọng hơn, khi khách đến bơi và quét thẻ check-in (`054_smart_multi_package_checkin.sql` dòng 288), hàm `checkin_pass_and_issue_ticket` chỉ kiểm tra `IF v_ticket.lesson_class_type = 'ONE_ON_TWO'` để in vé qua cổng thứ 2. Nếu gói là `PRIVATE` với 2, 3 hay 4 học viên (`lesson_class_type = 'PRIVATE'`), hệ thống **chỉ in ra 1 vé qua cổng duy nhất**, khiến các học viên còn lại không thể qua cổng kiểm soát!
- **Hướng xử lý đề xuất:**
  - Lưu danh sách học viên phụ dưới dạng mảng JSONB `extra_students` trên bảng `tickets` (hoặc bảng phụ `ticket_students`), hoặc tách thành các thẻ/gói học viên liên kết.
  - Trong RPC `checkin_pass_and_issue_ticket`, sửa điều kiện phát hành vé phụ dựa trên số lượng học viên đi học thực tế (cho cả `ONE_ON_TWO` và `PRIVATE` có `student_count > 1`).

---

### 1.4 🟠 [High] Hệ thống phân quyền (RBAC) thiếu đồng bộ giữa Sidebar, Route Guard và `PermissionsMatrix`
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [App.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/App.tsx#L81-L96) — hàm `canView()`
  - [App.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/App.tsx#L128-L220) — Sidebar Navigation & `<Routes>` (dòng 268-308)
  - [StaffPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/StaffPage.tsx#L28-L35) — `DEFAULT_PERMISSIONS`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L291) — kiểm tra quyền xem mã thẻ
- **Mô tả chi tiết:**
  1. Hệ thống tồn tại **3 cơ chế phân quyền rời rạc**:
     - `canView(module)` dựa trên JSON `profile.permissions` (cho `pos`, `gate`, `customers`, `reports`, `staff`, `settings`).
     - Các cột boolean rời rạc `profile.can_manage_inventory`, `profile.can_create_expense` (cho `/inventory`, `/cash`).
     - Kiểm tra cứng `profile.role === 'ADMIN'` (cho `/orders`, `/coaches`, `/coach-payroll`, `/analytics`).
  2. **Mâu thuẫn quyền Sửa/Xóa trên `CustomerPage`:** Trong `StaffPage.tsx`, Admin cấu hình chi tiết quyền `customers: { view, create, edit, delete }` cho từng nhân viên. Tuy nhiên trong `CustomerPage.tsx` (dòng 162: `const isAdmin = profile?.role === 'ADMIN'`), toàn bộ nút Sửa gói, Đổi thẻ, Xóa gói, Gia hạn đều kiểm tra cứng `if (!isAdmin)` thay vì kiểm tra `profile.permissions.customers.edit` / `delete`! Kết quả là dù Admin có bật quyền `edit`/`delete` khách hàng cho nhân viên trong trang Nhân Sự, nhân viên đó vẫn không thể thao tác được.
  3. **Mâu thuẫn hiển thị mã thẻ:** Ở `CustomerPage.tsx` (dòng 291), hàm `maskCardCode(code, role)` chỉ cho phép `role === 'ADMIN'` xem trọn vẹn mã thẻ, trong khi ở `POSPage.tsx` (dòng 2005, 2248), code truyền `maskCardCode(code, 'ADMIN')` (hardcode chuỗi `'ADMIN'`) ở một số chỗ khiến mọi role đều thấy full mã thẻ ở modal POS nhưng bị che ở trang Khách hàng.
- **Hướng xử lý đề xuất:**
  - Hợp nhất toàn bộ phân quyền về một helper duy nhất `hasPermission(profile, module, action)` trong `AuthContext`.
  - Áp dụng `hasPermission(profile, 'customers', 'edit')` và `hasPermission(profile, 'customers', 'delete')` trong `CustomerPage.tsx` thay vì chỉ check `isAdmin`.

---

### 1.5 🟠 [High] Tạo nhân viên mới (`handleCreateStaff`) dùng `setTimeout(800ms)` gây Race Condition mất quyền Role và thiếu hồ sơ HLV (`coaches`)
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [StaffPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/StaffPage.tsx#L94-L110) — hàm `handleRoleChange()`
  - [StaffPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/StaffPage.tsx#L167-L227) — hàm `handleCreateStaff()`
- **Mô tả chi tiết:**
  - Khi tạo tài khoản nhân viên mới trong `handleCreateStaff()`, Frontend tạo một client phụ `tempSupabase` để gọi `auth.signUp()`, sau đó chờ cứng `await new Promise(r => setTimeout(r, 800))` với hy vọng Database Trigger `on_auth_user_created` đã chạy xong, rồi mới gọi `supabase.from('profiles').update({ role: newRole, ... })`.
  - Nếu mạng hoặc DB phản hồi chậm hơn `800ms`, lệnh `UPDATE profiles` sẽ cập nhật `0 rows` mà không báo lỗi (`error` vẫn là `null`), khiến tài khoản vừa tạo bị kẹt ở role mặc định (`STAFF` hoặc `CASHIER`) thay vì `ADMIN` hay `COACH`.
  - Ngoài ra, nếu Admin tạo nhân viên với role ban đầu là `STAFF`, sau đó dùng dropdown trên bảng (`handleRoleChange` dòng 94-110) để đổi role sang `COACH`, hàm `handleRoleChange` chỉ update bảng `profiles` mà **không tạo bản ghi tương ứng trong bảng `coaches`** (khác với `handleCreateStaff` dòng 205-212). Hệ quả là HLV đó không xuất hiện trong danh sách HLV ở `CoachManagementPage` và khi đăng nhập vào `CoachDashboardPage` sẽ báo lỗi *"Không tìm thấy hồ sơ Huấn luyện viên"*.
- **Hướng xử lý đề xuất:**
  - Truyền `role`, `full_name`, `phone` ngay trong `options.data` (`raw_user_meta_data`) của `auth.signUp()` và để Trigger `handle_new_user()` trong PostgreSQL tự động gán đúng role & tạo bản ghi `coaches` trong cùng 1 transaction.
  - Trong `handleRoleChange`, khi đổi role sang `COACH`, thực hiện `upsert` vào bảng `coaches`.

---

### 1.6 🟠 [High] Chức năng Đổi mật khẩu cá nhân bị giới hạn chỉ cho `ADMIN` và giữ lại mật khẩu cũ trong state khi đóng Modal
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** [App.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/App.tsx#L227-L235) và [App.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/App.tsx#L343-L348)
- **Mô tả chi tiết:**
  - Nút `"🔑 Đổi mật khẩu"` ở góc dưới Sidebar được bọc trong điều kiện `{profile.role === 'ADMIN' && (...)}`. Tất cả các vai trò khác (`CASHIER`, `STAFF`, `GATE_KEEPER`, `COACH`) hoàn toàn không có nút đổi mật khẩu cá nhân.
  - Khi bấm nút `"Hủy"` trong modal đổi mật khẩu (dòng 345), code chỉ gọi `setShowPasswordModal(false)` mà không gọi `setNewPassword('')`, khiến chuỗi mật khẩu đang gõ dở vẫn lưu nguyên trong bộ nhớ state khi mở lại modal.
- **Hướng xử lý đề xuất:**
  - Cho phép mọi tài khoản đã đăng nhập đều thấy nút `"🔑 Đổi mật khẩu"` của chính mình, và reset `setNewPassword('')` khi đóng modal.

---

### 1.7 🟠 [High] Trang Kiểm soát cổng (`GateCheckPage`) luôn gửi cứng `p_direction: 'IN'`, không hỗ trợ quét chiều RA (`OUT`)
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** [GateCheckPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/GateCheckPage.tsx#L121-L124) — hàm `handleCheck()`
- **Mô tả chi tiết:**
  - Mặc dù RPC `check_qr_ticket_text` ở Database đã được thiết kế để xử lý cả chiều VÀO (`IN`) và chiều RA (`OUT`), nhưng `GateCheckPage.tsx` luôn truyền cứng `p_direction: 'IN'`.
  - Khi khách dùng vé lượt (`DAILY`) đã quét vào (`status = 'IN_POOL'`) và muốn quét QR trên trình duyệt/máy tính bảng để ra về, hệ thống lại coi đó là quét VÀO lần 2 và báo lỗi `"Vé đang ở trong hồ rồi!"`, không cho khách ra.
- **Hướng xử lý đề xuất:**
  - Thêm nút chuyển đổi chế độ **Cổng VÀO (`IN`) / Cổng RA (`OUT`)** trên giao diện `GateCheckPage.tsx` (hoặc tự động đảo chiều nếu phát hiện vé đang ở trạng thái `IN_POOL`).

---

### 1.8 🟠 [High] Xóa Gói thẻ hoặc Khách hàng thất bại hoặc để lại dữ liệu mồ côi do bảng mới `checkin_logs` và `orders`
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L538-L556) — hàm `handleDeletePackage()`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L597-L616) — hàm `handleDeleteCustomer()`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L1127-L1142) — nút `"Xóa đã chọn"` (Bulk Delete Packages)
  - [056_checkin_logs.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/056_checkin_logs.sql#L7-L8)
- **Mô tả chi tiết:**
  - Trong `056_checkin_logs.sql`, hai cột `source_ticket_id UUID REFERENCES public.tickets(id)` và `gate_ticket_id UUID REFERENCES public.tickets(id)` được khai báo khóa ngoại mặc định (`ON DELETE NO ACTION`).
  - Trong `handleDeletePackage()` và Bulk Delete trên `CustomerPage.tsx`, code chỉ xóa `scan_logs` trước khi xóa `tickets`, mà **không xóa `checkin_logs`**. Nếu gói thẻ đã từng check-in ít nhất 1 lần sau migration 056, lệnh xóa gói thẻ sẽ lập tức bị PostgreSQL chặn bởi lỗi vi phạm khóa ngoại (`foreign key constraint "checkin_logs_source_ticket_id_fkey"`).
  - Trong `handleDeleteCustomer()` (dòng 602-606), code chỉ xóa `customers` mà không kiểm tra `checkin_logs` (`customer_id REFERENCES public.customers(id)` cũng không có `ON DELETE CASCADE`), khiến bất kỳ khách hàng nào đã từng check-in đều **không thể xóa được** và báo lỗi DB thô.
- **Hướng xử lý đề xuất:**
  - Bổ sung `ON DELETE SET NULL` hoặc `ON DELETE CASCADE` cho các khóa ngoại trên bảng `checkin_logs`, hoặc thực hiện xóa qua một RPC Backend có kiểm tra ràng buộc và đồng bộ lại đơn hàng.

---

### 1.9 🟡 [Medium] Trang Sổ Quỹ (`CashPage`) không có chức năng Sửa hoặc Hủy/Xóa phiếu chi khi nhập sai
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [CashPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CashPage.tsx#L108-L140) — hàm `handleSaveExpense()` và bảng danh sách phiếu chi (dòng 245-305)
- **Mô tả chi tiết:**
  - Khi thu ngân hoặc Admin lập phiếu chi tiền mặt trong ngày nhưng gõ nhầm số tiền (ví dụ `500,000đ` thành `5,000,000đ`) hoặc nhầm lý do, giao diện hoàn toàn không có nút Sửa hoặc Hủy phiếu chi đó.
- **Hướng xử lý đề xuất:**
  - Cho phép Admin (hoặc người tạo trong cùng ca làm việc) hủy/sửa phiếu chi kèm ghi chú lý do hủy.

---

### 1.10 🟡 [Medium] Nhiều API khởi tạo trên `POSPage` không bắt lỗi (`try/catch`), nuốt lỗi âm thầm khi mất mạng cục bộ
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L276-L321) — `fetchTicketTypes`, `fetchPromotions`, `fetchProducts`, `fetchCoaches`, `fetchBusinessInfo`
- **Mô tả chi tiết:**
  - Khi mở trang POS, 6 hàm fetch chạy bất đồng bộ nhưng không kiểm tra `error` trả về từ Supabase. Nếu `fetchPromotions()` hoặc `fetchProducts()` gặp lỗi mạng chập chờn, mảng `promotions` / `products` sẽ rỗng mà thu ngân không nhận được bất kỳ cảnh báo nào, dẫn đến bán vé thiếu khuyến mãi tự động (`auto_apply`).
- **Hướng xử lý đề xuất:**
  - Kiểm tra đối tượng `error` trong mọi lệnh gọi Supabase và hiển thị `toast.error` kèm nút thử lại khi tải dữ liệu danh mục thất bại.

---

### 1.11 🟡 [Medium] Nhấn phím tắt `F6`–`F10` trên `POSPage` khi chưa cấu hình khách hàng không có phản hồi UI
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L258-L269)
- **Mô tả chi tiết:**
  - Khi thu ngân nhấn phím `F6` đến `F10`, nếu chưa có khách hàng nào được gán phím tắt đó (`!cust`), sự kiện bị chặn (`e.preventDefault()`) nhưng không hiển thị thông báo gì, khiến thu ngân tưởng bàn phím hoặc ứng dụng bị treo.
- **Hướng xử lý đề xuất:**
  - Hiển thị `toast.info(\`Chưa có khách hàng nào được gán phím tắt \${e.key}\`)`.

---

### 1.12 🔵 [Low] Lỗi lồng thẻ `<tbody>` bên trong `<tbody>` không hợp lệ và ẩn dòng sản phẩm biến thể trong `InventoryPage`
- **Mức độ nghiêm trọng:** **Low**
- **Vị trí:** [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx#L1259-L1304)
- **Mô tả chi tiết:**
  - Ở tab Danh mục sản phẩm (dòng 1259), bên trong thẻ `<tbody>` chính, khi gặp sản phẩm cha có biến thể (`isParentWithVariants`), code lại trả về một thẻ `<tbody key={parent.id}>` lồng bên trong `<tbody>` (dòng 1269).
  - Việc lồng `<tbody>` trong `<tbody>` là vi phạm chuẩn HTML DOM (gây lỗi cảnh báo React `validateDOMNesting`), và tệ hơn là khối `<tbody key={parent.id}>` này chỉ render dòng sản phẩm cha mà **quên không lặp qua mảng `variants` để render các dòng biến thể con bên dưới**! Do đó các biến thể sản phẩm bị biến mất khỏi bảng danh mục ở nhánh render này.
- **Hướng xử lý đề xuất:**
  - Thay `<tbody key={parent.id}>` bằng `<React.Fragment key={parent.id}>` và render đầy đủ các dòng `<tr>` của `variants` ngay bên dưới dòng `parent`.

---

## HẠNG MỤC 2: PHÁT HIỆN NGHIỆP VỤ TRÙNG LẶP & MÂU THUẪN LOGIC (Redundant & Conflicting Logic)

---

### 2.1 🔴 [Critical] Khuyến mãi tự động hoặc thủ công dạng Giảm tiền (`AMOUNT`) / Giảm phần trăm (`PERCENT`) KHÔNG được trừ vào giá bán vé Gói/Học bơi!
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L958-L989) — hàm `calculateAdvancedPrice()`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L738-L757) — hàm `doCheckoutOrder()`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L2488-L2517) — giao diện hiển thị `autoAppliedPromo`
- **Mô tả chi tiết:**
  - Đây là một mâu thuẫn logic nghiêm trọng giữa hàm tính giá lúc thêm vào giỏ và hàm thanh toán:
    1. Trong `calculateAdvancedPrice()` (dòng 958-989), hàm tính `basePrice` xong **chỉ trừ tiền giảm giá của `validatedVoucher`** (dòng 971-978), hoàn toàn **KHÔNG tính giảm giá cho `autoAppliedPromo` hay `selectedPromoId`**!
    2. Thế nhưng ở giao diện Modal (dòng 2488-2517), hệ thống vẫn hiển thị banner màu xanh: *"🎉 Khuyến mãi tự động áp dụng: Giảm X% / Giảm Xđ"*.
    3. Đến khi thanh toán trong `doCheckoutOrder()` (dòng 745 & 755), lập trình viên lại viết dòng chú thích:
       `// AMOUNT & PERCENT đã được tính trong calculateAdvancedPrice() → không tính lại`
       và chỉ xử lý mỗi `BONUS_SESSION` / `BONUS_DAYS`!
  - **Hậu quả:** Mọi chương trình khuyến mãi (`promotions`) có loại là `AMOUNT` (Giảm tiền) hoặc `PERCENT` (Giảm %) khi áp dụng cho vé Tháng / Nhiều buổi / Học bơi đều **không hề được trừ một đồng nào vào giá bán**, dù trên màn hình và hóa đơn vẫn ghi nhận tên chương trình khuyến mãi!
  - Ngược lại, nếu vừa có `promoId` vừa có `autoPromoId` cùng thuộc loại `BONUS_SESSION` (dòng 741 và 751), `doCheckoutOrder()` lại cộng dồn `bonusSessions` **2 lần**.
- **Hướng xử lý đề xuất:**
  - Viết một hàm tính giá tập trung duy nhất và đưa logic áp dụng `autoAppliedPromo` / `selectedPromoId` kiểu `AMOUNT` và `PERCENT` vào ngay trong `calculateAdvancedPrice()` trước khi áp dụng `validatedVoucher`.

---

### 2.2 🔴 [Critical] Mâu thuẫn giữa Hủy vé (`cancel_ticket` - Migration 050) và Nhật ký Check-in (`checkin_logs` - Migration 056) & Vé không in qua cổng
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [050_ticket_cancellation.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/050_ticket_cancellation.sql#L33-L116) — RPC `cancel_ticket`
  - [054_smart_multi_package_checkin.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/054_smart_multi_package_checkin.sql#L261-L320) — RPC `checkin_pass_and_issue_ticket`
  - [056_checkin_logs.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/056_checkin_logs.sql#L46-L70) — View `coach_checkin_summary`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L1351-L1392) — hàm `fetchCheckinHistory()`
- **Mô tả chi tiết:**
  1. **Không cập nhật `checkin_logs` khi hủy vé:** Khi Admin hủy một lượt check-in qua RPC `cancel_ticket(p_ticket_id, p_reason)`, hàm này chỉ cập nhật `tickets.status = 'CANCELLED'` mà **không cập nhật `checkin_logs.status = 'CANCELLED'`**.
     - Hệ quả 1: Trên tab "Lịch sử Check-in" của `POSPage` (đọc từ `checkin_logs`), lượt check-in đã hủy vẫn hiện là thành công.
     - Hệ quả 2: View tính lương HLV `coach_checkin_summary` (trong `056_checkin_logs.sql` dòng 63: `WHERE cl.status != 'CANCELLED'`) vẫn tính buổi học đã bị hủy đó vào lương cho Huấn luyện viên!
  2. **Tìm gói cha bằng `customer_phone` gây hoàn nhầm buổi:** Trong `cancel_ticket()` (dòng 72-80), để hoàn lại 1 buổi (`remaining_sessions + 1`) khi hủy vé lượt 0đ sinh ra từ thẻ, hàm tìm gói cha bằng `WHERE t.customer_phone = v_ticket_record.customer_phone ... LIMIT 1`. Nếu khách hàng có 2 gói (ví dụ 1 gói Bơi tự do 30 buổi và 1 gói Học bơi 10 buổi, hoặc 2 con dùng chung SĐT bố mẹ), hệ thống sẽ **cộng trả buổi vào nhầm gói**! Trong khi bảng `checkin_logs` đã có sẵn cột `source_ticket_id` và `gate_ticket_id` chính xác.
  3. **Gói có `requires_gate_ticket = false` không tạo vé cổng nên không thể hủy lượt check-in:** Trong `054_smart_multi_package_checkin.sql` (dòng 261), nếu loại vé cấu hình `requires_gate_ticket = false` (ví dụ vé Bóng rổ hoặc Học bơi không qua cổng), hệ thống chỉ trừ `remaining_sessions` và ghi `checkin_logs` chứ không tạo dòng nào trong `tickets` (`v_new_ticket_id = NULL`). Do đó Admin không có `ticket_id` nào để gọi `cancel_ticket` hoàn lại buổi nếu thu ngân bấm check-in nhầm!
- **Hướng xử lý đề xuất:**
  - Cập nhật RPC `cancel_ticket` (hoặc tạo RPC `cancel_checkin_log(p_log_id, p_reason)`) sử dụng trực tiếp `checkin_logs.source_ticket_id` để hoàn trả đúng số buổi (`deduct_count`) cho đúng gói cha, đồng thời cập nhật `checkin_logs.status = 'CANCELLED'` và hủy cả vé phụ thứ 2 (nếu là gói 1 kèm 2).

---

### 2.3 🔴 [Critical] Hàm `validate_and_scan` (Migration 050) ghi đè logic cũ nhưng bỏ sót category `MULTI` và `LESSON`
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:** [050_ticket_cancellation.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/050_ticket_cancellation.sql#L119-L290) — RPC `validate_and_scan`
- **Mô tả chi tiết:**
  - Hệ thống có 2 RPC kiểm tra vé tại cổng: `validate_and_scan` và `check_qr_ticket_text`.
  - Khi `050_ticket_cancellation.sql` định nghĩa lại `validate_and_scan`, hàm này chỉ viết nhánh `IF v_category = 'DAILY'` và `ELSIF v_category = 'MONTHLY'`. Nếu vé thuộc category `MULTI` hoặc `LESSON`, cả `v_fail_reason` và `v_new_status` đều giữ giá trị `NULL`, dẫn đến câu lệnh `UPDATE public.tickets SET status = v_new_status` (dòng 260) cập nhật `status` của gói thẻ thành `NULL`!
- **Hướng xử lý đề xuất:**
  - Xóa bỏ RPC `validate_and_scan` dư thừa (chuyển toàn bộ sang dùng `check_qr_ticket_text`), hoặc đồng bộ đầy đủ nhánh xử lý `MULTI` và `LESSON` vào `validate_and_scan`.

---

### 2.4 🟠 [High] Sai lệch nghiêm trọng công thức tính "Tồn quỹ tiền mặt" tại `CashPage` so với `DashboardPage` và `OrdersPage`
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [CashPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CashPage.tsx#L60-L68) — hàm `fetchCashData()`
- **Mô tả chi tiết:**
  - Trong `CashPage.tsx` (dòng 60), chú thích ghi: `// 2. Fetch Tickets Revenue (Thu) for today (Cash only)`. Nhưng câu truy vấn thực tế là:
    ```ts
    const { data: ticketsData } = await supabase
      .from('tickets')
      .select('price_paid')
      .gte('created_at', startOfDay.toISOString())
      .lte('created_at', endOfDay.toISOString());
    ```
  - Câu truy vấn này mắc **3 lỗi nghiệp vụ lớn**:
    1. **Không lọc `payment_method = 'CASH'`:** Nó cộng gộp cả tiền Chuyển khoản (`TRANSFER`), Chuyển khoản công ty (`TRANSFER_COMPANY`) và Quẹt thẻ (`CARD`) vào "Tồn quỹ tiền mặt"!
    2. **Không loại trừ vé đã hủy (`status != 'CANCELLED'`):** Vé đã hủy vẫn được cộng vào tổng thu tiền mặt.
    3. **Bỏ sót doanh thu Bán lẻ sản phẩm (`order_items` loại `PRODUCT`):** Khi khách mua kính bơi, nước uống, quần áo bằng tiền mặt, doanh thu nằm ở bảng `orders` / `order_items` chứ không sinh ra dòng nào trong bảng `tickets`. Do đó tiền mặt bán hàng hóa bị bỏ sót hoàn toàn khỏi Sổ quỹ ca!
- **Hướng xử lý đề xuất:**
  - Tính tổng thu tiền mặt trong ca từ bảng `orders` (với `payment_method = 'CASH'` và `status = 'COMPLETED'`), trừ đi các vé đã hủy, hoặc truy vấn kết hợp `tickets` (`payment_method = 'CASH'`, `status != 'CANCELLED'`) + doanh thu bán lẻ `CASH`.

---

### 2.5 🟠 [High] Phương thức thanh toán `TRANSFER_COMPANY` (CK Công ty) bị hiển thị sai thành `"Thẻ POS"` trên toàn bộ `DashboardPage` và file Excel xuất ra
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [DashboardPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/DashboardPage.tsx#L122) — in báo cáo (`handlePrint`)
  - [DashboardPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/DashboardPage.tsx#L190) — xuất Excel (`handleExportExcel`)
  - [DashboardPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/DashboardPage.tsx#L758-L768) & dòng `826`, `1159`, `1191`, `1243`, `1269`
- **Mô tả chi tiết:**
  - Hệ thống có 4 phương thức thanh toán: `CASH`, `TRANSFER`, `TRANSFER_COMPANY`, `CARD` (được bổ sung từ migration `047_add_company_transfer.sql`).
  - Trong `OrdersPage.tsx` (dòng 356-361) và `DashboardPage.tsx` (phần tổng hợp dòng 665-670), hệ thống đã phân biệt `TRANSFER_COMPANY`.
  - Tuy nhiên, ở **9 vị trí hiển thị chi tiết bảng, in báo cáo và xuất Excel trong `DashboardPage.tsx`** (dòng 122, 190, 758, 768, 826, 1159, 1191, 1243, 1269), code vẫn dùng biểu thức 3 ngôi cũ:
    ```ts
    t.payment_method === 'CASH' ? 'Tiền mặt' : t.payment_method === 'TRANSFER' ? 'Chuyển khoản' : 'Thẻ POS'
    ```
  - Hệ quả: Toàn bộ giao dịch **Chuyển khoản công ty (`TRANSFER_COMPANY`)** đều bị hiển thị và xuất ra Excel dưới nhãn **"💳 Thẻ POS"**, gây sai lệch hoàn toàn khi kế toán đối soát giữa máy POS quẹt thẻ và tài khoản ngân hàng công ty.
- **Hướng xử lý đề xuất:**
  - Tạo một hàm helper dùng chung `formatPaymentMethod(method)` trả về đúng 4 nhãn (`Tiền mặt`, `CK Cá nhân`, `CK Công ty`, `Thẻ POS`) và sử dụng thống nhất trên toàn bộ ứng dụng.

---

### 2.6 🟠 [High] Chỉnh sửa Giá hoặc Xóa Gói thẻ ở `OrdersPage` / `CustomerPage` không cập nhật lại `orders.total_amount` và `order_items`
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [OrdersPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/OrdersPage.tsx#L293-L321) — hàm `handleUpdatePackage()`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L459-L536) — hàm `handleUpdatePackage()`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L538-L556) — hàm `handleDeletePackage()`
- **Mô tả chi tiết:**
  - Khi thanh toán ở POS, dữ liệu doanh thu được ghi đồng thời vào 3 bảng: `orders` (`total_amount`), `order_items` (`unit_price`, `subtotal`) và `tickets` (`price_paid`).
  - Khi Admin vào `OrdersPage` hoặc `CustomerPage` để sửa lại `price_paid` hoặc `payment_method` của một gói thẻ (hoặc xóa hẳn gói thẻ), code chỉ chạy `supabase.from('tickets').update(...)` (hoặc `.delete()`), mà **không hề cập nhật bảng `orders` và `order_items`**.
  - Hệ quả:
    - Trong chính `OrdersPage.tsx`, cột "Tổng tiền" của đơn hàng (`order.total_amount`) hiển thị số tiền cũ, trong khi bấm mở chi tiết gói bên trong lại hiển thị số tiền mới (`ticket.price_paid`).
    - Báo cáo P&L (`PnLReportTab.tsx`) và `DashboardPage` bị lệch số liệu giữa các tab truy vấn theo `tickets` và các tab truy vấn theo `orders` / `order_items`.
- **Hướng xử lý đề xuất:**
  - Thực hiện việc sửa giá / phương thức thanh toán / xóa gói thông qua một RPC trên Database để đồng bộ cả `tickets`, `order_items` và tính lại `orders.total_amount`.

---

### 2.7 🟠 [High] Trùng lặp mã nguồn ở nhiều nơi (Code & Interface Duplication) gây nguy cơ lệch nghiệp vụ khi bảo trì
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  1. **Hàm `maskCardCode`:** Copy-paste ở [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L83-L89) và [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L287-L293).
  2. **Logic đọc và strip chuỗi JSON `system_settings` (`businessInfo`):** Lặp lại 6 lần tại [App.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/App.tsx#L49-L64), [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L296-L320), [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L192-L210), [CashPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CashPage.tsx#L70-L89), [DashboardPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/DashboardPage.tsx#L63-L80), [OrdersPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/OrdersPage.tsx#L93-L115), [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx#L168-L185).
  3. **Interface `TicketType`, `Promotion`, `Voucher`, `Product`:** Khai báo trùng lặp giữa [types.ts](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/types.ts), [SettingsPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/SettingsPage.tsx#L31-L71), [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L46-L75), [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx#L10-L35) với các trường lệch nhau (ví dụ `requires_gate_ticket` có ở `SettingsPage.tsx` và `POSPage.tsx` nhưng thiếu trong `types.ts`).
- **Hướng xử lý đề xuất:**
  - Gom toàn bộ interfaces về `src/types.ts`, tách `maskCardCode` và `useBusinessSettings()` thành shared utility/hook.

---

### 2.8 🟡 [Medium] Trạng thái Gói thẻ (`status`) được tính toán khác nhau giữa Frontend (`computeStatus`) và Database
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L271-L284) — hàm `computeStatus()` và `handleUpdatePackage()` (dòng 467)
- **Mô tả chi tiết:**
  - Frontend tự định nghĩa trạng thái ảo `'EXPIRING'` (khi `remaining_sessions <= 3` hoặc còn `<= 5` ngày) đè lên trường `pkg.status` lấy từ DB (`UNUSED`, `IN_USE`, `EXPIRED`).
  - Khi Admin mở modal sửa gói thẻ, dropdown Trạng thái không có option `'EXPIRING'`, nên code phải chữa cháy bằng `const dbStatus = editStatus === 'EXPIRING' ? 'IN_USE' : editStatus;` (dòng 467) — nếu gói thẻ ban đầu chưa kích hoạt (`UNUSED`) nhưng có tổng số buổi `<= 3` (ví dụ gói học thử 2 buổi), `computeStatus` biến nó thành `'EXPIRING'`, và khi Admin bấm Lưu thông tin khác, gói đó bị ép chuyển trạng thái trong DB thành `'IN_USE'`!
- **Hướng xử lý đề xuất:**
  - Tách bạch hoàn toàn trường `db_status` (`UNUSED` | `IN_USE` | `EXPIRED` | `CANCELLED`) và thuộc tính hiển thị cảnh báo `isExpiringSoon: boolean` trên UI.

---

### 2.9 🟡 [Medium] Hai nguồn dữ liệu song song (Dual Source of Truth) trong `financialService.ts`
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [financialService.ts](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/utils/financialService.ts#L285-L636)
- **Mô tả chi tiết:**
  - Mọi hàm đọc/ghi sổ kế toán P&L (`fetchCategories`, `fetchTransactions`, `saveTransaction`, `fetchDepreciationAssets`, `fetchFixedExpenses`, `fetchAccountingMonths`) đều có cơ chế: thử truy vấn bảng SQL (tạo ở migration `057_financial_report_module.sql`), nếu gặp lỗi `isMissingTableError` thì tự động fallback sang đọc/ghi chuỗi JSON khổng lồ trong bảng `system_settings` (`fin_transactions_v1`, `fin_categories_v1`,...).
  - Nếu lỗi mạng tạm thời hoặc lỗi phân quyền bị nhận nhầm, dữ liệu sẽ bị ghi phân mảnh một nửa ở bảng SQL, một nửa ở `system_settings`, gây mất đồng bộ nghiêm trọng.
- **Hướng xử lý đề xuất:**
  - Sau khi đã chạy migration `057_financial_report_module.sql`, loại bỏ cơ chế ghi fallback vào `system_settings` và chỉ giữ một công cụ migrate dữ liệu 1 chiều duy nhất từ `system_settings` sang bảng SQL.

---

## HẠNG MỤC 3: SĂN TÌM BUG TIỀM ẨN (Technical & Logic Bugs)

---

### 3.1 🔴 [Critical] Lỗi Build & Crash Runtime (`TypeError: fetchAllSupabaseRows is not a function`) làm sập 3 trang Báo cáo lớn
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [financialService.ts](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/utils/financialService.ts#L1-L767)
  - [DashboardPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/DashboardPage.tsx#L8) (gọi tại dòng `323`, `387`, `432`, `466`, `569`)
  - [AnalyticsPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/AnalyticsPage.tsx#L5) (gọi tại dòng `50`, `69`)
  - [PnLReportTab.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/components/PnLReportTab.tsx#L37) (gọi tại dòng `243`, `258`, `287`, `301`, `311`)
- **Mô tả chi tiết:**
  - Cả 3 module báo cáo cốt lõi là `DashboardPage.tsx`, `AnalyticsPage.tsx` và `PnLReportTab.tsx` đều import hàm `{ fetchAllSupabaseRows } from '../utils/financialService'`.
  - Tuy nhiên, kiểm tra toàn bộ 767 dòng của `pool-frontend/src/utils/financialService.ts` cho thấy **hàm `fetchAllSupabaseRows` hoàn toàn KHÔNG tồn tại (chưa được khai báo hay export)**!
  - **Hậu quả:**
    1. Chạy lệnh build production (`npm run build` / `tsc -b`) sẽ **thất bại ngay lập tức** với lỗi `TS2305: Module '"../utils/financialService"' has no exported member 'fetchAllSupabaseRows'`.
    2. Khi chạy trên trình duyệt (`vite dev`), ngay khi người dùng mở trang **Báo Cáo (`/dashboard`)**, **Phân Tích (`/analytics`)**, hoặc tab **Báo cáo KQKD (`/cash`)**, ứng dụng sẽ ném ngoại lệ `TypeError: fetchAllSupabaseRows is not a function`, làm treo/trắng trang hoặc không tải được bất kỳ dữ liệu báo cáo nào!
- **Hướng xử lý đề xuất:**
  - Bổ sung và export hàm helper phân trang `fetchAllSupabaseRows<T>(buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, pageSize = 1000): Promise<T[]>` trong `pool-frontend/src/utils/financialService.ts` để tự động lặp qua giới hạn `1000 rows` mặc định của Supabase PostgREST.

---

### 3.2 🔴 [Critical] Lỗi Múi giờ (`toISOString()`) làm mất toàn bộ dữ liệu ngày cuối tháng trong Bảng lương Huấn luyện viên (`CoachPayrollPage`)
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:** [CoachPayrollPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CoachPayrollPage.tsx#L59-L86) — `useEffect` khởi tạo tháng & hàm `fetchPayrollData()`
- **Mô tả chi tiết:**
  - Tại dòng 61-65 của `CoachPayrollPage.tsx`, khi người dùng chọn tháng tính lương `selectedMonth` (ví dụ `"2026-05"`), code tính ngày đầu tháng và cuối tháng như sau:
    ```ts
    const [y, m] = selectedMonth.split('-').map(Number);
    setStartDate(`${selectedMonth}-01`);
    const lastDay = new Date(y, m, 0).toISOString().split('T')[0];
    setEndDate(lastDay);
    ```
  - Tại Việt Nam (múi giờ `UTC+7`), `new Date(2026, 5, 0)` tạo ra thời điểm `2026-05-31 00:00:00 GMT+0700` (nửa đêm ngày 31/05 giờ địa phương). Khi gọi `.toISOString()`, JavaScript chuyển thời điểm đó về giờ UTC là **`2026-05-30T17:00:00.000Z`**!
  - Do đó `.split('T')[0]` trả về **`"2026-05-30"`** thay vì `"2026-05-31"`!
  - Không những thế, ở dòng 79-80, truy vấn lọc `checked_in_at` và `sold_at` bằng chuỗi không có timezone offset (`${startDate}T00:00:00` đến `${endDate}T23:59:59`), bị PostgreSQL hiểu là giờ UTC.
  - **Hậu quả:** Mặc định mỗi khi mở bảng tính lương HLV theo tháng, **toàn bộ buổi dạy và doanh thu hoa hồng của ngày cuối cùng trong tháng (ngày 28/29, 30 hoặc 31) đều bị cắt bỏ khỏi bảng lương**!
- **Hướng xử lý đề xuất:**
  - Tính ngày cuối tháng bằng `const lastDayNum = new Date(y, m, 0).getDate(); setEndDate(\`\${selectedMonth}-\${String(lastDayNum).padStart(2, '0')}\`);`.
  - Khi lọc trên các cột `TIMESTAMPTZ`, luôn gắn hậu tố múi giờ Việt Nam `+07:00`: `${startDate}T00:00:00+07:00` và `${endDate}T23:59:59.999+07:00`.

---

### 3.3 🔴 [Critical] Lỗi công thức tính ngày hết hạn vé `DAILY` khi `validity_days` là `null` hoặc `0` (Vé vừa mua đã hết hạn hôm qua)
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:** [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L718-L727) — hàm `doCheckoutOrder()`
- **Mô tả chi tiết:**
  - Khi bán vé ngày (`category === 'DAILY'`), code tính `validUntil` như sau:
    ```ts
    const daysToAdd = (c.ticketType.validity_days || 0) - 1;
    const endDay = new Date(today.getTime() + daysToAdd * 24 * 60 * 60 * 1000 - tzOffset);
    validUntil = endDay.toISOString().slice(0, -1).split('T')[0];
    ```
  - Khi Admin tạo một loại vé Lượt (`DAILY`) mới trong `SettingsPage.tsx`, trường `validity_days` chỉ hiển thị cho gói `MULTI` và bị gán `validity_days: null` cho vé `DAILY` (xem `SettingsPage.tsx` dòng 239: `validity_days: (category === 'MULTI' && validityDays) ? Number(validityDays) : null`).
  - Với `validity_days = null`, biểu thức `(c.ticketType.validity_days || 0) - 1` cho kết quả **`-1`**, khiến `validUntil` bị lùi về **ngày hôm qua (`today - 1 day`)**!
  - Khi khách cầm vé vừa in ra cổng quét, nếu hàm kiểm tra đối chiếu `valid_until < CURRENT_DATE`, vé vừa mua xong sẽ bị báo **Đã hết hạn**!
- **Hướng xử lý đề xuất:**
  - Sửa công thức thành: `const daysToAdd = Math.max(0, (c.ticketType.validity_days || 1) - 1);`.

---

### 3.4 🔴 [Critical] Phiếu Nhập/Xuất Kho nhiều mặt hàng (`handleSubmitSlip`) không có Transaction và gây nhân đôi dữ liệu khi thử lại
- **Mức độ nghiêm trọng:** **Critical**
- **Vị trí:**
  - [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx#L410-L452) — hàm `handleSubmitSlip()`
  - [046_fix_checkout_customer_id.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/046_fix_checkout_customer_id.sql#L98-L100) — RPC `create_checkout_order`
- **Mô tả chi tiết:**
  1. Trong `handleSubmitSlip()` (dòng 424-439), khi người dùng tạo một Phiếu Nhập kho hoặc Xuất kho gồm nhiều mặt hàng (`slipItems`), Frontend chạy vòng lặp `for (const item of validItems)` và gọi RPC `adjust_inventory` từng dòng một.
     - Nếu phiếu xuất kho có 5 mặt hàng, mặt hàng 1 và 2 chạy thành công (đã trừ kho và ghi log trong DB), nhưng đến mặt hàng thứ 3 bị lỗi (ví dụ tồn kho không đủ), vòng lặp `return` dừng lại và giữ nguyên Modal mở với cả 5 mặt hàng.
     - Khi người dùng sửa lại số lượng mặt hàng thứ 3 rồi bấm **"Xác nhận"** lần nữa, hệ thống chạy lại từ đầu và **trừ/cộng kho mặt hàng 1 và 2 thêm một lần nữa (nhân đôi phiếu kho)**!
  2. Trong RPC `create_checkout_order` (`046_fix_checkout_customer_id.sql` dòng 98-100), câu lệnh `UPDATE public.products SET stock_quantity = stock_quantity - (v_item->>'quantity'):: INT WHERE id = ...` **không hề kiểm tra điều kiện `stock_quantity >= quantity`**, cho phép tồn kho bị âm nếu 2 thu ngân cùng bán một mặt hàng cuối cùng trong kho.
- **Hướng xử lý đề xuất:**
  - Tạo RPC `create_inventory_slip(p_type, p_items JSONB, p_note)` để xử lý toàn bộ danh sách mặt hàng trong **1 database transaction duy nhất** (nếu 1 dòng lỗi thì rollback toàn bộ phiếu).
  - Bổ sung kiểm tra `IF v_current_stock < v_qty THEN RAISE EXCEPTION ...` kèm `FOR UPDATE` trong `create_checkout_order`.

---

### 3.5 🟠 [High] Trừ lượt sử dụng Voucher (`use_voucher`) nằm ngoài Transaction thanh toán đơn hàng
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L800-L809) — hàm `doCheckoutOrder()`
- **Mô tả chi tiết:**
  - Sau khi RPC `create_checkout_order` tạo đơn hàng và vé với giá đã giảm thành công, Frontend mới chạy vòng lặp gọi RPC `use_voucher` cho từng dòng trong giỏ hàng.
  - Ngoài việc khách hàng có thể chọn **cùng 1 mã voucher chỉ còn 1 lượt sử dụng cho nhiều vé khác nhau trong cùng giỏ hàng** (vì bước validate voucher khi thêm vào giỏ không kiểm tra các item đã nằm sẵn trong `cart`), nếu lệnh `use_voucher` thất bại hoặc rớt mạng sau khi `create_checkout_order` đã commit, đơn hàng vẫn được hưởng giảm giá mà voucher không bị trừ lượt.
- **Hướng xử lý đề xuất:**
  - Chuyển logic kiểm tra và trừ `used_count` của `vouchers` vào bên trong RPC `create_checkout_order` để đảm bảo tính nguyên tử (Atomicity).

---

### 3.6 🟠 [High] Thao tác Đổi mã thẻ (`handleUpdateCardCode`) thực hiện 5 lệnh DB rời rạc không có Transaction và dễ ghi đè nhầm thẻ của khách khác
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L370-L456) — hàm `handleUpdateCardCode()`
- **Mô tả chi tiết:**
  - Khi đổi mã thẻ cho một gói (`selectedPkg`), hàm thực hiện tuần tự 5 bước từ Frontend:
    1. Kiểm tra `card_bank`.
    2. Cập nhật `tickets` (`WHERE card_code = oldCode` hoặc `WHERE id = selectedPkg.id`).
    3. Cập nhật `customers.card_code = newCode`.
    4. Cập nhật/thêm mới `card_bank` cho mã mới (`USED`).
    5. Thu hồi mã thẻ cũ trong `card_bank` (`REVOKED`).
  - **Bug logic 1:** Nếu bước 2 chạy theo nhánh `else` (`WHERE id = selectedPkg.id` khi gói cũ chưa có mã thẻ), nhưng khách hàng đó đang có một thẻ cũ khác gắn trên `customers.card_code`, bước 3 sẽ ghi đè `customers.card_code` sang mã mới, làm mất liên kết thẻ của các gói khác thuộc cùng khách hàng.
  - **Bug logic 2:** Nếu xảy ra lỗi ở bước 3 hoặc 4 (ví dụ trùng unique `card_code` trên bảng `customers`), bước 2 đã thực thi xong sẽ không được rollback, khiến mã thẻ trên `tickets` và `customers` lệch nhau.
- **Hướng xử lý đề xuất:**
  - Đóng gói toàn bộ quy trình cấp/đổi/thu hồi thẻ vào một PostgreSQL RPC chạy trong 1 transaction.

---

### 3.7 🟠 [High] Lỗi lệch múi giờ 7 tiếng khi lọc theo ngày trên `OrdersPage`, `POSPage` (Lịch sử Check-in) và `CoachPayrollPage`
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [OrdersPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/OrdersPage.tsx#L124-L125) — hàm `fetchOrders()`
  - [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L1370-L1371) & dòng `1411-1412` — hàm `fetchCheckinHistory()`
  - [CoachPayrollPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CoachPayrollPage.tsx#L79-L80) — hàm `fetchPayrollData()`
- **Mô tả chi tiết:**
  - Trong khi `DashboardPage.tsx` (dòng 314-315) đã sửa đúng bằng cách nối `+07:00` (`${dateRange.from}T00:00:00+07:00`), thì `OrdersPage.tsx`, `POSPage.tsx` và `CoachPayrollPage.tsx` vẫn nối chuỗi trần `${dateFrom}T00:00:00` và `${dateTo}T23:59:59`.
  - Khi gửi chuỗi không có offset lên Supabase (PostgreSQL có timezone mặc định là `UTC`), `${dateFrom}T00:00:00` được hiểu là `00:00 UTC` tức **`07:00 sáng giờ Việt Nam`**!
  - **Hậu quả:** Toàn bộ đơn hàng và lượt khách bơi check-in trong khung giờ sáng sớm từ **00:00 đến 06:59:59 sáng giờ Việt Nam** bị lọt sang ngày hôm trước khi tra cứu trên `OrdersPage` và `POSPage`!
- **Hướng xử lý đề xuất:**
  - Bổ sung hậu tố `+07:00` vào tất cả các chuỗi lọc `TIMESTAMPTZ` trên `OrdersPage.tsx`, `POSPage.tsx` và `CoachPayrollPage.tsx`.

---

### 3.8 🟠 [High] N+1 Query nghiêm trọng khi Import Excel Khách hàng (`handleConfirmImport`) và Gia hạn hàng loạt (`handleConfirmExtend`)
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L740-L830) — hàm `handleConfirmImport()`
  - [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L912-L975) — hàm `handleConfirmExtend()`
- **Mô tả chi tiết:**
  - Khi import file Excel 500 khách hàng, vòng lặp `for` thực hiện tuần tự 4–5 HTTP requests cho mỗi dòng (`SELECT customers`, `INSERT customers`, `UPSERT card_bank`, `INSERT tickets`) → tổng cộng **2,000+ HTTP requests tuần tự**, gây treo trình duyệt hoặc đứt kết nối giữa chừng.
  - Tương tự, khi gia hạn hàng loạt (`handleConfirmExtend`) cho vài trăm gói thẻ, code lặp qua từng gói gọi `supabase.from('tickets').update(...)` tuần tự. Nếu rớt mạng ở gói thứ 50, 49 gói đầu đã được cộng ngày nhưng lệnh ghi `bulk_extensions` ở cuối hàm chưa chạy → khi bấm thực hiện lại sẽ cộng dồn gấp đôi số ngày cho 49 gói đầu!
- **Hướng xử lý đề xuất:**
  - Chuyển cả 2 luồng sang xử lý theo lô (Batch RPC) trong PostgreSQL nhận mảng JSONB.

---

### 3.9 🟠 [High] Dịch vụ Cổng kiểm soát (`pool-gate-agent`) không tự động kết nối lại khi rớt mạng hoặc tuột cáp COM
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** [index.js](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-gate-agent/index.js#L26-L93)
- **Mô tả chi tiết:**
  - Khi kết nối Supabase Realtime trả về trạng thái `CLOSED` hoặc `CHANNEL_ERROR` (dòng 89-92), agent chỉ `console.error(...)` mà không có cơ chế retry/resubscribe.
  - Khi cổng Serial (`SerialPort`) bị tuột cáp USB hoặc nhiễu điện ngắt kết nối tạm thời, sự kiện `port.on('close')` không được lắng nghe để tự động mở lại cổng COM.
  - Ngoài ra, agent đọc biến môi trường `process.env.VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` (dòng 6-7), nếu RLS trên bảng `scan_logs` chặn quyền đọc của role `anon` thì agent sẽ không bao giờ nhận được sự kiện `INSERT` để mở cổng!
- **Hướng xử lý đề xuất:**
  - Bổ sung cơ chế reconnect theo chu kỳ (exponential backoff) cho cả `SerialPort` và kênh `Supabase Realtime`, đồng thời sử dụng `SUPABASE_SERVICE_ROLE_KEY` cho agent chạy tại máy chủ cục bộ.

---

### 3.10 🟡 [Medium] `CustomerPage` tải toàn bộ bảng `tickets` và `customers` không phân trang và không giới hạn `1000 rows`
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [CustomerPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CustomerPage.tsx#L212-L269) — hàm `fetchAllPackages()`
- **Mô tả chi tiết:**
  - `fetchAllPackages()` gọi `supabase.from('tickets').select(...)` và `supabase.from('customers').select('*')` mà không dùng `range()` hay phân trang.
  - Mặc định Supabase PostgREST giới hạn tối đa **1,000 dòng** mỗi lần trả về. Khi hồ bơi có trên 1,000 khách hàng hoặc trên 1,000 gói thẻ lịch sử, các khách hàng/gói thẻ từ dòng 1,001 trở đi sẽ **bị cắt cụt âm thầm**, khiến khách hàng vẫn còn thẻ nhưng tìm trên trang Khách Hàng không thấy gói!
- **Hướng xử lý đề xuất:**
  - Áp dụng server-side pagination + search trên bảng `customers`, hoặc sử dụng hàm phân trang `fetchAllSupabaseRows` nếu cần tải toàn bộ danh sách về client.

---

### 3.11 🟡 [Medium] Bảng Kiểm kê kho (`inventory_audits`) gọi `.select().single()` trên câu lệnh trả về nhiều dòng gây lỗi
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx#L492-L505) — hàm `handleCreateAudit()`
- **Mô tả chi tiết:**
  - Khi tạo phiếu kiểm kê kho, nếu có lỗi hoặc kiểm tra dữ liệu, cần lưu ý cách xử lý bất đồng bộ trong `handleSaveAuditItems()` (dòng 520-585): khi chốt phiếu kiểm kê (`handleCompleteAudit`), code lặp qua từng mặt hàng có chênh lệch để gọi `adjust_inventory` tuần tự mà không nằm trong cùng 1 transaction với lệnh cập nhật trạng thái `inventory_audits.status = 'COMPLETED'`.
- **Hướng xử lý đề xuất:**
  - Đưa logic chốt kiểm kê kho và cân bằng tồn kho vào một RPC duy nhất `complete_inventory_audit(p_audit_id)`.

---

### 3.12 🟡 [Medium] Lỗi nối chuỗi trực tiếp trong bộ lọc `.or()` khi tìm kiếm Lịch sử Check-in và Khách hàng
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [POSPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/POSPage.tsx#L1361-L1367) & dòng `1402-1408` — hàm `fetchCheckinHistory()`
- **Mô tả chi tiết:**
  - Chuỗi tìm kiếm `term` của người dùng được ghép thẳng vào biểu thức PostgREST `.or(\`card_code.ilike.%\${term}%,customer_name.ilike.%\${term}%\`)`. Nếu người dùng gõ ký tự dấu phẩy `,` hoặc dấu ngoặc đơn `(` `)` trong ô tìm kiếm, cú pháp bộ lọc của PostgREST sẽ bị vỡ và trả về lỗi `400 Bad Request`.
- **Hướng xử lý đề xuất:**
  - Làm sạch (escape/strip) các ký tự đặc biệt của PostgREST (`,`, `(`, `)`) khỏi `term` trước khi đưa vào chuỗi `.or()`.

---

### 3.13 🔵 [Low] Đặt tên các file Migration SQL bị trùng số thứ tự (`006`, `031`, `047`) và để rời ngoài thư mục `supabase/migrations`
- **Mức độ nghiêm trọng:** **Low**
- **Vị trí:**
  - `supabase/migrations/006_promotion_ticket_type.sql` & `006_promotion_ticket_types.sql`
  - `supabase/migrations/031_inventory_audits.sql` & `031_product_variants.sql`
  - `supabase/migrations/047_add_company_transfer.sql` & `047_fix_pos_checkin_category.sql`
  - `pool-frontend/migration_coach.sql` & `pool-frontend/migration_bulk_extend.sql`
- **Mô tả chi tiết:**
  - Việc trùng tiền tố số (`006`, `031`, `047`) và đặt 2 file migration quan trọng (`migration_coach.sql`, `migration_bulk_extend.sql`) nằm lạc bên trong thư mục `pool-frontend/` khiến quy trình khởi tạo lại Database trên môi trường mới dễ chạy thiếu hoặc sai thứ tự phụ thuộc (ví dụ `056_checkin_logs.sql` phụ thuộc vào bảng `coaches` trong `pool-frontend/migration_coach.sql`).
- **Hướng xử lý đề xuất:**
  - Chuyển toàn bộ các file SQL rời vào `supabase/migrations/` và đánh số thứ tự tuần tự không trùng lặp.

---

## HẠNG MỤC 4: ĐỀ XUẤT BỔ SUNG NGHIỆP VỤ & TỐI ƯU LOGIC (Business Logic Enhancements)

---

### 4.1 🟠 [High] Bổ sung Nhật ký Kiểm toán (Audit Log) cho các thao tác chỉnh sửa nhạy cảm của Admin
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** Toàn hệ thống (`CustomerPage.tsx`, `OrdersPage.tsx`, `InventoryPage.tsx`, `SettingsPage.tsx`, `StaffPage.tsx`)
- **Mô tả chi tiết:**
  - Hiện tại Admin (hoặc người có tài khoản Admin) có thể sửa trực tiếp số buổi còn lại (`remaining_sessions`), sửa giá tiền đã thu (`price_paid`), sửa ngày bán (`created_at`), đổi phương thức thanh toán, hoặc xóa hẳn gói thẻ mà hệ thống **không lưu lại bất kỳ lịch sử thay đổi nào (ai sửa, sửa lúc nào, giá trị cũ là gì, giá trị mới là gì)**.
- **Hướng xử lý đề xuất:**
  - Tạo bảng `audit_logs` (`id`, `actor_id`, `action`, `table_name`, `record_id`, `old_data JSONB`, `new_data JSONB`, `reason`, `created_at`) và gắn PostgreSQL Trigger tự động ghi nhận mọi thao tác `UPDATE`/`DELETE` trên các bảng `tickets`, `orders`, `products`, `financial_transactions`, `coaches`.

---

### 4.2 🟠 [High] Bổ sung Cơ chế Khóa sổ Kế toán (`is_locked`) thực sự chặn sửa/xóa dữ liệu quá khứ
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:**
  - [PnLReportTab.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/components/PnLReportTab.tsx)
  - [057_financial_report_module.sql](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/supabase/migrations/057_financial_report_module.sql#L103-L115) — bảng `accounting_months`
  - [OrdersPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/OrdersPage.tsx#L293-L321)
- **Mô tả chi tiết:**
  - Mặc dù bảng `accounting_months` đã có cột `status ('OPEN' | 'CLOSED')`, nhưng khi kỳ kế toán đã đóng (`CLOSED`), người dùng ở `OrdersPage` hoặc `CustomerPage` vẫn có thể sửa `created_at` (ngày bán vé) lùi về tháng đã chốt sổ, hoặc xóa vé của tháng trước, làm thay đổi toàn bộ số liệu doanh thu thực thu và doanh thu phân bổ của kỳ kế toán đã khóa!
- **Hướng xử lý đề xuất:**
  - Bổ sung Trigger ở Database chặn mọi thao tác `INSERT / UPDATE / DELETE` trên `tickets`, `orders`, `expenses`, `financial_transactions` nếu ngày giao dịch thuộc về một tháng đã có `accounting_months.status = 'CLOSED'`.

---

### 4.3 🟠 [High] Bổ sung Luồng Hoàn tiền / Đổi trả đơn hàng (Refund & Return Flow)
- **Mức độ nghiêm trọng:** **High**
- **Vị trí:** `OrdersPage.tsx`, `POSPage.tsx`, `CashPage.tsx`
- **Mô tả chi tiết:**
  - Hiện tại hệ thống chỉ có nút hủy vé lượt/check-in (`cancel_ticket`) hoặc xóa cứng gói thẻ. Chưa có nghiệp vụ:
    1. Khách mua đồ bơi/kính bơi muốn trả hàng hoặc đổi size khác chênh lệch giá (hoàn lại tồn kho `products.stock_quantity` và hoàn tiền).
    2. Khách mua gói học bơi/vé tháng nhưng vì lý do sức khỏe được hoàn lại một phần tiền (Partial Refund) và thu hồi thẻ.
- **Hướng xử lý đề xuất:**
  - Thiết kế trạng thái `REFUNDED` / `PARTIALLY_REFUNDED` cho `orders` và `tickets`, tự động sinh bút toán hoàn tiền đối ứng trong sổ quỹ/P&L và cộng trả tồn kho khi trả hàng bán lẻ.

---

### 4.4 🟡 [Medium] Bổ sung Quản lý Ca làm việc & Giao ca thu ngân (Shift Handover)
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [CashPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/CashPage.tsx)
- **Mô tả chi tiết:**
  - Sổ quỹ hiện tính gộp cả ngày (`00:00` → `23:59`). Trong thực tế vận hành bể bơi có ca sáng và ca chiều, khi giao ca cần biết số dư tiền mặt đầu ca, tổng thu tiền mặt trong ca của từng thu ngân, tổng chi trong ca, và biên bản bàn giao tiền mặt cuối ca.
- **Hướng xử lý đề xuất:**
  - Bổ sung bảng `cashier_shifts` (`opened_at`, `closed_at`, `opening_balance`, `expected_closing_balance`, `actual_closing_balance`, `cashier_id`, `note`) để quản lý chặt chẽ tiền mặt theo từng ca trực.

---

### 4.5 🟡 [Medium] Cảnh báo khi Ngừng hoạt động (`is_active = false`) hoặc Xóa Loại vé / Sản phẩm đang có ràng buộc
- **Mức độ nghiêm trọng:** **Medium**
- **Vị trí:** [SettingsPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/SettingsPage.tsx) & [InventoryPage.tsx](file:///d:/2.%20HYMINH/PHẦN%20MỀM/PHAN%20MEM%20VE%20BOI/pool-frontend/src/pages/InventoryPage.tsx)
- **Mô tả chi tiết:**
  - Khi xóa loại vé hoặc sản phẩm đã từng phát sinh giao dịch, Database sẽ trả về lỗi khóa ngoại (`23503 foreign_key_violation`). Cần kiểm tra trước số lượng gói đang hoạt động hoặc tồn kho còn lại để hiển thị thông báo hướng dẫn người dùng chuyển sang trạng thái "Ngừng kinh doanh" (`is_active = false`) thay vì xóa cứng.

---

## 📋 BẢNG TỔNG HỢP ƯU TIÊN KHẮC PHỤC (ACTIONABLE ROADMAP)

| Ưu tiên | Mã | Mức độ | Vấn đề trọng tâm | File cần xử lý |
| :---: | :---: | :---: | :--- | :--- |
| **1** | **3.1** | 🔴 Critical | Thiếu hàm `fetchAllSupabaseRows` gây lỗi build và crash trang `DashboardPage`, `AnalyticsPage`, `PnLReportTab` | `src/utils/financialService.ts` |
| **2** | **1.2** | 🔴 Critical | Lỗ hổng RLS `USING (true)` trên `coaches`, `coach_attendances`, `checkin_logs` và thiếu RLS trên `bulk_extensions` | `migration_coach.sql`, `056_checkin_logs.sql`, `migration_bulk_extend.sql` |
| **3** | **2.1** | 🔴 Critical | Khuyến mãi `AMOUNT` / `PERCENT` không được trừ vào giá vé Gói/Học bơi trên `POSPage` | `src/pages/POSPage.tsx` |
| **4** | **1.3** | 🔴 Critical | Gói Học bơi Kèm riêng 1-N (`student_count >= 3`) làm mất thông tin từ học viên thứ 3 và chỉ in 1 vé cổng | `src/pages/POSPage.tsx`, `054_smart_multi_package_checkin.sql` |
| **5** | **3.2** | 🔴 Critical | Lỗi `toISOString()` cắt mất ngày cuối tháng trong Bảng lương HLV (`CoachPayrollPage`) | `src/pages/CoachPayrollPage.tsx` |
| **6** | **2.2** | 🔴 Critical | Hủy vé (`cancel_ticket`) không cập nhật `checkin_logs`, vẫn tính lương HLV và tìm gói cha qua SĐT gây cộng nhầm gói | `050_ticket_cancellation.sql`, `056_checkin_logs.sql` |
| **7** | **3.3** | 🔴 Critical | Lỗi công thức `validity_days = null` khiến vé `DAILY` vừa mua có hạn sử dụng là ngày hôm qua | `src/pages/POSPage.tsx` |
| **8** | **1.1** | 🔴 Critical | Chống Double-Submit bằng `useRef` cho `doCheckoutOrder()` và `doCheckin()` | `src/pages/POSPage.tsx` |
| **9** | **3.4** | 🔴 Critical | Gộp phiếu Nhập/Xuất kho nhiều mặt hàng vào 1 Transaction & chặn âm kho khi bán lẻ | `src/pages/InventoryPage.tsx`, `046_fix_checkout_customer_id.sql` |
| **10** | **2.4 & 2.5** | 🟠 High | Sửa công thức tính Tồn quỹ tiền mặt ở `CashPage` và sửa nhãn `TRANSFER_COMPANY` bị hiển thị thành `Thẻ POS` ở `DashboardPage` | `src/pages/CashPage.tsx`, `src/pages/DashboardPage.tsx` |
| **11** | **3.7** | 🟠 High | Gắn múi giờ `+07:00` cho bộ lọc ngày ở `OrdersPage`, `POSPage` và `CoachPayrollPage` | `OrdersPage.tsx`, `POSPage.tsx`, `CoachPayrollPage.tsx` |
| **12** | **1.4 & 1.5** | 🟠 High | Đồng bộ phân quyền RBAC trên `CustomerPage` và bỏ `setTimeout(800ms)` khi tạo nhân viên/HLV ở `StaffPage` | `App.tsx`, `CustomerPage.tsx`, `StaffPage.tsx` |
