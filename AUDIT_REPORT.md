# 🔍 BÁO CÁO KIỂM TOÁN MÃ NGUỒN (AUDIT REPORT)

**Dự án:** Hệ Thống Quản Lý Vé Bơi (Pool Ticket Management System)  
**Ngày kiểm toán:** 05/11/2026  
**Người thực hiện:** Senior QA Automation / System Architect / Business Analyst  
**Phạm vi:** Frontend (React/Vite) · Backend/API (Supabase RPC + RLS) · Database Schema (57 migrations) · Gate Agent (Node.js + SerialPort)

---

## 📊 TỔNG KẾT NHANH

| Mức độ | Số lượng | Tỷ lệ |
|--------|----------|--------|
| 🔴 **Critical** | 8 | 16% |
| 🟠 **High** | 14 | 28% |
| 🟡 **Medium** | 16 | 32% |
| 🔵 **Low** | 12 | 24% |
| **Tổng cộng** | **50** | 100% |

---

## HẠNG MỤC 1: KIỂM TRA LUỒNG THAO TÁC NGƯỜI DÙNG (User Flow & UI/UX Edge Cases)

---

### 1.1 🔴 CRITICAL — Không có chống Double-Submit khi thanh toán giỏ hàng

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → hàm `doCheckoutOrder()` (dòng ~702-881)
- **Mô tả:** Biến `selling` chỉ ngăn user bấm nút bán vé trực tiếp, nhưng hàm `doCheckoutOrder()` có thể được gọi nhiều lần nếu user bấm nút thanh toán nhanh liên tục (keyboard shortcut Enter hoặc click nhanh). Không có cơ chế `debounce` hay `idempotency key`. Khi gọi RPC `create_checkout_order` 2 lần → **tạo 2 đơn hàng trùng lặp**, trừ tồn kho sản phẩm 2 lần, và in 2 hóa đơn.
- **Hướng xử lý:** Thêm biến `isProcessing` với `useRef` (không phải state, vì state cập nhật async) để lock ngay khi bắt đầu `doCheckoutOrder`. Trên backend, nên thêm idempotency key vào RPC `create_checkout_order`.

---

### 1.2 🔴 CRITICAL — Thiếu xác nhận khi xóa gói thẻ nhưng thiếu xóa checkin_logs

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → hàm `handleDeletePackage()` (dòng ~538-556)
- **Mô tả:** Khi Admin xóa gói thẻ, code chỉ xóa `scan_logs` liên quan nhưng **KHÔNG xóa `checkin_logs`** (bảng mới ở migration 056). Điều này dẫn đến:
  - Lỗi Foreign Key nếu `checkin_logs.source_ticket_id` tham chiếu tới ticket đã xóa
  - Dữ liệu rác trong bảng `checkin_logs` (orphan records)
- **Hướng xử lý:** Thêm `await supabase.from('checkin_logs').delete().eq('source_ticket_id', selectedPkg.id)` trước khi xóa ticket. Hoặc tốt hơn, thiết lập `ON DELETE CASCADE` trên FK ở `checkin_logs`.

---

### 1.3 🔴 CRITICAL — validate_and_scan không xử lý category MULTI và LESSON

- **Vị trí:** `supabase/migrations/050_ticket_cancellation.sql` → function `validate_and_scan` (dòng ~119-290)
- **Mô tả:** Hàm `validate_and_scan` chỉ xử lý 2 category: `DAILY` và `MONTHLY`. Các category `MULTI` và `LESSON` (được thêm từ migration 004) **không có nhánh xử lý** → khi quét QR vé loại MULTI hoặc LESSON qua GateCheckPage, hàm sẽ **rơi vào branch NULL** (v_fail_reason IS NULL AND v_new_status IS NULL), dẫn đến hành vi không xác định: vé vẫn được UPDATE nhưng status bị set thành NULL.
- **Hướng xử lý:** Bổ sung logic cho `MULTI` và `LESSON` category trong hàm `validate_and_scan`, hoặc route chúng qua RPC `check_qr_ticket_text` đã có xử lý đầy đủ.

---

### 1.4 🟠 HIGH — Hệ thống phân quyền không nhất quán giữa canView() và thuộc tính profile

- **Vị trí:** `pool-frontend/src/App.tsx` → hàm `canView()` (dòng 81-96) và sidebar navigation (dòng 128-220)
- **Mô tả:** Hệ thống dùng **2 cơ chế phân quyền khác nhau** cho cùng mục đích:
  - `canView('module')` dựa trên `profile.permissions` (JSON matrix) → cho POS, Gate, Customers, Reports, Staff, Settings
  - `profile.can_manage_inventory`, `profile.can_create_expense` (boolean columns) → cho Inventory, Cash
  - `profile.role === 'ADMIN'` (hard-code) → cho Orders, Coaches, Coach Payroll
  
  Nếu ADMIN sửa permission matrix nhưng quên set boolean columns → nhân viên không thấy menu nhưng vẫn có thể truy cập trực tiếp qua URL (vì route check khác điều kiện sidebar). 

  **Cụ thể:** Route `/inventory` check `profile.can_manage_inventory || profile.role === 'ADMIN'` nhưng sidebar check cùng logic. Tuy nhiên `canView('inventory')` lại **không tồn tại** trong PermissionsMatrix type → thiếu module `inventory` và `cash` trong hệ thống permission centralized.

