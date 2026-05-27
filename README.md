# SST Customer Simulator (Node.js)

โปรเจกต์ตัวอย่าง (Reference Implementation) สำหรับลูกค้าที่ต้องการเชื่อมต่อกับระบบ SST ครอบคลุมทั้งการรับ **Webhook** และการเรียกใช้งาน **External API** ทุก endpoint

---

## 🏗️ โครงสร้างโปรเจกต์

```
customer-simulator/
├── src/
│   └── index.ts        # ไฟล์หลัก — รวม Logic ทั้งหมด
├── downloads/          # โฟลเดอร์เก็บไฟล์ที่ดาวน์โหลด (สร้างอัตโนมัติ)
├── .env                # ค่า Credentials (ห้าม commit)
├── .env.example        # ตัวอย่างค่า .env
└── package.json
```

---

## 🚀 เริ่มต้นใช้งาน

### 1. ติดตั้ง Dependencies

```bash
npm install
```

### 2. ตั้งค่า Environment Variables

```bash
cp .env.example .env
```

แก้ไขค่าใน `.env`:

```env
SST_API_URL=http://localhost:3000
SST_CUSTOMER_ID=your_customer_id_here
SST_SECRET_KEY=your_secret_key_here
SST_WEBHOOK_SECRET=your_webhook_secret_here
PORT=4000
```

### 3. รันระบบ

```bash
npm run dev
```

ระบบจะเปิดที่ `http://localhost:4000`

---

## 📡 Endpoints ที่มีให้ทดสอบ

| Method   | URL                             | คำอธิบาย                              |
| -------- | ------------------------------- | ------------------------------------- |
| `GET`    | `/api/health-check`             | ตรวจสอบ Credentials และสถานะ API      |
| `GET`    | `/api/folders`                  | ดึงรายการโฟลเดอร์ทั้งหมด              |
| `GET`    | `/api/folders/:id`              | ดึงรายละเอียดโฟลเดอร์ + Download URLs |
| `GET`    | `/api/folders/:id/files`        | ดึงรายการไฟล์ใน folder (filter ได้)   |
| `GET`    | `/api/folders/:id/download-all` | ดาวน์โหลดทุกไฟล์ใน folder ลง disk     |
| `GET`    | `/api/usage`                    | สถิติการใช้งาน Quota ย้อนหลัง 30 วัน  |
| `GET`    | `/api/activity-actions`         | รายการ action codes ที่กรองได้        |
| `GET`    | `/api/activities`               | ดึงประวัติกิจกรรม                     |
| `GET`    | `/api/activities/:id`           | ดึงรายละเอียดกิจกรรมเดี่ยว            |
| `GET`    | `/api/webhook-config`           | ดูการตั้งค่า Webhook ปัจจุบัน         |
| `POST`   | `/api/webhook-config`           | สร้าง/แก้ไข Webhook URL และ Secret    |
| `POST`   | `/api/webhook-test`             | ส่ง Ping ทดสอบ Webhook                |
| `DELETE` | `/api/webhook-config`           | ปิดการใช้งาน Webhook                  |
| `POST`   | `/api/webhook`                  | รับ Webhook Event จาก SST             |

---

## 💡 ตัวอย่างการใช้งาน (cURL)

### ตรวจสอบ Credentials

```bash
curl http://localhost:4000/api/health-check
```

### ดึงรายการโฟลเดอร์

```bash
curl "http://localhost:4000/api/folders?status=READY&page=1"
```

ตัวอย่าง Response:

```json
{
  "data": [
    {
      "id": "550e8400-...",
      "code": "F001",
      "name": "เอกสารฝ่ายการตลาด Q2",
      "status": "READY",
      "fileCount": 12,
      "totalSizeBytes": 24560000,
      "createdAt": "2024-05-01T08:30:00Z",
      "expiresAt": "2024-12-31T23:59:59Z",
      "visibility": "ALL",
      "isUnlimited": false,
      "template": { "id": "temp_456", "name": "แบบฟอร์มใบแจ้งหนี้" },
      "notification": {
        "isExpireNoticeEnabled": true,
        "expireNoticeUserIds": ["user_001"]
      }
    }
  ],
  "pagination": { "total": 330, "page": 1, "limit": 100, "totalPages": 4 }
}
```

### ดึงรายละเอียดโฟลเดอร์ (พร้อม Download URLs)

```bash
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE?filePage=1"
```

### ดึงรายการไฟล์ใน folder (filter ได้)

```bash
# ดึงหน้าที่ 2
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?filePage=2"

# ค้นหาจากชื่อไฟล์
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?search=invoice"

# filter จาก indexData
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?indexKey=invoice_no&indexValue=INV-2024"
```

### ดูสถิติการใช้งาน Quota

