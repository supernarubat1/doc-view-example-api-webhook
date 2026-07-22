# SST Customer Simulator (Node.js)

โปรเจกต์ตัวอย่าง (Reference Implementation) สำหรับลูกค้าที่ต้องการเชื่อมต่อกับระบบ SST ครอบคลุมทั้งการรับ **Webhook** และการเรียกใช้งาน **External API** ทุก endpoint

> **จุดประสงค์:** ใช้เพื่อทดสอบและทำความเข้าใจการทำงานของ API ก่อนนำไปพัฒนาในระบบจริง ไม่ใช่ Production-ready code

---

## 🏗️ โครงสร้างโปรเจกต์

```
customer-simulator/
├── src/
│   └── index.ts        # ไฟล์หลัก — รวม Logic ทั้งหมด
├── downloads/          # โฟลเดอร์เก็บไฟล์ที่ดาวน์โหลด (สร้างอัตโนมัติ)
├── .env                # ค่า Credentials (ห้าม commit ขึ้น Git)
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

แก้ไขค่าใน `.env` ให้ตรงกับข้อมูลจากหน้า Portal:

```env
# URL ของ web-app SST (ค่าเริ่มต้นสำหรับ local)
SST_API_URL=http://localhost:3000

# Customer ID — ดูได้จากหน้า "ตั้งค่า API" ใน Portal
SST_CUSTOMER_ID=your_customer_id_here

# Secret Key — ได้รับทางอีเมลหลังจาก Admin อนุมัติ
SST_SECRET_KEY=your_secret_key_here

# Webhook Secret — ตั้งเองได้ ใช้สำหรับตรวจสอบ Signature ของ Webhook ที่รับเข้ามา
# ⚠️ ต้องใช้ค่าเดียวกันนี้ตอนตั้งค่า Webhook ผ่าน POST /api/webhook-config
SST_WEBHOOK_SECRET=your_webhook_secret_here

# พอร์ตที่ simulator จะรัน
PORT=4000
```

> **สำคัญ:** `SST_WEBHOOK_SECRET` คือรหัสที่คุณกำหนดเองสำหรับตรวจสอบว่า Webhook ที่รับเข้ามานั้นมาจาก SST จริงๆ ต้องใช้ค่าเดียวกันทั้งใน `.env` และตอนตั้งค่า Webhook

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
| `POST`   | `/api/webhook-test`             | ส่ง TEST_CONNECTION ทดสอบ Webhook     |
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
# ดึงทุกสถานะ (default)
curl "http://localhost:4000/api/folders"

# กรองเฉพาะ READY
curl "http://localhost:4000/api/folders?status=READY&page=1"

# กรองตามช่วงวันที่
curl "http://localhost:4000/api/folders?startDate=2024-01-01&endDate=2024-12-31"
```

**สถานะที่มี:**

- `READY` — เผยแพร่แล้ว เข้าถึงได้
- `DRAFT` — ลูกค้าสร้างเองยังไม่ publish (เข้าถึง detail ไม่ได้)
- `PROCESSING` — Admin กำลังดำเนินการ (เข้าถึง detail ไม่ได้)
- `EXPIRED` — หมดอายุแล้ว
- `REVOKED` — ถูกยกเลิก

### ดึงรายละเอียดโฟลเดอร์ (พร้อม Download URLs)

```bash
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE?page=1"
```

> **หมายเหตุ:** โฟลเดอร์ที่มีสถานะ `DRAFT` หรือ `PROCESSING` จะได้รับ 403 กลับมา ต้องรอจนกว่าจะถูก publish เป็น `READY`

แต่ละไฟล์ใน response จะมี `downloadUrl` ที่เป็น Presigned URL สำหรับดาวน์โหลดโดยตรงจาก Storage **URL มีอายุ 1 ชั่วโมง** ควรดาวน์โหลดทันทีหลังได้รับ

### ดึงรายการไฟล์ใน folder (filter ได้)

```bash
# ดึงหน้าที่ 2 (ถ้ามีไฟล์มากกว่า 100)
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?page=2"

# ค้นหาจากชื่อไฟล์
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?search=invoice"

# filter จาก indexData (ต้องใส่ทั้ง indexKey และ indexValue คู่กัน)
curl "http://localhost:4000/api/folders/FOLDER_ID_HERE/files?indexKey=invoice_no&indexValue=INV-2024"
```

endpoint นี้เหมาะสำหรับดึงไฟล์หน้าถัดไปโดยไม่ต้องดึง metadata ของ folder ซ้ำ

### ดูสถิติการใช้งาน Quota

```bash
curl http://localhost:4000/api/usage
```

แสดงการใช้งาน quota วันนี้และย้อนหลัง 30 วัน รวมถึง peak day และค่าเฉลี่ย

> **หมายเหตุเรื่องสิทธิ์:** External API ใช้สิทธิ์ระดับบริษัท เมื่อใช้ `SST_CUSTOMER_ID` และ `SST_SECRET_KEY` ถูกต้อง จะเรียกดูข้อมูลของบริษัทนั้นตามขอบเขต API ได้ทั้งหมด ไม่ได้จำกัดตามสิทธิ์การมองเห็นรายผู้ใช้งานในหน้าเว็บ