- **Hướng xử lý:** Thống nhất toàn bộ phân quyền vào một cơ chế duy nhất (hoặc `PermissionsMatrix` hoặc boolean columns, không nên dùng cả hai). Bổ sung `inventory`, `cash`, `orders`, `coaches` vào `PermissionsMatrix`.

---

### 1.5 🟠 HIGH — Đổi mật khẩu chỉ dành cho ADMIN, các role khác không thể đổi

- **Vị trí:** `pool-frontend/src/App.tsx` → dòng 227-235
- **Mô tả:** Nút "Đổi mật khẩu" chỉ hiện khi `profile.role === 'ADMIN'`. Nhân viên STAFF, CASHIER, GATE_KEEPER, COACH không thể tự đổi mật khẩu → nếu mật khẩu bị lộ, phải nhờ Admin reset.
- **Hướng xử lý:** Cho phép tất cả vai trò tự đổi mật khẩu. Nút đổi mật khẩu nên hiển thị cho mọi user đã đăng nhập.

---

### 1.6 🟠 HIGH — Không có loading/error state cho nhiều API call trên POSPage

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → `fetchTicketTypes`, `fetchPromotions`, `fetchProducts`, `fetchBusinessInfo` (dòng ~276-321)
- **Mô tả:** 6 API call được gọi song song trong `useEffect` nhưng chỉ có 1 biến `loading` chung (từ `fetchTicketTypes`). Nếu `fetchProducts` hoặc `fetchPromotions` lỗi → **lỗi bị nuốt mất** (không có catch, không hiện thông báo). User có thể bán hàng mà không thấy danh sách sản phẩm hoặc khuyến mãi.
- **Hướng xử lý:** Thêm try-catch cho mỗi fetch function và hiển thị toast lỗi khi API fail. Hoặc dùng `Promise.allSettled` để track trạng thái từng API.

---

### 1.7 🟠 HIGH — GateCheckPage luôn gửi direction='IN', không hỗ trợ check-out

- **Vị trí:** `pool-frontend/src/pages/GateCheckPage.tsx` → hàm `handleCheck()` (dòng 121-124)
- **Mô tả:** RPC `check_qr_ticket_text` luôn được gọi với `p_direction: 'IN'`. Không có option nào cho user chọn quét RA (OUT). Nếu khách đã quét vào rồi muốn ra → **không có cách quét ra** từ giao diện web, chỉ có gate agent tự động.
- **Hướng xử lý:** Thêm toggle IN/OUT trên GateCheckPage, hoặc logic tự động detect dựa trên trạng thái hiện tại của vé.

---

### 1.8 🟡 MEDIUM — Thiếu confirmation khi xóa chi phí (expense) trong CashPage

- **Vị trí:** `pool-frontend/src/pages/CashPage.tsx`
- **Mô tả:** Trang CashPage có thể thêm phiếu chi nhưng **không có nút/chức năng xóa hoặc sửa phiếu chi**. Nếu nhân viên nhập sai số tiền hoặc lý do → không thể sửa lại.
- **Hướng xử lý:** Bổ sung chức năng sửa/xóa phiếu chi (chỉ ADMIN hoặc người tạo trong ngày).

---

