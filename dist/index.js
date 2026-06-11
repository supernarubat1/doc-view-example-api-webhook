"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const crypto_1 = __importDefault(require("crypto"));
const axios_1 = __importDefault(require("axios"));
const dotenv_1 = __importDefault(require("dotenv"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
// โหลดค่าจาก .env
dotenv_1.default.config({ override: true });
const app = (0, express_1.default)();
// สำคัญ: ต้องใช้ raw body ในการตรวจสอบ Signature (HMAC)
app.use(body_parser_1.default.json({
    verify: (req, _res, buf) => {
        req.rawBody = buf;
    },
}));
const PORT = process.env.PORT || 4000;
const WEBHOOK_SECRET = process.env.SST_WEBHOOK_SECRET || '';
const SST_API_URL = process.env.SST_API_URL || 'http://localhost:3000';
const CUSTOMER_ID = process.env.SST_CUSTOMER_ID || '';
const SECRET_KEY = process.env.SST_SECRET_KEY || '';
function safeFileName(name) {
    return path_1.default.basename(name).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_') || 'downloaded-file';
}
// ============================================================
// Axios Instance — ใส่ Headers ทุก Request อัตโนมัติ
// ============================================================
const sstApi = axios_1.default.create({
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
function parseAxiosError(error) {
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
function logQuota(headers) {
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
app.get('/api/health-check', async (_req, res) => {
    console.log('\n--- [1] Testing API Health Check ---');
    try {
        const response = await sstApi.get('/api/external/health');
        logQuota(response.headers);
        console.log('✅ Health Check Success:', JSON.stringify(response.data, null, 2));
        return res.json({ success: true, data: response.data });
    }
    catch (error) {
        console.error('❌ Health Check Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 2. Folder List — ดึงรายการโฟลเดอร์ทั้งหมด
// GET /api/folders?status=READY&page=1&startDate=2024-01-01&endDate=2024-12-31
// ============================================================
app.get('/api/folders', async (req, res) => {
    console.log('\n--- [2] Fetching Folder List ---');
    try {
        // default เป็น ALL เพื่อแสดงทุก status ใน simulator
        const { status = 'ALL', page = '1', startDate, endDate } = req.query;
        const params = { status: String(status), page: String(page) };
        if (startDate)
            params.startDate = String(startDate);
        if (endDate)
            params.endDate = String(endDate);
        const response = await sstApi.get('/api/external/folders', { params });
        logQuota(response.headers);
        const { data, pagination, usage } = response.data;
        console.log(`✅ Found ${pagination.total} folders (Page ${pagination.page}/${pagination.totalPages}) [status=${params.status}]`);
        data.forEach((f) => {
            console.log(`  📁 [${f.code}] ${f.name} — ${f.fileCount} files, status: ${f.status}, size: ${f.totalSizeFormatted}`);
        });
        return res.json({ success: true, data, pagination, usage });
    }
    catch (error) {
        console.error('❌ Folder List Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 3. Folder Detail — ดึงรายละเอียดโฟลเดอร์ + ไฟล์ + Download URLs
// GET /api/folders/:id?page=1
// ============================================================
app.get('/api/folders/:id', async (req, res) => {
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
        const readyFiles = (data.files || []).filter((f) => f.downloadUrl);
        console.log(`\n   🔗 Download URLs ready: ${readyFiles.length}/${data.files?.length || 0} files`);
        return res.json({ success: true, data, usage });
    }
    catch (error) {
        console.error('❌ Folder Detail Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 4. Folder Files — ดึงรายการไฟล์ใน folder (ไม่ต้องดึง metadata ซ้ำ)
// GET /api/folders/:id/files?page=1&search=invoice&indexKey=invoice_no&indexValue=INV-2024
// ============================================================
app.get('/api/folders/:id/files', async (req, res) => {
    const { id } = req.params;
    const { page = '1', search, indexKey, indexValue } = req.query;
    console.log(`\n--- [4] Fetching Files in Folder: ${id} (page=${page}) ---`);
    try {
        const params = { page: String(page) };
        if (search)
            params.search = String(search);
        if (indexKey)
            params.indexKey = String(indexKey);
        if (indexValue)
            params.indexValue = String(indexValue);
        const response = await sstApi.get(`/api/external/folders/${id}/files`, { params });
        logQuota(response.headers);
        const { data } = response.data;
        console.log(`✅ Folder: [${data.folderCode}] ${data.folderName}`);
        console.log(`   Files (page ${data.pagination.page}/${data.pagination.totalPages}): ${data.files.length} items`);
        if (data.filters.search || data.filters.indexKey) {
            console.log(`   Filter: search="${data.filters.search || '-'}", indexKey="${data.filters.indexKey || '-'}", indexValue="${data.filters.indexValue || '-'}"`);
        }
        data.files.slice(0, 3).forEach((f) => {
            console.log(`  📄 ${f.name} (${f.sizeFormatted}) — ${f.status}`);
        });
        if (data.files.length > 3)
            console.log(`  ... and ${data.files.length - 3} more`);
        return res.json({ success: true, data, pagination: data.pagination });
    }
    catch (error) {
        console.error('❌ Folder Files Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 5. Usage Stats — ดูสถิติการใช้งาน API Quota ย้อนหลัง 30 วัน
// GET /api/usage
// ============================================================
app.get('/api/usage', async (_req, res) => {
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
    }
    catch (error) {
        console.error('❌ Usage Stats Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// GET /api/folders/:id/download-all
// บันทึกไฟล์ลงโฟลเดอร์ ./downloads/<folderId>/
// ============================================================
app.get('/api/folders/:id/download-all', async (req, res) => {
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
        const allPageResponses = await Promise.all(Array.from({ length: totalPages }, (_, i) => i === 0 ? Promise.resolve(firstPage) : sstApi.get(`/api/external/folders/${id}`, { params: { page: i + 1 } })));
        // รวม downloadUrl จาก files[] ทุกหน้า
        const allUrls = [];
        for (const pageRes of allPageResponses) {
            const files = pageRes.data.data.files;
            files
                .filter((f) => f.downloadUrl)
                .forEach((f) => allUrls.push({ name: f.name, sizeFormatted: f.sizeFormatted, downloadUrl: f.downloadUrl }));
        }
        console.log(`🔗 Collected ${allUrls.length} download URLs (used ${totalPages} quota)`);
        if (allUrls.length === 0) {
            return res.json({ success: true, totalFiles, successCount: 0, failCount: 0, message: 'ไม่มีไฟล์ที่มี download URL' });
        }
        // สร้างโฟลเดอร์ปลายทาง
        const downloadDir = path_1.default.join(process.cwd(), 'downloads', id);
        if (!fs_1.default.existsSync(downloadDir)) {
            fs_1.default.mkdirSync(downloadDir, { recursive: true });
        }
        // ดาวน์โหลดทุกไฟล์พร้อมกัน (Parallel) — ไฟล์ไหลตรงจาก MinIO ไม่ผ่าน server
        let successCount = 0;
        let failCount = 0;
        await Promise.all(allUrls.map(async ({ name, sizeFormatted, downloadUrl }) => {
            try {
                const fileRes = await axios_1.default.get(downloadUrl, { responseType: 'arraybuffer' });
                const filePath = path_1.default.join(downloadDir, safeFileName(name));
                fs_1.default.writeFileSync(filePath, Buffer.from(fileRes.data));
                console.log(`  ✅ Downloaded: ${name} (${sizeFormatted})`);
                successCount++;
            }
            catch (err) {
                console.error(`  ❌ Failed: ${name} — ${err.message}`);
                failCount++;
            }
        }));
        console.log(`\n✨ Done! ${successCount} success, ${failCount} failed`);
        console.log(`📁 Saved to: ${downloadDir}`);
        return res.json({
            success: true,
            totalFiles,
            successCount,
            failCount,
            savedTo: downloadDir,
        });
    }
    catch (error) {
        console.error('❌ Download All Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 7. Activity Actions — ดูรายการ action codes ที่กรองได้
// GET /api/activity-actions
// ============================================================
app.get('/api/activity-actions', async (_req, res) => {
    console.log('\n--- [7] Fetching Activity Action Codes ---');
    try {
        const response = await sstApi.get('/api/external/activities/actions');
        const { data } = response.data;
        console.log(`✅ Found ${data.length} action codes`);
        const grouped = data.reduce((acc, item) => {
            if (!acc[item.category])
                acc[item.category] = [];
            acc[item.category].push(`${item.code} (${item.label})`);
            return acc;
        }, {});
        Object.entries(grouped).forEach(([cat, items]) => {
            console.log(`  📂 ${cat}: ${items.join(', ')}`);
        });
        return res.json({ success: true, data });
    }
    catch (error) {
        console.error('❌ Activity Actions Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 8. Activity List — ดึงประวัติกิจกรรม
// GET /api/activities?page=1&action=FETCH_FOLDER_LIST&startDate=2024-01-01
// ============================================================
app.get('/api/activities', async (req, res) => {
    console.log('\n--- [8] Fetching Activity List ---');
    try {
        const { page = '1', action, startDate, endDate } = req.query;
        const params = { page: String(page) };
        if (action)
            params.action = String(action);
        if (startDate)
            params.startDate = String(startDate);
        if (endDate)
            params.endDate = String(endDate);
        const response = await sstApi.get('/api/external/activities', { params });
        logQuota(response.headers);
        const { data, pagination, usage } = response.data;
        console.log(`✅ Found ${pagination.total} activities (Page ${pagination.page}/${pagination.totalPages})`);
        data.slice(0, 5).forEach((a) => {
            console.log(`  📋 [${a.action}] by ${a.actor?.fullname || 'System'} at ${a.createdAt}`);
        });
        if (data.length > 5)
            console.log(`  ... and ${data.length - 5} more`);
        return res.json({ success: true, data, pagination, usage });
    }
    catch (error) {
        console.error('❌ Activity List Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 9. Activity Detail — ดึงรายละเอียดกิจกรรมเดี่ยว
// GET /api/activities/:id
// ============================================================
app.get('/api/activities/:id', async (req, res) => {
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
    }
    catch (error) {
        console.error('❌ Activity Detail Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 10. Webhook Config — ดูการตั้งค่า Webhook ปัจจุบัน
// GET /api/webhook-config
// ============================================================
app.get('/api/webhook-config', async (_req, res) => {
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
    }
    catch (error) {
        console.error('❌ Webhook Config Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 10. Webhook Setup — สร้าง/แก้ไข Webhook
// POST /api/webhook-config
// Body: { url, secret, events, status? }
// events: รายการ Event ที่ต้องการรับ — ['FOLDER_PUBLISHED', 'FOLDER_REVOKED', 'FOLDER_EXPIRED']
//         ถ้าไม่ระบุ: SST จะ Default เป็น ['FOLDER_PUBLISHED'] เท่านั้น
// ============================================================
app.post('/api/webhook-config', async (req, res) => {
    console.log('\n--- [11] Setting up Webhook ---');
    try {
        const { url, secret, events, status } = req.body;
        if (!url || !secret) {
            return res.status(400).json({ success: false, error: 'กรุณาระบุ url และ secret' });
        }
        const subscribedEvents = events || ['FOLDER_PUBLISHED'];
        console.log(`   URL: ${url}`);
        console.log(`   Events: ${subscribedEvents.join(', ')}`);
        if (!events) {
            console.log(`   ⚠️  events ไม่ได้ระบุ → SST จะ Default เป็น ['FOLDER_PUBLISHED'] เท่านั้น`);
            console.log(`   💡 หากต้องการรับทุก Event ให้ระบุ: events: ['FOLDER_PUBLISHED', 'FOLDER_REVOKED', 'FOLDER_EXPIRED']`);
        }
        const response = await sstApi.post('/api/external/webhooks', { url, secret, events, status });
        console.log(`✅ Webhook configured: ${response.data.data?.url}`);
        console.log(`   Subscribed Events: ${(response.data.data?.events || subscribedEvents).join(', ')}`);
        return res.json({ success: true, data: response.data });
    }
    catch (error) {
        console.error('❌ Webhook Setup Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 11. Webhook Test — ส่ง TEST_CONNECTION ทดสอบ
// POST /api/webhook-test
// ============================================================
app.post('/api/webhook-test', async (_req, res) => {
    console.log('\n--- [12] Testing Webhook ---');
    try {
        const response = await sstApi.post('/api/external/webhooks/test', {});
        console.log(`✅ ${response.data.message}`);
        console.log(`   Target URL: ${response.data.targetUrl}`);
        return res.json({ success: true, data: response.data });
    }
    catch (error) {
        console.error('❌ Webhook Test Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 12. Webhook Disable — ปิดการใช้งาน Webhook
// DELETE /api/webhook-config
// ============================================================
app.delete('/api/webhook-config', async (_req, res) => {
    console.log('\n--- [13] Disabling Webhook ---');
    try {
        const response = await sstApi.delete('/api/external/webhooks');
        console.log(`✅ ${response.data.message}`);
        return res.json({ success: true, data: response.data });
    }
    catch (error) {
        console.error('❌ Webhook Disable Failed:', error.response?.data || error.message);
        const { status, message, detail } = parseAxiosError(error);
        return res.status(status).json({ success: false, error: message, detail });
    }
});
// ============================================================
// 13. Webhook Receiver — รับ Event จาก SST
// POST /api/webhook
// ============================================================
app.post('/api/webhook', (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const rawBody = req.rawBody;
    console.log('\n--- [14] Received Webhook ---');
    if (!WEBHOOK_SECRET) {
        console.error('❌ SST_WEBHOOK_SECRET is not configured in .env');
        return res.status(500).json({ error: 'Config error: WEBHOOK_SECRET not set' });
    }
    // ตรวจสอบ Signature (HMAC SHA256)
    const hmac = crypto_1.default.createHmac('sha256', WEBHOOK_SECRET);
    const digest = hmac.update(rawBody).digest('hex');
    const receivedSignature = Array.isArray(signature) ? signature[0] : signature;
    const receivedBuffer = Buffer.from(receivedSignature || '', 'hex');
    const expectedBuffer = Buffer.from(digest, 'hex');
    if (receivedBuffer.length !== expectedBuffer.length || !crypto_1.default.timingSafeEqual(receivedBuffer, expectedBuffer)) {
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
        case 'TEST_CONNECTION':
            console.log('✅ TEST_CONNECTION received — webhook test successful');
            break;
        case 'PING':
            console.log('🏓 PING received — setup validation successful');
            break;
        default:
            console.log(`ℹ️  Unhandled event: ${payload.event}`);
    }
});
// ============================================================
// Handler: FOLDER_PUBLISHED
// เมื่อโฟลเดอร์ถูกเผยแพร่ — ดึงข้อมูลและ download ไฟล์ทั้งหมด
//
// ข้อมูลที่ได้รับจาก payload (data):
//   - folderId    : UUID ของโฟลเดอร์
//   - folderCode  : รหัสโฟลเดอร์ (เช่น "F-2024-001")
//   - folderName  : ชื่อโฟลเดอร์
//   - publishedAt : วันเวลาที่เผยแพร่ (ISO string)
//   - fileCount   : จำนวนไฟล์ทั้งหมด
//   - totalSizeBytes : ขนาดรวมทั้งหมด (bytes)
//   - expiredAt   : วันหมดอายุ (ISO string หรือ null ถ้าไม่มีกำหนด)
//
// Flow การทำงาน:
//   1. รับ folderId จาก payload
//   2. เรียก GET /api/external/folders/:id เพื่อดึงข้อมูลโฟลเดอร์ + ไฟล์ + download URLs
//      (ถ้ามีหลายหน้า จะดึงทุกหน้าพร้อมกัน — แต่ละหน้ากิน 1 quota)
//   3. รวม download URLs ของทุกไฟล์
//   4. นำไฟล์ไปประมวลผลตามต้องการ (ดูตัวอย่างด้านล่าง)
//
// โครงสร้างข้อมูลไฟล์แต่ละไฟล์ที่ได้จาก API:
//   file.name        : ชื่อไฟล์ (เช่น "invoice_001.pdf")
//   file.mimeType    : ประเภทไฟล์ (เช่น "application/pdf")
//   file.sizeFormatted: ขนาดไฟล์ (เช่น "1.2 MB")
//   file.downloadUrl : Pre-signed URL สำหรับดาวน์โหลดตรงจาก Storage (หมดอายุใน 1 ชั่วโมง)
//   file.indexData   : ข้อมูล Key Index ที่คีย์ไว้ (object) เช่น { invoice_no: "INV-001", amount: "5000" }
//   file.status      : สถานะไฟล์ (ACTIVE)
//   file.uploadedAt  : วันเวลาที่อัปโหลด
//
// ข้อมูล Template (ถ้าโฟลเดอร์ใช้ Template):
//   folderData.template.name   : ชื่อ Template
//   folderData.template.fields : รายการ fields ทั้งหมดใน Template
//     field.key   : key ของ field (เช่น "invoice_no")
//     field.label : ชื่อที่แสดง (เช่น "เลขที่ใบแจ้งหนี้")
//     field.type  : ประเภท (TEXT, NUMBER, DATE, ฯลฯ)
// ============================================================
async function handleFolderPublished(data) {
    const folderId = data?.folderId;
    if (!folderId) {
        console.error('❌ handleFolderPublished: missing folder id in payload');
        return;
    }
    console.log(`\n📂 Processing FOLDER_PUBLISHED: ${folderId} (${data.folderName || data.folderCode})`);
    console.log(`   Published at: ${data.publishedAt}, Files: ${data.fileCount}, Size: ${data.totalSizeBytes} bytes`);
    if (data.expiredAt)
        console.log(`   Expires at: ${data.expiredAt}`);
    try {
        // -------------------------------------------------------
        // STEP 1: ดึงหน้าแรกเพื่อรู้จำนวนหน้าทั้งหมด
        //
        // Response structure:
        // {
        //   data: {
        //     id, code, name, status,
        //     template: { name, fields: [{ key, label, type }] },
        //     files: [ { name, mimeType, downloadUrl, indexData, ... } ],
        //     filesPagination: { page, totalPages, total, pageSize }
        //   }
        // }
        // -------------------------------------------------------
        const firstPage = await sstApi.get(`/api/external/folders/${folderId}`, {
            params: { page: 1 },
        });
        const folderData = firstPage.data.data;
        const { filesPagination } = folderData;
        console.log(`   Files: ${filesPagination.total} total, ${filesPagination.totalPages} pages`);
        console.log(`   Template: ${folderData.template?.name || 'ไม่ได้ใช้ Template'}`);
        // -------------------------------------------------------
        // STEP 2: ถ้ามีหลายหน้า ดึงทุกหน้าพร้อมกัน (Parallel)
        //
        // แต่ละหน้าแสดงผลได้สูงสุด 100 รายการ
        // ถ้ามีไฟล์ 500 รายการ → totalPages = 5 → ต้องใช้ 5 requests (กิน 5 quota)
        // ดึงพร้อมกันทั้งหมดด้วย Promise.all เพื่อความเร็ว
        // -------------------------------------------------------
        const allPageResponses = filesPagination.totalPages > 1
            ? await Promise.all(Array.from({ length: filesPagination.totalPages }, (_, i) => i === 0 ? Promise.resolve(firstPage) : sstApi.get(`/api/external/folders/${folderId}`, { params: { page: i + 1 } })))
            : [firstPage];
        // -------------------------------------------------------
        // STEP 3: รวมข้อมูลไฟล์ทุกหน้าเข้าด้วยกัน
        //
        // แต่ละ file object มี:
        //   - name        : ชื่อไฟล์
        //   - mimeType    : ประเภทไฟล์
        //   - downloadUrl : Pre-signed URL (ดาวน์โหลดตรงจาก Storage ไม่ผ่าน server)
        //   - indexData   : ข้อมูล Key Index ที่คีย์ไว้ เช่น { invoice_no: "INV-001" }
        //   - sizeFormatted: ขนาดไฟล์ที่อ่านง่าย
        // -------------------------------------------------------
        const allFiles = [];
        for (const pageRes of allPageResponses) {
            const files = pageRes.data.data.files;
            files
                .filter((f) => f.downloadUrl)
                .forEach((f) => allFiles.push({
                name: f.name,
                downloadUrl: f.downloadUrl,
                mimeType: f.mimeType,
                indexData: f.indexData || {}, // ข้อมูล Key Index ที่คีย์ไว้
                sizeFormatted: f.sizeFormatted,
            }));
        }
        console.log(`\n   🔗 ${allFiles.length} files ready to process`);
        // -------------------------------------------------------
        // STEP 4: นำข้อมูลไปใช้งานต่อ — เลือก pattern ที่เหมาะกับระบบของคุณ
        //
        // ตัวอย่าง Pattern ที่ใช้บ่อย:
        //
        // [A] บันทึกไฟล์ลง Disk (เหมาะกับ on-premise หรือ NAS)
        // [B] ส่งต่อไป Cloud Storage (S3, GCS, Azure Blob)
        // [C] ส่งเข้า Message Queue (RabbitMQ, Kafka, SQS) เพื่อประมวลผลแบบ async
        // [D] เรียก OCR / AI Pipeline ต่อทันที
        // [E] บันทึก indexData ลง Database ของตัวเอง
        // -------------------------------------------------------
        for (const file of allFiles) {
            console.log(`   📄 Processing: ${file.name} (${file.mimeType}, ${file.sizeFormatted})`);
            // แสดง indexData ที่คีย์ไว้ (ข้อมูล Key Index จาก Template)
            if (Object.keys(file.indexData).length > 0) {
                console.log(`      Index Data: ${JSON.stringify(file.indexData)}`);
                // ตัวอย่าง: อ่านค่า field เฉพาะ
                // const invoiceNo = file.indexData['invoice_no'];
                // const amount    = file.indexData['amount'];
            }
            // -------------------------------------------------------
            // [A] บันทึกไฟล์ลง Disk
            // -------------------------------------------------------
            // const downloadDir = path.join(process.cwd(), 'downloads', folderId);
            // if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });
            // const fileRes = await axios.get(file.downloadUrl, { responseType: 'arraybuffer' });
            // fs.writeFileSync(path.join(downloadDir, file.name), Buffer.from(fileRes.data));
            // console.log(`      ✅ Saved to disk: ${file.name}`);
            // -------------------------------------------------------
            // [B] ส่งต่อไป S3 (ต้องติดตั้ง @aws-sdk/client-s3)
            // -------------------------------------------------------
            // const fileRes = await axios.get(file.downloadUrl, { responseType: 'arraybuffer' });
            // await s3Client.send(new PutObjectCommand({
            //   Bucket: 'my-bucket',
            //   Key: `folders/${folderId}/${file.name}`,
            //   Body: Buffer.from(fileRes.data),
            //   ContentType: file.mimeType,
            //   Metadata: { folderId, ...file.indexData },
            // }));
            // console.log(`      ✅ Uploaded to S3: ${file.name}`);
            // -------------------------------------------------------
            // [C] ส่งเข้า Message Queue (ตัวอย่าง: HTTP Queue หรือ SQS)
            // ส่งแค่ URL + metadata ไม่ต้องดาวน์โหลดไฟล์ก่อน
            // Worker ฝั่งอื่นจะดาวน์โหลดและประมวลผลเอง
            // -------------------------------------------------------
            // await axios.post('http://my-queue-service/jobs', {
            //   type: 'PROCESS_FILE',
            //   folderId,
            //   folderCode: data.folderCode,
            //   fileName: file.name,
            //   mimeType: file.mimeType,
            //   downloadUrl: file.downloadUrl,  // Pre-signed URL หมดอายุใน 1 ชั่วโมง
            //   indexData: file.indexData,
            // });
            // console.log(`      ✅ Queued: ${file.name}`);
            // -------------------------------------------------------
            // [D] ส่งไฟล์เข้า OCR / AI Pipeline ของระบบลูกค้าเอง
            // เช่น OCR service ที่ลูกค้าสร้างเอง หรือ third-party ที่ลูกค้าใช้อยู่
            // -------------------------------------------------------
            // if (file.mimeType === 'application/pdf' || file.mimeType.startsWith('image/')) {
            //   const ocrResult = await axios.post('http://my-ocr-service/extract', {
            //     fileUrl: file.downloadUrl,
            //     fileName: file.name,
            //   });
            //   console.log(`      🔍 OCR Result: ${JSON.stringify(ocrResult.data)}`);
            // }
            // -------------------------------------------------------
            // [E] บันทึก indexData ลง Database ของตัวเอง (เช่น PostgreSQL, MongoDB)
            // -------------------------------------------------------
            // await db.collection('documents').insertOne({
            //   folderId,
            //   folderCode: data.folderCode,
            //   fileName: file.name,
            //   mimeType: file.mimeType,
            //   publishedAt: data.publishedAt,
            //   expiredAt: data.expiredAt,
            //   ...file.indexData,  // spread ข้อมูล Key Index เข้า document โดยตรง
            //   createdAt: new Date(),
            // });
            // console.log(`      ✅ Saved to DB: ${file.name}`);
        }
        console.log(`✨ FOLDER_PUBLISHED handled successfully: ${folderId}`);
    }
    catch (error) {
        console.error('❌ handleFolderPublished Error:', error.response?.data || error.message);
    }
}
// ============================================================
// Handler: FOLDER_EXPIRED
// เมื่อโฟลเดอร์หมดอายุ
// ============================================================
function handleFolderExpired(data) {
    const folderId = data?.folderId;
    console.log(`\n⏰ FOLDER_EXPIRED: ${folderId}`);
    console.log(`   รหัสโฟลเดอร์ : ${data?.folderCode || '-'}`);
    console.log(`   ชื่อโฟลเดอร์  : ${data?.folderName || '-'}`);
    console.log(`   หมดอายุเมื่อ  : ${data?.expiredAt || '-'}`);
    console.log(`   กำหนดหมดอายุ : ${data?.expireAt || '-'}`);
    console.log(`   จำนวนไฟล์    : ${data?.fileCount ?? '-'}`);
    // ตรงนี้ใส่ logic ที่ต้องการเมื่อ folder หมดอายุ
    // เช่น: ลบข้อมูลที่ cache ไว้, แจ้งเตือน user, อัปเดต database ฝั่งตัวเอง
}
// ============================================================
// Handler: FOLDER_REVOKED
// เมื่อโฟลเดอร์ถูกยกเลิก/ลบ
// ============================================================
function handleFolderRevoked(data) {
    const folderId = data?.folderId;
    console.log(`\n🚫 FOLDER_REVOKED: ${folderId}`);
    console.log(`   รหัสโฟลเดอร์ : ${data?.folderCode || '-'}`);
    console.log(`   ชื่อโฟลเดอร์  : ${data?.folderName || '-'}`);
    console.log(`   ยกเลิกเมื่อ   : ${data?.revokedAt || '-'}`);
    console.log(`   จำนวนไฟล์    : ${data?.fileCount ?? '-'}`);
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
    console.log(`  POST   http://localhost:${PORT}/api/webhook-test          — ทดสอบ Webhook (TEST_CONNECTION)`);
    console.log(`  DELETE http://localhost:${PORT}/api/webhook-config        — ปิดการใช้งาน Webhook`);
    console.log(`  POST   http://localhost:${PORT}/api/webhook               — รับ Webhook Event จาก SST`);
    console.log('==================================================');
    console.log(`Config: SST_API_URL=${SST_API_URL}, CUSTOMER_ID=${CUSTOMER_ID ? '✅ set' : '❌ missing'}, SECRET_KEY=${SECRET_KEY ? '✅ set' : '❌ missing'}`);
    console.log('==================================================');
});
