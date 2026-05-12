import express from 'express';
import { Request, Response } from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import axios from 'axios';
import dotenv from 'dotenv';

// โหลดค่าจาก .env โดยใช้ override: true เพื่อให้มั่นใจว่าค่าใหม่จะถูกนำมาใช้เสมอแม้ Node.js จะรันค้างไว้
dotenv.config({ override: true });

const app = express();
// สำคัญ: เราต้องใช้ raw body ในการตรวจสอบ Signature (HMAC)
app.use(bodyParser.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));

const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.SST_WEBHOOK_SECRET || '';
const ADMIN_API_URL = process.env.SST_API_URL || 'http://localhost:3000';
const CUSTOMER_ID = process.env.SST_CUSTOMER_ID || '';
const SECRET_KEY = process.env.SST_SECRET_KEY || '';

/**
 * 1. Endpoint สำหรับตรวจสอบสถานะ API (Health Check)
 * เพื่อให้ลูกค้าตรวจสอบได้ว่า Credentials และ Connection ของฝั่งลูกค้าถูกต้องหรือไม่
 */
app.get('/api/health-check', async (req: Request, res: Response): Promise<any> => {
  console.log('--- Testing API Health Check ---');
  try {
    const response = await axios.get(`${ADMIN_API_URL}/api/external/health`, {
      headers: {
        'X-Customer-ID': CUSTOMER_ID,
        'X-Secret-Key': SECRET_KEY
      }
    });
    
    console.log('✅ Health Check Success:', response.data);
    return res.json({
      success: true,
      data: response.data
    });
  } catch (error: any) {
    console.error('❌ Health Check Failed:', error.response?.data || error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to connect to SST API',
      error: error.response?.data
    });
  }
});

/**
 * 2. Endpoint สำหรับรับ Webhook (Receiver)
 * เป็นจุดที่ SST จะส่งข้อมูลมาให้เมื่อมี Event เกิดขึ้น
 */
app.post('/api/webhook', (req: any, res: Response): any => {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.rawBody;

  console.log('--- Received Webhook ---');

  // ตรวจสอบว่ามี Secret ตั้งไว้หรือไม่
  if (!WEBHOOK_SECRET) {
    console.error('❌ WEBHOOK_SECRET is not configured in .env');
    return res.status(500).json({ error: 'Config error' });
  }

  // ตรวจสอบ Signature (HMAC SHA256)
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = hmac.update(rawBody).digest('hex');

  if (signature !== digest) {
    console.error('❌ Invalid signature! Potential spoofing attempt.');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ตอบกลับ 200 OK ทันที เพื่อป้องกันการเกิด Timeout ในฝั่งของ SST
  res.json({ received: true });

  // เริ่มประมวลผลข้อมูล (Async)
  const payload = req.body;
  console.log('✅ Signature Verified. Event:', payload.event);

  if (payload.event === 'FOLDER_PUBLISHED') {
    handleFolderPublished(payload.data);
  }
});

/**
 * 3. Logic เมื่อได้รับแจ้งเตือนว่าโพลเดอร์ถูกเผยแพร่
 * ในตัวอย่างนี้จะทำการเรียก API เพื่อดึงข้อมูลโฟลเดอร์ออกมาดู
 */
async function handleFolderPublished(data: any) {
  const folderId = data.id;
  console.log(`📂 Processing folder: ${folderId} (Name: ${data.name})`);

  try {
    // ตัวอย่างการเรียกใช้ External API เพื่อดึงรายละเอียด
    const response = await axios.get(`${ADMIN_API_URL}/api/external/folders/${folderId}`, {
      headers: {
        'X-Customer-ID': CUSTOMER_ID,
        'X-Secret-Key': SECRET_KEY
      }
    });

    console.log('✨ Data Retrieved Successfully:', {
      id: response.data.data.id,
      name: response.data.data.name,
      filesCount: response.data.data.files?.length
    });

    // คุณสามารถนำข้อมูลไฟล์ใน response.data.data.files ไปดาวน์โหลดหรือประมวลผลต่อได้ที่นี่
  } catch (error: any) {
    console.error('❌ API Call Failed:', error.response?.data || error.message);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Customer Simulator running on http://localhost:${PORT}`);
  console.log(`- Webhook URL: http://localhost:${PORT}/api/webhook`);
  console.log(`- Health Check: http://localhost:${PORT}/api/health-check`);
  console.log('--------------------------------------------------');
});