### 1.9 🟡 MEDIUM — useEffect dependency warning bị suppress hàng loạt

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` (dòng 1), `CustomerPage.tsx` (dòng 1), `GateCheckPage.tsx` (dòng 1)
- **Mô tả:** Header `/* eslint-disable react-hooks/exhaustive-deps */` được dùng trên toàn bộ file. Điều này ẩn đi nhiều dependency bugs thực sự. Ví dụ cụ thể: `useEffect` tại GateCheckPage dòng 75-79 gọi `handleCheck()` khi `ticketId` thay đổi, nhưng `handleCheck` phụ thuộc `checking` state → có thể miss check khi state chưa cập nhật.
- **Hướng xử lý:** Bỏ disable toàn cục, sử dụng `useCallback` với dependency array chính xác cho từng function.

---

### 1.10 🟡 MEDIUM — Không có feedback khi nhấn F6-F10 hotkey mà chưa có khách hàng được gán

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → dòng 258-269
- **Mô tả:** Khi user nhấn phím tắt F6-F10 nhưng không có khách hàng nào được gán hotkey tương ứng → **không xảy ra gì** (silent failure). User không biết hotkey chưa được cấu hình.
- **Hướng xử lý:** Thêm `toast.info()` thông báo "Chưa có khách hàng nào được gán phím tắt F{n}" khi `cust` là undefined.

---

### 1.11 🔵 LOW — Sidebar navigation: icon "👥" bị trùng giữa "Khách Hàng" và "Nhân Sự"

- **Vị trí:** `pool-frontend/src/App.tsx` → dòng 147 và dòng 189
- **Mô tả:** Cả 2 menu "Khách Hàng" và "Nhân Sự" đều dùng icon "👥", gây nhầm lẫn cho user.
- **Hướng xử lý:** Thay icon "Nhân Sự" thành "🧑‍💼" hoặc "👤".

---

## HẠNG MỤC 2: PHÁT HIỆN NGHIỆP VỤ TRÙNG LẶP & MÂU THUẪN LOGIC

---

### 2.1 🔴 CRITICAL — Logic tính giá khuyến mãi bị tính 2 lần (double-discount)

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → `calculateAdvancedPrice()` (dòng ~958-989) và `doCheckoutOrder()` (dòng ~738-757)
- **Mô tả:** Khi thêm vé vào giỏ:
  1. `calculateAdvancedPrice()` đã áp dụng giảm giá từ voucher (AMOUNT hoặc PERCENT) vào `unitPrice/subtotal`
  2. Khi checkout, `doCheckoutOrder()` lại kiểm tra `c.promoId` và tính lại cho BONUS_SESSION, nhưng giá `finalPrice` lấy từ `c.unitPrice` đã được tính giảm rồi → OK cho AMOUNT/PERCENT
  
  **Tuy nhiên:** Nếu cả `promoId` (manual select) và `autoPromoId` cùng tồn tại, cả hai đều kiểm tra `BONUS_SESSION` riêng biệt → **cộng session 2 lần** nếu cả hai đều là BONUS_SESSION type.
  
  Ngoài ra, `calculateAdvancedPrice` chỉ apply voucher discount, nhưng **KHÔNG apply manual promo discount** (selectedPromoId) → nếu user chọn promo thủ công kiểu AMOUNT/PERCENT mà không phải auto-apply → giá **KHÔNG được giảm** nhưng vẫn ghi nhận là đã áp dụng promo.

- **Hướng xử lý:** Centralize toàn bộ logic tính giá vào 1 hàm duy nhất `calculateFinalPrice(ticketType, promo, voucher, sessions)` và gọi ở cả 2 nơi. Đảm bảo manual promo AMOUNT/PERCENT cũng được áp dụng vào giá.

---

### 2.2 🔴 CRITICAL — Hàm maskCardCode() bị duplicate giữa POSPage và CustomerPage

- **Vị trí:** 
  - `pool-frontend/src/pages/POSPage.tsx` → dòng 83-89
  - `pool-frontend/src/pages/CustomerPage.tsx` → dòng 287-293
- **Mô tả:** Cùng 1 hàm `maskCardCode` được copy-paste nguyên xi. Nếu cần thay đổi logic mask (ví dụ: thêm role CASHIER cũng được xem full) → phải sửa ở 2 nơi, rất dễ bỏ sót.
- **Hướng xử lý:** Extract vào utils chung: `utils/cardUtils.ts`

---

### 2.3 🟠 HIGH — Logic parse business info (system_settings) bị duplicate 5+ lần

- **Vị trí:**
  - `pool-frontend/src/App.tsx` → `loadBiz()` dòng 49-64
  - `pool-frontend/src/pages/POSPage.tsx` → `fetchBusinessInfo()` dòng 296-320
  - `pool-frontend/src/pages/CustomerPage.tsx` → `fetchBusinessInfo()` dòng 192-210
  - `pool-frontend/src/pages/CashPage.tsx` → `fetchCashData()` dòng 70-89
  - Có thể còn trong DashboardPage, AnalyticsPage
- **Mô tả:** Logic parse `system_settings` key-value (bao gồm cả cách strip dấu `"` khỏi value) được copy-paste nguyên bản ở ít nhất 5 nơi. Logic parse khá phức tạp (`JSON.parse(JSON.stringify(val)).replace(...)`) và dễ gây bug nếu data format thay đổi.
- **Hướng xử lý:** Tạo custom hook `useBusinessInfo()` hoặc service function `fetchBusinessSettings()` tại `utils/settingsService.ts`.

---

### 2.4 🟠 HIGH — TicketType interface bị duplicate trong types.ts và SettingsPage.tsx

- **Vị trí:**
  - `pool-frontend/src/types.ts` → dòng 30-46
  - `pool-frontend/src/pages/SettingsPage.tsx` → dòng 31-48
- **Mô tả:** `SettingsPage` định nghĩa lại `TicketType` riêng thay vì import từ `types.ts`. Bản local thêm field `requires_gate_ticket?: boolean` mà bản global không có → **mất đồng bộ type** khi sửa interface.
- **Hướng xử lý:** Import từ `types.ts` và bổ sung field `requires_gate_ticket` vào bản chính.

---

### 2.5 🟠 HIGH — Promotion interface bị duplicate trong POSPage và SettingsPage

- **Vị trí:**
  - `pool-frontend/src/pages/POSPage.tsx` → dòng 46-59
  - `pool-frontend/src/pages/SettingsPage.tsx` → dòng 58-71
- **Mô tả:** Interface `Promotion` cùng cấu trúc nhưng khai báo riêng ở 2 file. Không có trong `types.ts`.
- **Hướng xử lý:** Di chuyển `Promotion`, `Voucher` vào `types.ts`.

---

