import express from 'express';
import { Request, Response } from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import axios, { AxiosInstance } from 'axios';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

// โหลดค่าจาก .env
dotenv.config({ override: true });

const app = express();

// สำคัญ: ต้องใช้ raw body ในการตรวจสอบ Signature (HMAC)
app.use(
  bodyParser.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.SST_WEBHOOK_SECRET || '';
const SST_API_URL = process.env.SST_API_URL || 'http://localhost:3000';
const CUSTOMER_ID = process.env.SST_CUSTOMER_ID || '';
const SECRET_KEY = process.env.SST_SECRET_KEY || '';

// ============================================================
// Axios Instance — ใส่ Headers ทุก Request อัตโนมัติ
// ============================================================
const sstApi: AxiosInstance = axios.create({
  baseURL: SST_API_URL,
  headers: {
    'X-Customer-ID': CUSTOMER_ID,
    'X-Secret-Key': SECRET_KEY,
    'Content-Type': 'application/json',
  },
});

// ============================================================
// Helper: แปลง error จาก axios ให้อ่านง่าย (จัดการกรณี HTML response ด้วย)
// ============================================================
function parseAxiosError(error: any): { status: number; message: string; detail: any } {
  const status = error.response?.status || 500;
  const rawData = error.response?.data;

  // ถ้า response เป็น HTML (redirect ไปหน้า login หรือ error page)
  if (typeof rawData === 'string' && rawData.trim().startsWith('<')) {
    return {
      status,
      message: `SST API returned HTML instead of JSON (HTTP ${status}) — อาจเกิดจาก Credentials ไม่ถูกต้อง หรือ API URL ผิด`,
      detail: { hint: 'ตรวจสอบ SST_CUSTOMER_ID, SST_SECRET_KEY และ SST_API_URL ใน .env' },
    };
  }

  return {
    status,
    message: rawData?.error || error.message || 'Unknown error',
    detail: rawData,
  };
}
function logQuota(headers: any) {
  const limit = headers['x-ratelimit-limit'];
  const used = headers['x-ratelimit-used'];
  const remaining = headers['x-ratelimit-remaining'];
  if (limit) {
    console.log(`📊 Quota: ${used}/${limit} used, ${remaining} remaining today`);
  }
}

// ============================================================
// 1. Health Check — ตรวจสอบ Credentials และสถานะ API
// GET /api/health-check
// ============================================================
app.get('/api/health-check', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [1] Testing API Health Check ---');
  try {
    const response = await sstApi.get('/api/external/health');
    logQuota(response.headers);
    console.log('✅ Health Check Success:', JSON.stringify(response.data, null, 2));
    return res.json({ success: true, data: response.data });
  } catch (error: any) {
    console.error('❌ Health Check Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 2. Folder List — ดึงรายการโฟลเดอร์ทั้งหมด
// GET /api/folders?status=READY&page=1&startDate=2024-01-01&endDate=2024-12-31
// ============================================================
app.get('/api/folders', async (req: Request, res: Response): Promise<any> => {
  console.log('\n--- [2] Fetching Folder List ---');
  try {
    // default เป็น ALL เพื่อแสดงทุก status ใน simulator
    const { status = 'ALL', page = '1', startDate, endDate } = req.query;

    const params: Record<string, string> = { status: String(status), page: String(page) };
    if (startDate) params.startDate = String(startDate);
    if (endDate) params.endDate = String(endDate);

    const response = await sstApi.get('/api/external/folders', { params });
    logQuota(response.headers);

    const { data, pagination, usage } = response.data;
    console.log(`✅ Found ${pagination.total} folders (Page ${pagination.page}/${pagination.totalPages}) [status=${params.status}]`);
    data.forEach((f: any) => {
      console.log(`  📁 [${f.code}] ${f.name} — ${f.fileCount} files, status: ${f.status}, size: ${f.totalSizeFormatted}`);
    });

    return res.json({ success: true, data, pagination, usage });
  } catch (error: any) {
    console.error('❌ Folder List Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 3. Folder Detail — ดึงรายละเอียดโฟลเดอร์ + ไฟล์ + Download URLs
// GET /api/folders/:id?page=1
// ============================================================
app.get('/api/folders/:id', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const { page = '1' } = req.query;
  console.log(`\n--- [3] Fetching Folder Detail: ${id} (page=${page}) ---`);

  try {
    const response = await sstApi.get(`/api/external/folders/${id}`, {
      params: { page: String(page) },
    });
    logQuota(response.headers);

    const { data, usage } = response.data;
    console.log(`✅ Folder: [${data.code}] ${data.name} (${data.status})`);
    console.log(`   Created by: ${data.metadata?.createdBy || '-'}`);
    console.log(`   Template: ${data.template?.name || 'ไม่ได้ใช้ Template'}`);
    console.log(`   Files (page ${data.filesPagination?.page}/${data.filesPagination?.totalPages}): ${data.files?.length} items`);
    console.log(`   Total files: ${data.filesPagination?.total}, Total size: ${data.summary?.totalSizeFormatted}`);

    // แสดงตัวอย่างไฟล์แรก
    if (data.files?.length > 0) {
      const firstFile = data.files[0];
      console.log(`\n   📄 ตัวอย่างไฟล์แรก:`);
      console.log(`      Name: ${firstFile.name}`);
      console.log(`      Size: ${firstFile.sizeFormatted}`);
      console.log(`      MIME: ${firstFile.mimeType}`);
      console.log(`      Status: ${firstFile.status}`);
      console.log(`      Index Data: ${JSON.stringify(firstFile.indexData)}`);
      console.log(`      Download URL: ${firstFile.downloadUrl ? firstFile.downloadUrl.substring(0, 80) + '...' : 'null (ไม่มี URL)'}`);
    }

    // แสดงข้อมูล Download URLs
    const readyFiles = (data.files || []).filter((f: any) => f.downloadUrl);
    console.log(`\n   🔗 Download URLs ready: ${readyFiles.length}/${data.files?.length || 0} files`);

    return res.json({ success: true, data, usage });
  } catch (error: any) {
    console.error('❌ Folder Detail Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 4. Folder Files — ดึงรายการไฟล์ใน folder (ไม่ต้องดึง metadata ซ้ำ)
// GET /api/folders/:id/files?page=1&search=invoice&indexKey=invoice_no&indexValue=INV-2024
// ============================================================
app.get('/api/folders/:id/files', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  const { page = '1', search, indexKey, indexValue } = req.query;
  console.log(`\n--- [4] Fetching Files in Folder: ${id} (page=${page}) ---`);

  try {
    const params: Record<string, string> = { page: String(page) };
    if (search) params.search = String(search);
    if (indexKey) params.indexKey = String(indexKey);
    if (indexValue) params.indexValue = String(indexValue);

    const response = await sstApi.get(`/api/external/folders/${id}/files`, { params });
    logQuota(response.headers);

    const { data } = response.data;
    console.log(`✅ Folder: [${data.folderCode}] ${data.folderName}`);
    console.log(`   Files (page ${data.pagination.page}/${data.pagination.totalPages}): ${data.files.length} items`);
    if (data.filters.search || data.filters.indexKey) {
      console.log(
        `   Filter: search="${data.filters.search || '-'}", indexKey="${data.filters.indexKey || '-'}", indexValue="${data.filters.indexValue || '-'}"`,
      );
    }
    data.files.slice(0, 3).forEach((f: any) => {
      console.log(`  📄 ${f.name} (${f.sizeFormatted}) — ${f.status}`);
    });
    if (data.files.length > 3) console.log(`  ... and ${data.files.length - 3} more`);

    return res.json({ success: true, data, pagination: data.pagination });
  } catch (error: any) {
    console.error('❌ Folder Files Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 5. Usage Stats — ดูสถิติการใช้งาน API Quota ย้อนหลัง 30 วัน
// GET /api/usage
// ============================================================
app.get('/api/usage', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [5] Fetching Usage Stats ---');
  try {
    const response = await sstApi.get('/api/external/usage');
    logQuota(response.headers);

    const { data } = response.data;
    console.log(`✅ Usage Stats:`);
    console.log(`   Today: ${data.today.count}/${data.today.limit} (${data.today.percentage}%)`);
    console.log(`   30-day total: ${data.summary.totalCalls} calls, ${data.summary.activeDays} active days`);
    console.log(`   Peak day: ${data.summary.peakDay.date} (${data.summary.peakDay.count} calls)`);
    console.log(`   Avg per active day: ${data.summary.avgPerActiveDay}`);

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ Usage Stats Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});
// GET /api/folders/:id/download-all
// บันทึกไฟล์ลงโฟลเดอร์ ./downloads/<folderId>/
// ============================================================
app.get('/api/folders/:id/download-all', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  console.log(`\n--- [6] Downloading ALL files from folder: ${id} ---`);

  try {
    // ดึงหน้าแรกก่อนเพื่อรู้จำนวนหน้าทั้งหมด
    const firstPage = await sstApi.get(`/api/external/folders/${id}`, { params: { page: 1 } });
    const folderData = firstPage.data.data;

    // ตรวจสอบว่า folder พร้อมใช้งานหรือไม่ (PROCESSING/DRAFT จะไม่มี filesPagination)
    if (!folderData || !folderData.filesPagination) {
      return res.status(403).json({
        success: false,
        error: firstPage.data.error || 'โฟลเดอร์นี้ยังไม่พร้อมให้เข้าถึง',
      });
    }

    const { filesPagination } = folderData;
    const totalPages = filesPagination.totalPages;
    const totalFiles = filesPagination.total;

    console.log(`📦 Total: ${totalFiles} files across ${totalPages} pages`);

    if (totalFiles === 0) {
      return res.json({ success: true, totalFiles: 0, successCount: 0, failCount: 0, message: 'ไม่มีไฟล์ใน folder นี้' });
    }

    // ดึงทุกหน้าพร้อมกัน — แต่ละหน้ากิน 1 quota
    const allPageResponses = await Promise.all(
      Array.from({ length: totalPages }, (_, i) =>
        i === 0 ? Promise.resolve(firstPage) : sstApi.get(`/api/external/folders/${id}`, { params: { page: i + 1 } }),
      ),
    );

    // รวม downloadUrl จาก files[] ทุกหน้า
    const allUrls: { name: string; sizeFormatted: string; downloadUrl: string }[] = [];
    for (const pageRes of allPageResponses) {
      const files = pageRes.data.data.files as any[];
      files
        .filter((f: any) => f.downloadUrl)
        .forEach((f: any) => allUrls.push({ name: f.name, sizeFormatted: f.sizeFormatted, downloadUrl: f.downloadUrl }));
    }

    console.log(`🔗 Collected ${allUrls.length} download URLs (used ${totalPages} quota)`);

    if (allUrls.length === 0) {
      return res.json({ success: true, totalFiles, successCount: 0, failCount: 0, message: 'ไม่มีไฟล์ที่มี download URL' });
    }

    // สร้างโฟลเดอร์ปลายทาง
    const downloadDir = path.join(process.cwd(), 'downloads', id);
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    // ดาวน์โหลดทุกไฟล์พร้อมกัน (Parallel) — ไฟล์ไหลตรงจาก MinIO ไม่ผ่าน server
    let successCount = 0;
    let failCount = 0;

    await Promise.all(
      allUrls.map(async ({ name, sizeFormatted, downloadUrl }) => {
        try {
          const fileRes = await axios.get(downloadUrl, { responseType: 'arraybuffer' });
          const filePath = path.join(downloadDir, name);
          fs.writeFileSync(filePath, Buffer.from(fileRes.data));
          console.log(`  ✅ Downloaded: ${name} (${sizeFormatted})`);
          successCount++;
        } catch (err: any) {
          console.error(`  ❌ Failed: ${name} — ${err.message}`);
          failCount++;
        }
      }),
    );

    console.log(`\n✨ Done! ${successCount} success, ${failCount} failed`);
    console.log(`📁 Saved to: ${downloadDir}`);

    return res.json({
      success: true,
      totalFiles,
      successCount,
      failCount,
      savedTo: downloadDir,
    });
  } catch (error: any) {
    console.error('❌ Download All Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 7. Activity Actions — ดูรายการ action codes ที่กรองได้
// GET /api/activity-actions
// ============================================================
app.get('/api/activity-actions', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [7] Fetching Activity Action Codes ---');
  try {
    const response = await sstApi.get('/api/external/activities/actions');
    const { data } = response.data;

    console.log(`✅ Found ${data.length} action codes`);
    const grouped = data.reduce((acc: any, item: any) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(`${item.code} (${item.label})`);
      return acc;
    }, {});
    Object.entries(grouped).forEach(([cat, items]: any) => {
      console.log(`  📂 ${cat}: ${items.join(', ')}`);
    });

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ Activity Actions Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 8. Activity List — ดึงประวัติกิจกรรม
// GET /api/activities?page=1&action=FETCH_FOLDER_LIST&startDate=2024-01-01
// ============================================================
app.get('/api/activities', async (req: Request, res: Response): Promise<any> => {
  console.log('\n--- [8] Fetching Activity List ---');
  try {
    const { page = '1', action, startDate, endDate } = req.query;

    const params: Record<string, string> = { page: String(page) };
    if (action) params.action = String(action);
    if (startDate) params.startDate = String(startDate);
    if (endDate) params.endDate = String(endDate);

    const response = await sstApi.get('/api/external/activities', { params });
    logQuota(response.headers);

    const { data, pagination, usage } = response.data;
    console.log(`✅ Found ${pagination.total} activities (Page ${pagination.page}/${pagination.totalPages})`);
    data.slice(0, 5).forEach((a: any) => {
      console.log(`  📋 [${a.action}] by ${a.actor?.fullname || 'System'} at ${a.createdAt}`);
    });
    if (data.length > 5) console.log(`  ... and ${data.length - 5} more`);

    return res.json({ success: true, data, pagination, usage });
  } catch (error: any) {
    console.error('❌ Activity List Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 9. Activity Detail — ดึงรายละเอียดกิจกรรมเดี่ยว
// GET /api/activities/:id
// ============================================================
app.get('/api/activities/:id', async (req: Request, res: Response): Promise<any> => {
  const { id } = req.params;
  console.log(`\n--- [9] Fetching Activity Detail: ${id} ---`);
  try {
    const response = await sstApi.get(`/api/external/activities/${id}`);
    logQuota(response.headers);

    const { data } = response.data;
    console.log(`✅ Activity: [${data.action}] — ${data.details?.summary}`);
    console.log(`   Actor: ${data.actor?.fullname || 'System'} (${data.actor?.userType})`);
    console.log(`   Status: ${data.status}, IP: ${data.ipAddress}`);

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ Activity Detail Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 10. Webhook Config — ดูการตั้งค่า Webhook ปัจจุบัน
// GET /api/webhook-config
// ============================================================
app.get('/api/webhook-config', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [10] Fetching Webhook Config ---');
  try {
    const response = await sstApi.get('/api/external/webhooks');
    const { data } = response.data;

    if (!data) {
      console.log('ℹ️  No webhook configured yet');
      return res.json({ success: true, data: null, message: 'ยังไม่มีการตั้งค่า Webhook' });
    }

    console.log(`✅ Webhook Config:`);
    console.log(`   URL: ${data.url}`);
    console.log(`   Events: ${data.events.join(', ')}`);
    console.log(`   Status: ${data.status}`);

    return res.json({ success: true, data });
  } catch (error: any) {
    console.error('❌ Webhook Config Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 10. Webhook Setup — สร้าง/แก้ไข Webhook
// POST /api/webhook-config
// Body: { url, secret, events?, status? }
// ============================================================
app.post('/api/webhook-config', async (req: Request, res: Response): Promise<any> => {
  console.log('\n--- [11] Setting up Webhook ---');
  try {
    const { url, secret, events, status } = req.body;
    if (!url || !secret) {
      return res.status(400).json({ success: false, error: 'กรุณาระบุ url และ secret' });
    }

    const response = await sstApi.post('/api/external/webhooks', { url, secret, events, status });
    console.log(`✅ Webhook configured: ${response.data.data?.url}`);
    return res.json({ success: true, data: response.data });
  } catch (error: any) {
    console.error('❌ Webhook Setup Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 11. Webhook Test — ส่ง Ping ทดสอบ
// POST /api/webhook-test
// ============================================================
app.post('/api/webhook-test', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [12] Testing Webhook ---');
  try {
    const response = await sstApi.post('/api/external/webhooks/test', {});
    console.log(`✅ ${response.data.message}`);
    console.log(`   Target URL: ${response.data.targetUrl}`);
    return res.json({ success: true, data: response.data });
  } catch (error: any) {
    console.error('❌ Webhook Test Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 12. Webhook Disable — ปิดการใช้งาน Webhook
// DELETE /api/webhook-config
// ============================================================
app.delete('/api/webhook-config', async (_req: Request, res: Response): Promise<any> => {
  console.log('\n--- [13] Disabling Webhook ---');
  try {
    const response = await sstApi.delete('/api/external/webhooks');
    console.log(`✅ ${response.data.message}`);
    return res.json({ success: true, data: response.data });
  } catch (error: any) {
    console.error('❌ Webhook Disable Failed:', error.response?.data || error.message);
    const { status, message, detail } = parseAxiosError(error);
    return res.status(status).json({ success: false, error: message, detail });
  }
});

// ============================================================
// 13. Webhook Receiver — รับ Event จาก SST
// POST /api/webhook
// ============================================================
app.post('/api/webhook', (req: any, res: Response): any => {
  const signature = req.headers['x-webhook-signature'];
  const rawBody = req.rawBody;

  console.log('\n--- [14] Received Webhook ---');

  if (!WEBHOOK_SECRET) {
    console.error('❌ SST_WEBHOOK_SECRET is not configured in .env');
    return res.status(500).json({ error: 'Config error: WEBHOOK_SECRET not set' });
  }

  // ตรวจสอบ Signature (HMAC SHA256)
  const hmac = crypto.createHmac('sha256', WEBHOOK_SECRET);
  const digest = hmac.update(rawBody).digest('hex');

  if (signature !== digest) {
    console.error('❌ Invalid signature! Potential spoofing attempt.');
    console.error(`   Received: ${signature}`);
    console.error(`   Expected: ${digest}`);
    return res.status(401).json({ error: 'Invalid signature' });
  }

  // ตอบกลับ 200 OK ทันที ก่อนประมวลผล (ป้องกัน Timeout)
  res.json({ received: true });

  const payload = req.body;
  console.log(`✅ Signature Verified. Event: ${payload.event}`);
  console.log(`   Timestamp: ${payload.timestamp}`);

  // Route ตาม Event Type
  switch (payload.event) {
    case 'FOLDER_PUBLISHED':
      handleFolderPublished(payload.data);
      break;
    case 'FOLDER_EXPIRED':
      handleFolderExpired(payload.data);
      break;
    case 'FOLDER_REVOKED':
      handleFolderRevoked(payload.data);
      break;
    case 'PING':
      console.log('🏓 Ping received — connection test successful');
      break;
    default:
      console.log(`ℹ️  Unhandled event: ${payload.event}`);
  }
});

// ============================================================
// Handler: FOLDER_PUBLISHED
// เมื่อโฟลเดอร์ถูกเผยแพร่ — ดึงข้อมูลและ download ไฟล์ทั้งหมด
// ============================================================
async function handleFolderPublished(data: any) {
  const folderId = data?.id;
  if (!folderId) {
    console.error('❌ handleFolderPublished: missing folder id in payload');
    return;
  }

  console.log(`\n📂 Processing FOLDER_PUBLISHED: ${folderId} (${data.name})`);

  try {
    // ดึงหน้าแรกเพื่อรู้จำนวนหน้าทั้งหมด
    const firstPage = await sstApi.get(`/api/external/folders/${folderId}`, {
      params: { page: 1 },
    });

    const folderData = firstPage.data.data;
    const { filesPagination } = folderData;

    console.log(`   Files: ${filesPagination.total} total, ${filesPagination.totalPages} pages`);
    console.log(`   Template: ${folderData.template?.name || 'ไม่ได้ใช้ Template'}`);

    // ถ้ามีหลายหน้า ดึงทุกหน้าพร้อมกัน
    const allPageResponses =
      filesPagination.totalPages > 1
        ? await Promise.all(
            Array.from({ length: filesPagination.totalPages }, (_, i) =>
              i === 0 ? Promise.resolve(firstPage) : sstApi.get(`/api/external/folders/${folderId}`, { params: { page: i + 1 } }),
            ),
          )
        : [firstPage];

    // รวม downloadUrl จาก files[] ทุกหน้า
    const allUrls: { name: string; downloadUrl: string; mimeType: string }[] = [];
    for (const pageRes of allPageResponses) {
      const files = pageRes.data.data.files as any[];
      files.filter((f: any) => f.downloadUrl).forEach((f: any) => allUrls.push({ name: f.name, downloadUrl: f.downloadUrl, mimeType: f.mimeType }));
    }

    console.log(`   🔗 ${allUrls.length} download URLs collected`);

    // ============================================================
    // ตรงนี้คือจุดที่คุณนำไฟล์ไปประมวลผลต่อ
    // ตัวอย่าง: บันทึกลง disk, ส่งต่อไป S3, เข้า Queue, ฯลฯ
    // ============================================================
    for (const { name, mimeType } of allUrls) {
      console.log(`   📄 Ready to process: ${name} (${mimeType})`);
      // ตัวอย่าง: await processFile(name, downloadUrl);
    }

    console.log(`✨ FOLDER_PUBLISHED handled successfully: ${folderId}`);
  } catch (error: any) {
    console.error('❌ handleFolderPublished Error:', error.response?.data || error.message);
  }
}

// ============================================================
// Handler: FOLDER_EXPIRED
// เมื่อโฟลเดอร์หมดอายุ
// ============================================================
function handleFolderExpired(data: any) {
  const folderId = data?.id;
  console.log(`\n⏰ FOLDER_EXPIRED: ${folderId} (${data?.name})`);
  console.log(`   หมดอายุเมื่อ: ${data?.expiredAt || '-'}`);
  // ตรงนี้ใส่ logic ที่ต้องการเมื่อ folder หมดอายุ
  // เช่น: ลบข้อมูลที่ cache ไว้, แจ้งเตือน user, อัปเดต database ฝั่งตัวเอง
}

// ============================================================
// Handler: FOLDER_REVOKED
// เมื่อโฟลเดอร์ถูกยกเลิก
// ============================================================
function handleFolderRevoked(data: any) {
  const folderId = data?.id;
  console.log(`\n🚫 FOLDER_REVOKED: ${folderId} (${data?.name})`);
  console.log(`   ยกเลิกโดย: ${data?.revokedBy || '-'}`);
  // ตรงนี้ใส่ logic ที่ต้องการเมื่อ folder ถูกยกเลิก
  // เช่น: ลบ access, แจ้งเตือน user, อัปเดต status ฝั่งตัวเอง
}

// ============================================================
// Start Server
// ============================================================
app.listen(PORT, () => {
  console.log('==================================================');
  console.log(`🚀 SST Customer Simulator running on http://localhost:${PORT}`);
  console.log('==================================================');
  console.log('Available endpoints:');
  console.log(`  GET    http://localhost:${PORT}/api/health-check          — ตรวจสอบ Credentials`);
  console.log(`  GET    http://localhost:${PORT}/api/folders               — รายการโฟลเดอร์`);
  console.log(`  GET    http://localhost:${PORT}/api/folders/:id           — รายละเอียดโฟลเดอร์ + Download URLs`);
  console.log(`  GET    http://localhost:${PORT}/api/folders/:id/files     — รายการไฟล์ใน folder (filter ได้)`);
  console.log(`  GET    http://localhost:${PORT}/api/folders/:id/download-all — ดาวน์โหลดทุกไฟล์`);
  console.log(`  GET    http://localhost:${PORT}/api/usage                 — สถิติการใช้งาน Quota 30 วัน`);
  console.log(`  GET    http://localhost:${PORT}/api/activity-actions      — รายการ action codes ที่กรองได้`);
  console.log(`  GET    http://localhost:${PORT}/api/activities            — ประวัติกิจกรรม`);
  console.log(`  GET    http://localhost:${PORT}/api/activities/:id        — รายละเอียดกิจกรรม`);
  console.log(`  GET    http://localhost:${PORT}/api/webhook-config        — ดูการตั้งค่า Webhook`);
  console.log(`  POST   http://localhost:${PORT}/api/webhook-config        — สร้าง/แก้ไข Webhook`);
  console.log(`  POST   http://localhost:${PORT}/api/webhook-test          — ทดสอบ Webhook (Ping)`);
  console.log(`  DELETE http://localhost:${PORT}/api/webhook-config        — ปิดการใช้งาน Webhook`);
  console.log(`  POST   http://localhost:${PORT}/api/webhook               — รับ Webhook Event จาก SST`);
  console.log('==================================================');
  console.log(
    `Config: SST_API_URL=${SST_API_URL}, CUSTOMER_ID=${CUSTOMER_ID ? '✅ set' : '❌ missing'}, SECRET_KEY=${SECRET_KEY ? '✅ set' : '❌ missing'}`,
  );
  console.log('==================================================');
});