```bash
curl http://localhost:4000/api/usage
```

### ดาวน์โหลดทุกไฟล์ใน folder (บันทึกลง ./downloads/)

ใช้ endpoint ใหม่ — ได้ Presigned URL ทุกไฟล์ใน **1 request** กิน quota แค่ 1 ครั้ง:

```bash
curl http://localhost:4000/api/folders/FOLDER_ID_HERE/download-all
```

ตัวอย่าง Response:

```json
{
  "success": true,
  "totalFiles": 8,
  "successCount": 8,
  "failCount": 0,
  "savedTo": "D:\\...\\downloads\\FOLDER_ID_HERE"
}
```

### ดึงประวัติกิจกรรม

```bash
curl "http://localhost:4000/api/activities?page=1"

# กรองตาม action
curl "http://localhost:4000/api/activities?action=FETCH_FOLDER_LIST,DOWNLOAD_FILE"

# กรองตามช่วงวันที่
curl "http://localhost:4000/api/activities?startDate=2024-01-01&endDate=2024-12-31"
```

### ดูการตั้งค่า Webhook

```bash
curl http://localhost:4000/api/webhook-config
```

### สร้าง/แก้ไข Webhook

```bash
curl -X POST http://localhost:4000/api/webhook-config \
  -H "Content-Type: application/json" \
  -d '{"url":"https://your-server.com/webhook","secret":"your_secret"}'
```

### ทดสอบ Webhook (Ping)

```bash
curl -X POST http://localhost:4000/api/webhook-test
```

### ปิดการใช้งาน Webhook

```bash
curl -X DELETE http://localhost:4000/api/webhook-config
```

---

## 🔐 หัวใจสำคัญในการเชื่อมต่อ

### 1. Webhook Signature Verification

ทุกครั้งที่รับ Webhook ต้องตรวจสอบ `X-Webhook-Signature` ด้วย HMAC SHA256:

```typescript
const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
const digest = hmac.update(rawBody).digest('hex');
if (signature !== digest) return res.status(401).json({ error: 'Invalid signature' });
```

### 2. ตอบกลับ 200 OK ทันที

ตอบกลับก่อนประมวลผล Logic หนักๆ เพื่อป้องกัน Timeout:

```typescript
res.json({ received: true }); // ตอบก่อน
processAsync(payload); // ค่อยทำงานหนักทีหลัง
```

### 3. ดาวน์โหลดหลายไฟล์พร้อมกัน (Parallel Download)

ใช้ `files[].downloadUrl` จาก Folder Detail API แล้ว parallel download:

```typescript
await Promise.all(
  files
    .filter((f: any) => f.downloadUrl)
    .map(({ name, downloadUrl }: any) =>
      fetch(downloadUrl)
        .then((r) => r.blob())
        .then((blob) => saveFile(blob, name)),
    ),
);
```

### 4. Pagination ของไฟล์ใน Folder

ถ้า folder มีไฟล์มากกว่า 100 ต้องวนลูปดึงทุกหน้า:

```typescript
const { totalPages } = firstPage.data.data.filesPagination;
// ดึงหน้า 2, 3, ... จนครบ totalPages
```

### 5. Webhook Events ที่รองรับ

| Event              | คำอธิบาย                                      |
| ------------------ | --------------------------------------------- |
| `FOLDER_PUBLISHED` | โฟลเดอร์ถูกเผยแพร่ — ดึงไฟล์ไปประมวลผลได้เลย  |
| `FOLDER_EXPIRED`   | โฟลเดอร์หมดอายุ — ลบ cache หรือแจ้งเตือน user |
| `FOLDER_REVOKED`   | โฟลเดอร์ถูกยกเลิก — ลบ access ฝั่งตัวเอง      |
| `PING`             | ทดสอบการเชื่อมต่อ — ตอบกลับ 200 OK เท่านั้น   |

---

## 📁 ไฟล์ที่ดาวน์โหลด

เมื่อเรียก `GET /api/folders/:id/download-all` ไฟล์จะถูกบันทึกที่:

```
downloads/
└── <folderId>/
    ├── invoice_jan.pdf
    ├── invoice_feb.pdf
    └── ...
```

> **หมายเหตุ:** ใน Production จริง ไม่จำเป็นต้องบันทึกลง disk — สามารถนำ `downloadUrl` จาก `GET /api/external/folders/{id}/download-all` ไปประมวลผลต่อได้เลย เช่น ส่งต่อไป S3, เข้า Queue, หรือ stream ไปยัง client โดยตรง

---

_หมายเหตุ: โค้ดนี้เป็นตัวอย่างเบื้องต้น สำหรับ Production แนะนำให้เพิ่ม Error Handling, Retry Logic, Queue System และ Logging ตามมาตรฐานขององค์กร_
