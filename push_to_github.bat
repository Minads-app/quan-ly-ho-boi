@echo off
echo Đang thêm tất cả thay đổi...
git add .
echo.

echo Đang tạo commit mới...
for /f "tokens=2 delims==" %%I in ('wmic os get localdatetime /value') do set datetime=%%I
set "timestamp=%datetime:~0,4%-%datetime:~4,2%-%datetime:~6,2% %datetime:~8,2%:%datetime:~10,2%:%datetime:~12,2%"
git commit -m "Auto-commit: %timestamp%"
echo.

echo Đang đẩy code lên GitHub...
git push origin main
REM Nếu nhánh chính của anh không phải là main mà là master, hãy thay chữ main ở trên thành master nhé.

echo.
echo HOÀN THÀNH! Nhấn phím bất kỳ để thoát.
pause >nul
