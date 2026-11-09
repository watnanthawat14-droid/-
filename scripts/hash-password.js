// ใช้ตั้งรหัสผ่านแอดมินคนแรก:  node scripts/hash-password.js "รหัสผ่านอย่างน้อย12ตัว"
// แล้วนำ salt ไปวางที่คอลัมน์ PasswordSalt และ hash ไปวางที่ PasswordHash ในชีต Users
const crypto = require('crypto');
const { hashPassword } = require('../lib/core');
const pw = process.argv[2];
if (!pw || pw.length < 12) { console.error('ต้องระบุรหัสผ่านอย่างน้อย 12 ตัวอักษร'); process.exit(1); }
const salt = crypto.randomUUID() + crypto.randomUUID();
console.log('PasswordSalt:', salt);
console.log('PasswordHash:', hashPassword(pw, salt));
