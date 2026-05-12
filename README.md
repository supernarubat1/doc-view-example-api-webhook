# SST Customer Simulator (Node.js)

นี่คือโปรเจกต์ตัวอย่าง (Reference Implementation) สำหรับลูกค้าที่ต้องการเชื่อมต่อกับระบบ SST ทั้งในส่วนของการรับ **Webhook** และการเรียกใช้งาน **External API**

## 🏗️ โครงสร้างโปรเจกต์
- `src/index.ts`: ไฟล์หลักที่รวม Logic การรับ Webhook, การตรวจสอบ Signature (HMAC SHA256) และการเรียก API
- `.env`: ไฟล์สำหรับตั้งค่า Credentials (Customer ID / Secret Key / Webhook Secret)

## 🚀 เริ่มต้นใช้งาน

### 1. ติดตั้ง Dependencies
```bash
npm install
```

### 2. ตั้งค่า Environment Variables
Copy ไฟล์ `.env.example` ไปเป็น `.env` และใส่ค่าที่ได้รับจากหน้า Portal:
```bash
cp .env.example .env
```
ค่าที่ต้องใส่:
- `SST_WEBHOOK_SECRET`: สำหรับตรวจสอบความถูกต้องของ Webhook
- `SST_CUSTOMER_ID`: ID ลูกค้าที่ได้จากหน้าจอ Webhook Settings
- `SST_SECRET_KEY`: Secret Key สำหรับเรียก External API

### 3. รันระบบ (Development Mode)
```bash
npm run dev
```
ระบบจะเปิดทำงานที่ `http://localhost:4000`

## 💡 หัวใจสำคัญในการเชื่อมต่อ

### 1. การตรวจสอบ Webhook Signature (Security)
เพื่อให้มั่นใจว่าข้อมูลมาจาก SST จริงๆ คุณ **ต้อง** ตรวจสอบ Signature ทุกครั้ง โดยใช้ `HMAC SHA256` และ `Webhook Secret` ของคุณเปรียบเทียบกับ Header `X-Webhook-Signature`

### 2. การตอบกลับ Webhook (Acknowledge)
ควรตอบกลับสถานะ `200 OK` ให้ระบบหลักทันทีที่ได้รับข้อมูล (ก่อนประมวลผล Logic หนักๆ) เพื่อป้องกันไม่ให้เกิด Timeout ในฝั่งของ SST

### 3. การเรียก External API
ใช้ `X-Customer-ID` และ `X-Secret-Key` ในการยืนยันตัวตนผ่าน HTTP Headers ทุกครั้งที่เรียก API

---
*หมายเหตุ: โค้ดนี้เป็นเพียงตัวอย่างเบื้องต้น สำหรับการใช้งานบน Production แนะนำให้มีการจัดการ Error Handling และ Logging ที่ละเอียดขึ้นตามมาตรฐานขององค์กรท่าน*
