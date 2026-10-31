@echo off
rem Stops QA Pilot. Your data is kept for next time.
cd /d "%~dp0"
docker compose --profile demo stop
echo.
echo QA Pilot is stopped.
pause
