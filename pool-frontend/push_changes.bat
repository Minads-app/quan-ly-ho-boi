@echo off
rem =============================================
rem Batch script to add, commit, and push changes to the repository
rem Place this file in the root of your project (pool-frontend) and run it
rem Ensure that git is installed and you have configured credentials (SSH or HTTPS)
rem =============================================

rem Change directory to script location (project root)
cd /d "%~dp0"

rem Show git status (optional)
echo Checking git status...
git status

rem Stage all changes
echo Adding changes...
git add .

rem Commit with a default message (edit as needed)
set "COMMIT_MSG=Integrate Basketball course management"
git commit -m "%COMMIT_MSG%"

rem Push to remote (default branch assumed main)
echo Pushing to remote...
git push origin HEAD

if %errorlevel% neq 0 (
    echo Error: Push failed. Check your network connection and authentication.
) else (
    echo Push completed successfully.
)

pause