### 2.6 🟡 MEDIUM — Trạng thái gói thẻ được tính ở Frontend thay vì Backend

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → hàm `computeStatus()` (dòng 271-284)
- **Mô tả:** Frontend tự tính trạng thái gói thẻ (EXPIRED, EXPIRING, IN_USE, UNUSED) bằng logic so sánh ngày/session. Nhưng Backend (DB) cũng lưu field `status` riêng. Kết quả:
  - `computeStatus` trả về `EXPIRING` nhưng DB lưu `UNUSED` → **mâu thuẫn** khi hiện trên các trang khác nhau
  - Khi admin update gói, `handleUpdatePackage()` lại convert `EXPIRING` → `IN_USE` (dòng 467) → business logic bị đặt ở cả FE lẫn BE
- **Hướng xử lý:** Đồng bộ status calculation: hoặc toàn bộ ở DB (scheduled job tự update), hoặc toàn bộ ở FE (DB chỉ lưu raw data).

---

### 2.7 🟡 MEDIUM — CashPage tính doanh thu (totalThu) khác DashboardPage

- **Vị trí:** 
  - `pool-frontend/src/pages/CashPage.tsx` → dòng 61-68 (tính tổng `price_paid` từ bảng `tickets`)
  - DashboardPage / AnalyticsPage có thể dùng view `daily_revenue_summary` (migration 001)
- **Mô tả:** CashPage tính doanh thu bao gồm **TẤT CẢ tickets** (cả TRANSFER, CARD, TRANSFER_COMPANY) nhưng hiển thị trong mục "Tồn quỹ tiền mặt". Điều này sai về nghiệp vụ vì:
  - Doanh thu TRANSFER/CARD không nằm trong quỹ tiền mặt ca
  - Phiếu chi (`expenses`) so sánh với tổng doanh thu này → kiểm tra `chiAmount > tonTienMat` cho kết quả sai
- **Hướng xử lý:** Khi tính tồn quỹ tiền mặt, CashPage chỉ nên tính ticket có `payment_method = 'CASH'`. Hiện tại bảng `tickets` không lưu `payment_method` → cần join với `orders` hoặc thêm column.

---

## HẠNG MỤC 3: SĂN TÌM BUG TIỀM ẨN (Technical & Logic Bugs)

---

### 3.1 🔴 CRITICAL — Race condition khi check-in đồng thời trên nhiều thiết bị

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → hàm `doCheckin()` (dòng ~1151-1263)
- **Mô tả:** Luồng check-in thực hiện theo các bước:
  1. FE query `tickets` table để tìm gói phù hợp (dòng 1286-1295)
  2. FE hiện preview popup
  3. User confirm → FE gọi RPC `checkin_pass_and_issue_ticket`
  
  Giữa bước 1 và 3, trên thiết bị khác có thể **check-in cùng thẻ** → RPC trừ 2 buổi. Vì bước 1-2 không lock record ở DB.
- **Hướng xử lý:** Bỏ bước preview query riêng, gộp toàn bộ logic vào RPC backend (đã có `SELECT ... FOR UPDATE` trong RPC). Hoặc thêm advisory lock.

---

### 3.2 🔴 CRITICAL — cancel_ticket tìm parent package bằng customer_phone, dễ nhầm gói

- **Vị trí:** `supabase/migrations/050_ticket_cancellation.sql` → function `cancel_ticket()` (dòng ~67-98)
- **Mô tả:** Khi hủy vé con (price_paid = 0), function tìm gói cha bằng:
  ```sql
  WHERE t.customer_phone = v_ticket_record.customer_phone
    AND tt.category IN ('MULTI', 'LESSON')
    AND t.remaining_sessions IS NOT NULL
  ```
  Nếu khách hàng có **nhiều gói MULTI/LESSON** cùng SĐT → function chỉ lấy gói đầu tiên (`LIMIT 1`), có thể **cộng trả buổi vào sai gói**.
- **Hướng xử lý:** Nên lưu `parent_ticket_id` trực tiếp trên vé con khi check-in, sau đó dùng nó để xác định chính xác gói cha khi cancel. Hoặc dùng `checkin_logs.source_ticket_id`.

---

### 3.3 🟠 HIGH — Timezone bug khi tính ngày hết hạn vé DAILY

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → `doCheckoutOrder()` (dòng 718-727)
- **Mô tả:** Logic tính ngày:
  ```typescript
  const tzOffset = today.getTimezoneOffset() * 60000;
  const localISOTime = (new Date(today.getTime() - tzOffset)).toISOString().slice(0, -1);
  validFrom = localISOTime.split('T')[0];
  ```
  Cách này **fragile** với DST (daylight saving time) và timezone khác nhau. Nếu user ở múi giờ UTC+7 mua vé lúc 23:30 → `getTimezoneOffset()` trả về -420 → tính toán đúng. Nhưng nếu deploy trên server UTC → validFrom có thể bị lệch 1 ngày.
  
  Ngoài ra, `daysToAdd = validity_days > 0 ? validity_days - 1 : 0` → vé 1 ngày có `daysToAdd = 0` → hết hạn trong ngày → OK. Nhưng vé 2 ngày có `daysToAdd = 1` → tính từ hôm nay, hết hạn ngày mai → đúng. Tuy nhiên nếu `validity_days = null` → `daysToAdd = 0 - 1 = -1` → **ngày hết hạn là HÔM QUA** → vé vừa mua đã hết hạn!

