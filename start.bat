@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Enrollment Assistant
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js - กรุณาติดตั้งรุ่น LTS จาก https://nodejs.org แล้วเปิดไฟล์นี้ใหม่
  pause
  exit /b 1
)
if not exist node_modules (
  echo กำลังติดตั้งส่วนประกอบครั้งแรก กรุณารอสักครู่...
  call npm install --no-fund --no-audit
  if errorlevel 1 (
    echo ติดตั้งไม่สำเร็จ - ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่
    pause
    exit /b 1
  )
)
call npm start
pause