---

### ดาวน์โหลดทุกไฟล์ใน folder (บันทึกลง ./downloads/)

simulator จะดึง Presigned URL ทุกไฟล์ (วนลูปทุกหน้าถ้ามีมากกว่า 100) แล้ว parallel download ลง disk:

```bash
curl http://localhost:4000/api/folders/FOLDER_ID_HERE/download-all
```

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
# ดึงทั้งหมด
curl "http://localhost:4000/api/activities?page=1"

# กรองตาม action key (ดู action codes ได้จาก /api/activity-actions)
curl "http://localhost:4000/api/activities?actionKey=FETCH_FOLDER_LIST,DOWNLOAD_FILE"

# กรองตามหมวดหมู่หรือกลุ่ม
curl "http://localhost:4000/api/activities?categoryKey=DOCUMENT&groupKey=DOWNLOAD"

# กรองตามช่วงวันที่
curl "http://localhost:4000/api/activities?startDate=2024-01-01&endDate=2024-12-31"
```

### ดึงรายละเอียดกิจกรรมเดี่ยว

```bash
curl "http://localhost:4000/api/activities/ACTIVITY_ID_HERE"
```

### ดู action codes ที่กรองได้

```bash
curl http://localhost:4000/api/activity-actions
```

คุณสามารถนำค่า `code` ที่ได้จาก API นี้ ไปใช้เป็นพารามิเตอร์ `actionKey` สำหรับกรองข้อมูลเมื่อเรียกใช้งาน `/api/activities` (ตัวอย่างเช่น `?actionKey=DOWNLOAD_FILE`)

---

## 🔔 การตั้งค่า Webhook (ขั้นตอนสำคัญ)

Webhook คือระบบที่ SST จะ **ส่งข้อมูลมาหาคุณเอง** เมื่อมีเหตุการณ์เกิดขึ้น เช่น โฟลเดอร์ถูกเผยแพร่ แทนที่คุณจะต้องคอย pull ถามตลอดเวลา

### ขั้นตอนที่ 1 — ตรวจสอบว่า simulator รันอยู่

simulator ต้องเปิดอยู่ที่ port 4000 เพราะ SST จะส่ง request ทดสอบการเชื่อมต่อก่อนบันทึก

> ถ้าทดสอบกับ SST production ห้ามใช้ `localhost` เป็น Webhook URL เพราะ production จะบล็อก private/internal host เพื่อความปลอดภัย ให้ใช้ public HTTPS URL หรือ tunnel สำหรับทดสอบแทน เช่น ngrok/cloudflared

### ขั้นตอนที่ 2 — ตั้งค่า Webhook

```bash
curl -X POST http://localhost:4000/api/webhook-config \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://localhost:4000/api/webhook",
    "secret": "your_webhook_secret_here",
    "events": ["FOLDER_PUBLISHED", "FOLDER_REVOKED", "FOLDER_EXPIRED"]
  }'
```

> **⚠️ สำคัญมาก:** `secret` ที่ส่งมาใน body **ต้องตรงกับ** `SST_WEBHOOK_SECRET` ใน `.env` ของ simulator
>
> เพราะ SST จะใช้ secret นี้ sign payload ทดสอบการเชื่อมต่อแล้วส่งมาให้ simulator ตรวจสอบ ถ้าไม่ตรงกัน simulator จะตอบ 401 และ SST จะ reject การตั้งค่า

> **💡 เกี่ยวกับ `events`:** ถ้าไม่ระบุ SST จะ Default ส่งเฉพาะ `FOLDER_PUBLISHED` เท่านั้น หากต้องการรับ Event อื่นๆ ด้วย ต้องระบุใน field `events` ทุกครั้งที่ upsert เพราะระบบจะใช้ค่าใน body เสมอ

**ครั้งแรก** = สร้างใหม่, **ครั้งถัดไป** = อัปเดตค่าเดิม (upsert)

ถ้าต้องการ **อัปเดต URL แต่ไม่เปลี่ยน secret** ให้ส่ง `secret` เป็นค่าว่าง `""` หรือไม่ส่งมาเลย ระบบจะคงค่า secret เดิมไว้:

```bash
curl -X POST http://localhost:4000/api/webhook-config \
  -H "Content-Type: application/json" \
  -d '{
    "url": "http://new-url.com/webhook",
    "secret": "",
    "events": ["FOLDER_PUBLISHED", "FOLDER_REVOKED", "FOLDER_EXPIRED"]
  }'
```

### ขั้นตอนที่ 3 — ทดสอบการเชื่อมต่อ

```bash
curl -X POST http://localhost:4000/api/webhook-test
```

SST จะส่ง `TEST_CONNECTION` มาที่ URL ที่ตั้งไว้ ถ้า simulator ตอบ 200 OK แสดงว่าพร้อมรับ Webhook แล้ว

### ขั้นตอนที่ 4 — ดูการตั้งค่าปัจจุบัน

```bash
curl http://localhost:4000/api/webhook-config
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
const hmac = crypto.createHmac("sha256", WEBHOOK_SECRET);
const digest = hmac.update(rawBody).digest("hex");
if (signature !== digest)
  return res.status(401).json({ error: "Invalid signature" });
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