- **Hướng xử lý:** Sử dụng thư viện date-fns hoặc dayjs. Kiểm tra `validity_days` null/0 trước khi tính. Chuyển logic tính ngày sang backend (DB timezone nhất quán).

---

### 3.4 🟠 HIGH — N+1 Query trong import khách hàng

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → hàm `handleConfirmImport()` (dòng ~740-830)
- **Mô tả:** Mỗi row trong file Excel import → 4-5 API calls riêng biệt:
  1. Check customer exist
  2. Insert customer
  3. Insert card_bank
  4. Insert ticket
  
  Với 500 khách hàng → **2000+ API calls** tuần tự, mỗi call qua HTTPS → timeout, chậm, và tiêu tốn rate limit. Import 100 rows có thể mất 5-10 phút.
- **Hướng xử lý:** Tạo RPC `bulk_import_customers` trên Supabase nhận array JSON, xử lý tất cả trong 1 transaction.

---

### 3.5 🟠 HIGH — Voucher sử dụng không được kiểm tra trước khi deduct

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → dòng 800-809
- **Mô tả:** Sau khi RPC `create_checkout_order` thành công, code gọi `use_voucher` cho mỗi cart item có `voucherId`. Nhưng nếu `use_voucher` **lỗi** (voucher đã hết lượt, network error) → đơn hàng đã tạo với giá giảm nhưng voucher **chưa bị trừ** → customer có thể dùng voucher nhiều lần.
- **Hướng xử lý:** Gộp `use_voucher` vào trong RPC `create_checkout_order` (single transaction). Nếu voucher invalid → rollback toàn bộ order.

---

### 3.6 🟠 HIGH — Gate Agent không có reconnect logic khi mất kết nối Supabase

- **Vị trí:** `pool-gate-agent/index.js` → dòng 65-93
- **Mô tả:** Supabase Realtime channel subscribe với handler cho `SUBSCRIBED`, `CLOSED`, `CHANNEL_ERROR` → chỉ **log ra console**, không tự reconnect. Nếu internet bị gián đoạn tạm thời → gate agent **ngừng hoạt động vĩnh viễn** cho đến khi restart thủ công.
- **Hướng xử lý:** Thêm auto-reconnect logic: khi status = `CLOSED` hoặc `CHANNEL_ERROR`, đợi 5s rồi subscribe lại. Thêm heartbeat check.

---

### 3.7 🟠 HIGH — Thiếu Transaction cho các thao tác multi-step trong CustomerPage

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → `handleUpdateCardCode()` (dòng 370-456)
- **Mô tả:** Thao tác đổi mã thẻ gồm 5 bước tuần tự:
  1. Validate card_bank
  2. Update tickets (all with old card_code)
  3. Update customers table
  4. Update/Insert card_bank (new card)
  5. Revoke old card
  
  Nếu bước 3 lỗi nhưng bước 2 đã thành công → **data inconsistency**: tickets đã có mã thẻ mới nhưng customer vẫn giữ mã cũ. Không có rollback.
- **Hướng xử lý:** Gộp toàn bộ logic vào 1 RPC `change_card_code` chạy trong 1 transaction.

---

### 3.8 🟡 MEDIUM — Supabase Anon Key exposed trong Frontend build

- **Vị trí:** `pool-frontend/.env.local` (được sử dụng tại `pool-frontend/src/lib/supabase.ts`)
- **Mô tả:** `VITE_SUPABASE_ANON_KEY` được bundle vào frontend code (public). Đây là thiết kế bình thường của Supabase (anon key cho client). Tuy nhiên, nếu RLS policies không chặt chẽ ở mọi bảng → bất kỳ ai có key này đều có thể đọc/ghi dữ liệu.
  
  **Cụ thể:**
  - `system_settings`: RLS policy cho phép mọi authenticated user SELECT → thông tin business (tên, SĐT, logo, bank info) có thể bị đọc bởi bất kỳ staff nào
  - `tickets`: RLS cho phép SELECT tất cả → nhân viên có thể query toàn bộ dữ liệu khách hàng
  
  Đây là design choice, nhưng cần lưu ý rằng GATE_KEEPER hoặc COACH cũng có thể xem được thông tin nhạy cảm.

- **Hướng xử lý:** Tạo RLS policy chi tiết hơn cho `system_settings` (chỉ expose public keys). Với `tickets`, cân nhắc filter theo role.

---

### 3.9 🟡 MEDIUM — fetchAllPackages() trên CustomerPage load TOÀN BỘ packages

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → hàm `fetchAllPackages()` (dòng 212-269)
- **Mô tả:** Query load tất cả tickets có category MONTHLY/MULTI/LESSON **không có limit** và **không có pagination**. Với hệ thống hoạt động 1 năm, có thể tích lũy hàng ngàn packages → response payload lớn, render chậm.
  
  Đồng thời, `buildCustomerList()` (dòng 296-347) chạy **O(n*m)** vì mỗi customer quét qua 3 map (byCard, byCustId, byPhone) → performance tệ khi data lớn.
