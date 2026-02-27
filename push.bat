@echo off
chcp 65001 >nul
cd /d "d:\2. HYMINH\PHẦN MỀM\PHAN MEM VE BOI"
echo === Dang push code len Vercel... ===
git add -A
git commit -m "fix: all fixes - font, permissions, labels, canView"
git push
echo.
echo === PUSH THANH CONG! ===
echo Doi 1-2 phut de Vercel deploy xong.
echo Sau do bam Ctrl+Shift+R tren trinh duyet de tai lai.
pause