ถ้า folder มีไฟล์มากกว่า 100 ต้องวนลูปดึงทุกหน้า โดยดูจาก `filesPagination.totalPages`:

```typescript
// ดึงหน้าแรกก่อนเพื่อรู้จำนวนหน้าทั้งหมด
const first = await api.get(`/folders/${id}?page=1`);
const { totalPages } = first.data.data.filesPagination;

// ดึงหน้าที่เหลือพร้อมกัน
const rest = await Promise.all(
  Array.from({ length: totalPages - 1 }, (_, i) =>
    api.get(`/folders/${id}?page=${i + 2}`),
  ),
);

// รวมไฟล์ทั้งหมด
const allFiles = [
  ...first.data.data.files,
  ...rest.flatMap((r) => r.data.data.files),
];
```

### 5. Webhook Events ที่รองรับ

| Event              | คำอธิบาย                                       |
| ------------------ | ---------------------------------------------- |
| `FOLDER_PUBLISHED` | โฟลเดอร์ถูกเผยแพร่ — ดึงไฟล์ไปประมวลผลได้เลย   |
| `FOLDER_EXPIRED`   | โฟลเดอร์หมดอายุ — ลบ cache หรือแจ้งเตือน user  |
| `FOLDER_REVOKED`   | โฟลเดอร์ถูกยกเลิก — ลบ access ฝั่งตัวเอง       |
| `TEST_CONNECTION`  | ทดสอบ Webhook ผ่าน API/Portal — ตอบกลับ 200 OK |
| `PING`             | ตรวจสอบการเชื่อมต่อก่อนบันทึก config           |

---

## ❓ คำถามที่พบบ่อย

**Q: ทำไม POST /api/webhook-config แล้วได้ error 401 กลับมา?**

A: `secret` ที่ส่งใน body ไม่ตรงกับ `SST_WEBHOOK_SECRET` ใน `.env` ของ simulator ต้องใช้ค่าเดียวกัน เพราะ SST ใช้ secret นั้น sign payload ทดสอบการเชื่อมต่อแล้วส่งมาให้ simulator ตรวจ

---

**Q: ทำไม folder บางอันเข้าถึง detail ไม่ได้ ได้ 403 กลับมา?**

A: folder ที่มีสถานะ `DRAFT` หรือ `PROCESSING` ยังไม่พร้อมให้เข้าถึง ต้องรอจนกว่า Admin จะ publish เป็น `READY`

---

**Q: `downloadUrl` เป็น null ทำไม?**

A: ไฟล์นั้นอาจหายจาก Storage แล้ว ควรกรองออกก่อน download ด้วย `.filter(f => f.downloadUrl)`

---

**Q: Presigned URL ใช้ได้นานแค่ไหน?**

A: 1 ชั่วโมง (3600 วินาที) ควรดาวน์โหลดทันทีหลังได้รับ ถ้าหมดอายุต้องเรียก API ใหม่

---

**Q: ถ้าอยากเปลี่ยน Webhook URL แต่ไม่อยากเปลี่ยน secret ทำยังไง?**

A: ส่ง `secret` เป็นค่าว่าง `""` หรือไม่ส่งมาเลย ระบบจะคงค่า secret เดิมไว้ให้ และ response จะมี `"secretUpdated": false` บอกให้รู้ว่า secret ไม่ได้ถูกเปลี่ยน

---

**Q: Response จาก POST /api/webhook-config บอกอะไรบ้าง?**

A: response มี field `secretUpdated` บอกชัดเจนว่า secret ถูกเปลี่ยนหรือไม่:

```json
{
  "message": "อัปเดตการตั้งค่า Webhook เรียบร้อยแล้ว (คง Secret Key เดิม)",
  "data": {
    "url": "http://localhost:4000/api/webhook",
    "secretUpdated": false
  }
}
```

ถ้าส่ง secret ใหม่มาด้วย:

```json
{
  "message": "อัปเดตการตั้งค่า Webhook เรียบร้อยแล้ว (รวมถึง Secret Key)",
  "data": {
    "url": "http://localhost:4000/api/webhook",
    "secretUpdated": true
  }
}
```

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

> **หมายเหตุ:** ใน Production จริง ไม่จำเป็นต้องบันทึกลง disk — สามารถนำ `downloadUrl` จาก `files[].downloadUrl` ไปประมวลผลต่อได้เลย เช่น ส่งต่อไป S3, เข้า Queue, หรือ stream ไปยัง client โดยตรง

---

_หมายเหตุ: โค้ดนี้เป็นตัวอย่างเบื้องต้น สำหรับ Production แนะนำให้เพิ่ม Error Handling, Retry Logic, Queue System และ Logging ตามมาตรฐานขององค์กร_