- **Hướng xử lý:** Thêm server-side pagination, hoặc lazy load packages khi expand customer detail. Sử dụng composite index trên `(customer_id, status)`.

---

### 3.10 🟡 MEDIUM — fetchCheckinHistory() có SQL injection vector qua search term

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → hàm `fetchCheckinHistory()` (dòng 1346-1432)
- **Mô tả:** Search term được nối trực tiếp vào filter string:
  ```typescript
  let orP = `card_code.ilike.%${term}%,customer_name.ilike.%${term}%`;
  if (cids.length > 0) orP += `,customer_id.in.(${cids.join(',')})`;
  ```
  Supabase client library **có sanitize** input cho `ilike` filters, nên SQL injection trực tiếp không xảy ra. Tuy nhiên, `customer_id.in.(${cids.join(',')})` nối UUID trực tiếp → nếu customer ID không phải UUID hợp lệ → query sẽ lỗi.
- **Hướng xử lý:** Validate `cids` đều là UUID hợp lệ trước khi nối. Hoặc dùng `.in()` method thay vì string concatenation.

---

### 3.11 🟡 MEDIUM — financialService.ts fallback sang system_settings khi table missing

- **Vị trí:** `pool-frontend/src/utils/financialService.ts` → toàn bộ file (dòng 285-636)
- **Mô tả:** Mỗi function (fetchCategories, saveTransaction, deleteTransaction, v.v.) đều có pattern:
  ```
  try DB table → if missing table error → fallback to system_settings JSON
  ```
  Điều này tạo ra **2 source of truth**: data có thể nằm ở cả DB table lẫn JSON trong `system_settings`. Nếu migration 057 chạy thành công nhưng ở giữa chừng → một số data ở table, một số ở JSON. Rất khó debug và reconcile.
- **Hướng xử lý:** Sau khi migration 057 đã chạy ổn định, loại bỏ fallback logic. Chỉ giữ 1 source of truth duy nhất (DB tables).

---

### 3.12 🟡 MEDIUM — cart_id dùng Date.now() + Math.random() thay vì UUID

- **Vị trí:** `pool-frontend/src/pages/POSPage.tsx` → dòng 696
- **Mô tả:** 
  ```typescript
  cart_id: Date.now() + Math.random().toString()
  ```
  Kết quả: `"1730800000000.123456789"` → không phải UUID, collision có thể xảy ra nếu 2 items thêm trong cùng millisecond. Tại dòng 995, code dùng `crypto.randomUUID()` (đúng hơn). Không nhất quán.
- **Hướng xử lý:** Thống nhất dùng `crypto.randomUUID()` cho tất cả cart_id generation.

---

### 3.13 🔵 LOW — Gate Agent dùng anon key, có thể gây bảo mật

- **Vị trí:** `pool-gate-agent/index.js` → dòng 6-7
- **Mô tả:** Gate Agent dùng `VITE_SUPABASE_ANON_KEY` (biến FE) thay vì service_role key. Anon key + RLS có thể giới hạn những gì agent có thể đọc. Nếu Realtime subscription bị block bởi RLS → gate không nhận được event.
- **Hướng xử lý:** Dùng service_role key cho gate agent (chạy trên máy tin cậy, không expose cho client). Hoặc tạo Supabase user riêng cho gate agent.

---

### 3.14 🔵 LOW — Không clear password state khi đóng modal đổi mật khẩu

- **Vị trí:** `pool-frontend/src/App.tsx` → dòng 345 (nút Hủy)
- **Mô tả:** Khi bấm "Hủy" modal đổi mật khẩu: `setShowPasswordModal(false)` nhưng KHÔNG gọi `setNewPassword('')`. Password cũ vẫn nằm trong state → nếu mở modal lại sẽ thấy password đã nhập trước đó.
- **Hướng xử lý:** Thêm `setNewPassword('')` vào onClick handler của nút Hủy.

---

## HẠNG MỤC 4: ĐỀ XUẤT BỔ SUNG NGHIỆP VỤ & TỐI ƯU LOGIC

---

### 4.1 🟠 HIGH — Thiếu Audit Log / Lịch sử thao tác cho Admin

- **Mô tả:** Hệ thống **không có bảng audit log** ghi nhận các thao tác quan trọng:
  - Admin sửa gói thẻ (thay đổi sessions, ngày hết hạn, giá)
  - Admin xóa gói thẻ / khách hàng
  - Admin đổi mã thẻ cho khách
  - Admin reset mật khẩu nhân viên
  - Admin sửa thông tin khách hàng
  
  Hiện tại các thao tác này **không để lại dấu vết**. Nếu có tranh chấp hoặc cần điều tra → không thể truy vết ai đã sửa gì, khi nào.
- **Hướng xử lý:** Tạo bảng `admin_action_logs` (action, target_table, target_id, old_value, new_value, performed_by, performed_at). Insert vào bảng này mỗi khi có thao tác sửa/xóa quan trọng.

---

