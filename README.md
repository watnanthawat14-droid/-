# ระบบค่าบริการทำบัญชี — Vercel

โครงสร้าง: `public/index.html` (หน้าเว็บเดิม) · `api/rpc.js` (API) · `lib/core.js` (ตรรกะเดิมที่แปลงจาก Apps Script)

## ตั้งค่า (ทำครั้งเดียว)
1. Google Cloud → เปิด **Google Sheets API** → สร้าง **Service Account** → สร้าง key แบบ JSON
2. เปิด Google Sheet เดิม → Share ให้อีเมลของ service account (`...iam.gserviceaccount.com`) สิทธิ์ **Editor**
3. Vercel → Settings → Environment Variables:
   - `GOOGLE_SERVICE_ACCOUNT` = เนื้อหาไฟล์ JSON ทั้งก้อน
   - `SHEET_ID` = ส่วนที่อยู่ใน URL ของชีต `/d/<SHEET_ID>/edit`
   - `SESSION_SECRET` = ข้อความสุ่มยาว 32 ตัวขึ้นไป
4. `npm i -g vercel` แล้วรัน `vercel --prod` (หรือ push ขึ้น GitHub แล้ว import)

## ผู้ใช้/รหัสผ่านเดิม
ใช้ชีต Users เดิมได้เลย รหัสผ่านเดิมยังใช้ได้ (อัลกอริทึม hash เหมือนเดิม)
ถ้าเริ่มชีตใหม่: ใส่แถวแอดมินในชีต Users (Email, Role=admin, Active=TRUE) แล้วรัน
`node scripts/hash-password.js "รหัสผ่าน12ตัวขึ้นไป"` นำ salt/hash ไปวางในคอลัมน์ PasswordSalt/PasswordHash
