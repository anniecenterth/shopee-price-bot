/**
 * อัปโหลดไฟล์ purchases.json (จาก scripts/shopee-scan.js) เข้า Supabase
 *
 *   SUPABASE_URL=https://xxxx.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx \
 *   node scripts/upload.mjs purchases.json
 *
 * รันซ้ำได้ตลอด — unique index (order_id, item_id, model_id) กันข้อมูลซ้ำเอง
 * ต้องใช้ service role key เพราะตาราง purchases เปิด RLS ไว้โดยไม่มี policy
 * (ดูเหตุผลใน supabase/migrations/0001_purchases.sql)
 *
 * ⚠️ service role key ข้ามทุก RLS — รันบนเครื่องตัวเองเท่านั้น
 *    ห้ามวางลงคอนโซลเบราว์เซอร์ ห้าม commit ห้ามส่งทางแชท
 */
import { readFileSync } from 'node:fs';

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const file = process.argv[2] || 'purchases.json';
const BATCH = 300;

if (!SB_URL || !SB_KEY) {
  console.error('❌ ต้องตั้ง SUPABASE_URL และ SUPABASE_SERVICE_ROLE_KEY ก่อน');
  process.exit(1);
}

let rows;
try {
  rows = JSON.parse(readFileSync(file, 'utf8'));
} catch (e) {
  console.error(`❌ อ่านไฟล์ ${file} ไม่ได้:`, e.message);
  process.exit(1);
}
if (!Array.isArray(rows) || !rows.length) {
  console.error('❌ ไฟล์ไม่มีข้อมูล');
  process.exit(1);
}

const required = ['order_id', 'item_id', 'name', 'search_text'];
const badRow = rows.findIndex(r => required.some(k => r[k] === undefined || r[k] === null || r[k] === ''));
if (badRow >= 0) {
  console.error(`❌ แถวที่ ${badRow} ข้อมูลไม่ครบ (ต้องมี ${required.join(', ')})`);
  process.exit(1);
}

let done = 0;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const res = await fetch(`${SB_URL}/rest/v1/purchases`, {
    method: 'POST',
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal,resolution=ignore-duplicates',
    },
    body: JSON.stringify(chunk),
  });
  if (!res.ok) {
    console.error('❌ อัปโหลดล้มเหลวที่แถว', i, res.status, await res.text());
    process.exit(1);
  }
  done += chunk.length;
  process.stdout.write(`\rอัปโหลดแล้ว ${done}/${rows.length} บรรทัด`);
}
console.log(`\n✅ เสร็จ ${done} บรรทัด (แถวที่ซ้ำถูกข้ามอัตโนมัติ)`);