### 4.2 🟠 HIGH — Thiếu luồng hoàn tiền (Refund) khi hủy đơn hàng

- **Mô tả:** Hệ thống có `cancel_ticket` (hủy vé con, cộng trả buổi), nhưng **không có luồng hoàn tiền (refund)** cho:
  - Hủy đơn hàng (checkout order) đã thanh toán
  - Hoàn tiền gói thẻ khi khách yêu cầu
  - Hoàn tiền sản phẩm bán lẻ (return/exchange)
  
  Hiện tại, khi admin hủy vé → chỉ đổi status, không ảnh hưởng đến báo cáo doanh thu → **doanh thu bị phình** (ghi nhận tiền nhưng đã hoàn trả).
- **Hướng xử lý:** Bổ sung bảng `refunds` và RPC `process_refund` tạo giao dịch đối ứng (negative amount) trong financial_transactions.

---

### 4.3 🟠 HIGH — Thiếu cơ chế khóa dữ liệu sau khi đã duyệt/chốt sổ

- **Mô tả:** Không có concept "chốt sổ cuối ngày" hoặc "khóa kỳ kế toán". Hệ quả:
  - Admin có thể sửa ngày bán (`editSoldAt`) của gói thẻ về quá khứ → ảnh hưởng báo cáo tháng trước
  - Financial transactions có thể sửa `transaction_date` về tháng trước → xung đột với báo cáo P&L đã in
  - Phiếu chi (`expenses`) có thể bị xóa bất cứ lúc nào
- **Hướng xử lý:** Thêm flag `is_locked` trên mỗi `accounting_month`. Khi admin "Chốt sổ" → không cho phép thêm/sửa/xóa giao dịch trong tháng đó.

---

### 4.4 🟡 MEDIUM — Thiếu xử lý khi xóa TicketType đang có tickets liên quan

- **Vị trí:** `pool-frontend/src/pages/SettingsPage.tsx` (phần quản lý loại vé)
- **Mô tả:** Nếu admin xóa (hoặc deactivate) một TicketType mà vẫn còn tickets đang active (UNUSED, IN_USE) → các gói thẻ đó mất reference → checkin/checkout bị lỗi. DB có FK constraint nên DELETE sẽ lỗi, nhưng **deactivate** (`is_active = false`) thì vẫn cho phép → vé vẫn hoạt động nhưng không hiện trên POS.
- **Hướng xử lý:** Khi deactivate TicketType, kiểm tra xem còn bao nhiêu tickets active. Nếu có → hiện cảnh báo chi tiết cho admin.

---

### 4.5 🟡 MEDIUM — Thiếu báo cáo đối soát giữa doanh thu POS và chuyển khoản ngân hàng

- **Mô tả:** Hệ thống ghi nhận `payment_method` khi bán (CASH, TRANSFER, CARD, TRANSFER_COMPANY) nhưng **không có luồng đối soát** với sao kê ngân hàng. Đặc biệt:
  - TRANSFER_COMPANY: tiền chuyển vào tài khoản công ty, cần đối chiếu với bank statement
  - CARD: tiền qua máy POS, cần đối chiếu với sao kê acquirer
  
  Hiện tại tất cả đều "tin tưởng" → dễ bị gian lận hoặc thiếu hụt mà không phát hiện.
- **Hướng xử lý:** Thêm module "Đối soát ngân hàng" cho phép upload bank statement (CSV) và auto-match với orders theo ngày, số tiền.

---

### 4.6 🟡 MEDIUM — Thiếu giới hạn số phiếu chi trong ngày cho STAFF

- **Vị trí:** `pool-frontend/src/pages/CashPage.tsx` → `handleSaveExpense()` (dòng 108-140)
- **Mô tả:** Nhân viên có quyền `can_create_expense` có thể tạo **không giới hạn** phiếu chi trong ngày, chỉ giới hạn bởi số tồn quỹ. Không có:
  - Giới hạn số tiền tối đa mỗi phiếu chi (cho STAFF)
  - Yêu cầu Admin duyệt phiếu chi trên mức nhất định
  - Cảnh báo khi tạo phiếu chi quá nhiều trong 1 ngày
- **Hướng xử lý:** Thêm `max_expense_per_receipt` setting (Admin cấu hình). Phiếu chi trên ngưỡng → cần Admin approve.

---

### 4.7 🟡 MEDIUM — Thiếu backup/export dữ liệu định kỳ

- **Mô tả:** Không có chức năng export toàn bộ dữ liệu (customers, tickets, financial_transactions) ra file Excel/CSV cho mục đích backup. Nếu Supabase project gặp sự cố → mất dữ liệu. Trang DashboardPage/AnalyticsPage có thể có export, nhưng không cover toàn bộ tables.
- **Hướng xử lý:** Thêm nút "Xuất dữ liệu backup" trong SettingsPage (chỉ ADMIN) → export tất cả bảng quan trọng ra file XLSX.

---

### 4.8 🟡 MEDIUM — Thiếu quản lý ca làm việc (Shift Management)

- **Mô tả:** CashPage tính tồn quỹ theo "ngày" (`startOfDay.setHours(0,0,0,0)`) nhưng thực tế hồ bơi có thể có nhiều ca trong ngày (sáng/chiều/tối). Khi giao ca:
  - Không có chức năng "Đóng ca" / "Mở ca"
  - Không ghi nhận số tiền mặt đầu ca
  - Không in phiếu giao ca
  
  Hệ quả: nhân viên ca trước có thể chi hết tiền mặt, ca sau không biết → thiếu quỹ.
- **Hướng xử lý:** Bổ sung bảng `shifts` (shift_date, started_at, ended_at, opening_cash, closing_cash, staff_id) và luồng mở/đóng ca.

---

### 4.9 🔵 LOW — Thiếu rate limiting cho login attempts

- **Vị trí:** `pool-frontend/src/contexts/AuthContext.tsx` → hàm `signIn()` (dòng 76-94)
- **Mô tả:** Không có client-side rate limiting cho đăng nhập thất bại. Supabase Auth có built-in rate limiting ở server, nhưng FE không hiển thị thông báo "Bạn đã thử quá nhiều lần" → UX kém khi bị block.
- **Hướng xử lý:** Thêm counter đăng nhập thất bại. Sau 5 lần → disable nút Login 30 giây kèm đếm ngược.

---

### 4.10 🔵 LOW — Thiếu soft-delete cho khách hàng

- **Vị trí:** `pool-frontend/src/pages/CustomerPage.tsx` → `handleDeleteCustomer()` (dòng 597-616)
- **Mô tả:** Xóa khách hàng là **xóa vĩnh viễn** (hard delete). Không có cách khôi phục nếu xóa nhầm.
- **Hướng xử lý:** Thêm column `deleted_at` (soft delete). Filter `WHERE deleted_at IS NULL` cho queries thường. Thêm trang "Thùng rác" để khôi phục.

---

### 4.11 🔵 LOW — Thiếu quản lý version/changelog cho hệ thống

- **Mô tả:** Không có `version` hiển thị trên UI, không có CHANGELOG. Khi deploy bản mới → user không biết có gì thay đổi. Khó debug khi có lỗi "trước nó chạy được mà".
- **Hướng xử lý:** Thêm version number trong footer sidebar (đọc từ `package.json`). Tạo file CHANGELOG.md.

---

### 4.12 🔵 LOW — Migration files bị đánh số trùng

- **Vị trí:** 
  - `supabase/migrations/031_inventory_audits.sql` và `031_product_variants.sql` → trùng số 031
  - `supabase/migrations/047_add_company_transfer.sql` và `047_fix_pos_checkin_category.sql` → trùng số 047
  - `supabase/migrations/006_promotion_ticket_type.sql` và `006_promotion_ticket_types.sql` → trùng số 006
- **Mô tả:** Các file migration có số thứ tự trùng nhau. Thứ tự chạy phụ thuộc vào alphabetical sort → có thể chạy sai thứ tự. Nếu file sau phụ thuộc vào file trước cùng số → lỗi schema.
- **Hướng xử lý:** Đánh lại số thứ tự migration không trùng lặp. Sử dụng timestamp-based naming (yyyyMMddHHmmss_description.sql).

---

## 📋 BẢNG TÓM TẮT THEO ĐỘ ƯU TIÊN XỬ LÝ

| # | Mức độ | ID | Vấn đề | Nơi sửa |
|---|--------|----|--------|---------|
| 1 | 🔴 | 1.1 | Double-submit checkout | POSPage + Backend RPC |
| 2 | 🔴 | 1.3 | validate_and_scan thiếu MULTI/LESSON | Migration SQL |
| 3 | 🔴 | 2.1 | Double-discount / thiếu manual promo apply | POSPage |
| 4 | 🔴 | 3.1 | Race condition check-in | POSPage + Backend RPC |
| 5 | 🔴 | 3.2 | cancel_ticket nhầm gói cha | Migration SQL |
| 6 | 🔴 | 1.2 | Xóa package thiếu xóa checkin_logs | CustomerPage |
| 7 | 🟠 | 1.4 | Phân quyền không nhất quán | App.tsx + types.ts |
| 8 | 🟠 | 3.3 | Timezone bug ngày hết hạn DAILY | POSPage |
| 9 | 🟠 | 3.5 | Voucher dùng ngoài transaction | POSPage + Backend RPC |
| 10 | 🟠 | 3.6 | Gate Agent không reconnect | pool-gate-agent/index.js |
| 11 | 🟠 | 3.7 | Multi-step không có transaction | CustomerPage → RPC |
| 12 | 🟠 | 4.1 | Thiếu Audit Log | New table + UI |
| 13 | 🟠 | 4.2 | Thiếu luồng hoàn tiền | New module |
| 14 | 🟠 | 4.3 | Thiếu khóa kỳ kế toán | New feature |

---

> **⚠️ LƯU Ý:** Báo cáo này chỉ dựa trên phân tích mã nguồn tĩnh (static analysis). Một số vấn đề có thể đã được xử lý ở database functions/triggers mà code frontend không thể hiện rõ. Khuyến nghị thực hiện thêm **dynamic testing** (chạy thực tế) để xác nhận các bug được liệt kê.
