// ─────────────────────────────────────────────────────────────────────────────
// ตรรกะล้วน ๆ ของบอท — ไม่มีการเรียกเครือข่าย ไม่อ่าน env
// แยกออกมาเพื่อให้เขียนเทสต์ได้ (index.ts มี Deno.serve อยู่ระดับบนสุด)
// ─────────────────────────────────────────────────────────────────────────────

/** normalize ให้ตรงกับคอลัมน์ purchases.search_text
 *  ⚠️ ต้องตรงกับ normalize() ใน scripts/shopee-scan.js เป๊ะ
 *     ถ้าแก้ที่นี่ต้องแก้ที่นั่นด้วย ไม่งั้นค้นไม่เจอทั้งระบบ */
export function normalizeQuery(s: string): string {
  return String(s || "")
    .toLowerCase()
    .replace(/(\d)\s*[*×x]\s*(\d)/g, "$1x$2")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, " ")
    .replace(/พร้อมส่ง|ส่งฟรี|ราคาส่ง|ราคาโรงงาน|ขายส่ง/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** ตัดคำนำหน้าที่ผู้ใช้พิมพ์เพื่อความชัดเจน ("ราคา ถุงซิป 10*15" → "ถุงซิป 10*15") */
export function stripPricePrefix(text: string): string {
  return text.trim().replace(/^(ราคา|\?)\s*/, "").trim();
}

/** ชื่อสินค้าสำหรับ "แสดงผล" — ตัดคำโปรยแล้วเก็บกวาดวงเล็บที่เหลือว่าง
 *  แยกจาก normalizeQuery เพราะอันนั้นใช้เป็นกุญแจค้นหาและกุญแจ alias
 *  ห้ามเปลี่ยนพฤติกรรม */
export function displayName(s: string): string {
  return normalizeQuery(s)
    .replace(/\(\s*\)/g, " ")
    .replace(/\[\s*\]/g, " ")
    .replace(/^[\s\-–·,]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export type PurchaseRow = {
  item_id: number; model_id: number | null; shop_id: number | null;
  shop_name: string; name: string; model_name: string;
  qty: number; list_price: number; paid_price: number;
  unit_price: number; purchased_at: string | null;
};

export const PURCHASE_COLS =
  "item_id,model_id,shop_id,shop_name,name,model_name,qty,list_price,paid_price,unit_price,purchased_at";

export function searchLink(q: string): string {
  return `https://shopee.co.th/search?keyword=${encodeURIComponent(q)}&sortBy=price&order=asc`;
}

export function productLink(shopId: number | null, itemId: number): string {
  return shopId
    ? `https://shopee.co.th/product/${shopId}/${itemId}`
    : `https://shopee.co.th/search?keyword=${itemId}`;
}

/** วันที่แบบไทย dd/mm/yy พ.ศ. */
export function beShort(iso: string | null): string {
  if (!iso) return "ไม่ระบุวันที่";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${String((parseInt(y) + 543) % 100).padStart(2, "0")}`;
}

export const baht = (n: number) =>
  "฿" + Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });

export type Grouped = {
  key: string; latest: PurchaseRow; count: number;
  min: number; max: number; score: number;
};

/** จัดกลุ่มตามสินค้า+รุ่น แล้วให้คะแนน — ซื้อบ่อย + ซื้อล่าสุดใน 90 วัน ได้คะแนนสูง
 *  รับ now เข้ามาเพื่อให้เทสต์กำหนดเวลาได้ */
export function groupAndRank(rows: PurchaseRow[], now: number = Date.now()): Grouped[] {
  const g: Record<string, PurchaseRow[]> = {};
  rows.forEach((r) => {
    const k = `${r.item_id}|${r.model_id ?? 0}`;
    (g[k] = g[k] || []).push(r);
  });
  const cutoff = now - 90 * 24 * 3600 * 1000;
  return Object.keys(g).map((k) => {
    const list = g[k];
    // แถวที่ไม่มีวันที่ให้ไปท้ายสุด ไม่ให้ถูกเลือกเป็น "ล่าสุด"
    const sorted = [...list].sort((a, b) => ((a.purchased_at || "") < (b.purchased_at || "") ? 1 : -1));
    const latest = sorted[0];
    const prices = list.map((r) => Number(r.unit_price)).filter((p) => p > 0);
    let score = list.length * 2;
    if (latest.purchased_at && new Date(latest.purchased_at).getTime() >= cutoff) score += 3;
    return {
      key: k, latest, count: list.length,
      min: prices.length ? Math.min(...prices) : 0,
      max: prices.length ? Math.max(...prices) : 0,
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

/**
 * ป้ายบนปุ่มเลือก — ต้องขึ้นต้นด้วยสิ่งที่ "ต่างกัน" ไม่ใช่ชื่อสินค้า
 * ชื่อสินค้าใน Shopee เป็นคำโปรยยัดคีย์เวิร์ด 40 ตัวแรกมักเหมือนกันหมด
 * ทำให้ผู้ใช้เลือกไม่ถูกเพราะ Telegram ตัดข้อความท้ายปุ่มทิ้ง
 */
export function buttonLabel(g: Grouped): string {
  const l = g.latest;
  const variant = (l.model_name || "").trim()
    ? (l.model_name || "").trim()
    : displayName(l.name).replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  return `${variant.slice(0, 26)} · ${baht(l.unit_price)} · ${g.count} ครั้ง`;
}

/** callback_data ของ Telegram จำกัด 64 ไบต์ — ตัวไทย 1 ตัว = 3 ไบต์
 *  จึงใส่ได้แค่ id ที่เป็น ASCII ล้วน ห้ามยัดคำค้นภาษาไทยลงไป
 *  (เคยพังจริง: Telegram ปฏิเสธทั้งข้อความ บอทเงียบสนิท) */
export function callbackData(itemId: number, modelId: number | null): string {
  return `p|${itemId}|${modelId ?? 0}`;
}

export function priceAnswer(g: Grouped, query: string): string {
  const l = g.latest;
  // ชื่อสินค้า Shopee ยัดคีย์เวิร์ดยาวมาก ตัดคำโปรยและจำกัดความยาวให้อ่านง่าย
  const shortName = displayName(l.name);
  const nameLine = shortName.length > 58 ? shortName.slice(0, 58) + "…" : shortName;
  const title = (l.model_name || "").trim() ? `${nameLine}\n🎨 ${l.model_name}` : nameLine;
  const list = Number(l.list_price) || 0;
  const paid = Number(l.paid_price) || 0;
  const discountPct = list > 0 && paid > 0 && paid < list ? Math.round((1 - paid / list) * 100) : 0;
  const priceLine = discountPct > 0
    ? `ราคาป้าย ${baht(list)} → จ่ายจริง ${baht(paid)} (ลด ${discountPct}%)`
    : `จ่ายจริง ${baht(paid)}`;
  const lines = [
    `📌 ราคาอ้างอิงจากประวัติซื้อของคุณ`,
    ``,
    title,
    `🏪 ${l.shop_name}`,
    `📅 ซื้อล่าสุด ${beShort(l.purchased_at)}`,
    ``,
    `จำนวน ${l.qty}`,
    priceLine,
    `ราคาต่อหน่วย ${baht(l.unit_price)}`,
    ``,
    `ช่วงราคาที่เคยได้ ${baht(g.min)} – ${baht(g.max)} · ซื้อมาแล้ว ${g.count} ครั้ง`,
    ``,
    `🛒 ร้านเดิม: ${productLink(l.shop_id, l.item_id)}`,
    ``,
    `🔍 ค้นราคาใหม่ตอนนี้ (เรียงถูก→แพง)`,
    searchLink(query),
    ``,
    `ถ้าเจอต่ำกว่า ${baht(l.unit_price)} = คุ้มกว่าครั้งที่แล้ว`,
  ];
  // เตือนเฉพาะตอนที่เคยได้ถูกกว่าครั้งล่าสุดจริง ๆ ไม่งั้นเป็นบรรทัดซ้ำซ้อน
  if (g.min > 0 && g.min < Number(l.unit_price)) {
    lines.push(`ถูกที่สุดที่เคยได้คือ ${baht(g.min)}`);
  }
  return lines.join("\n");
}

export function notFoundAnswer(query: string): string {
  return [
    `ยังไม่เคยซื้อ "${query}" — ไม่มีราคาอ้างอิง`,
    ``,
    `🔍 ค้นราคาใน Shopee (เรียงถูก→แพง)`,
    searchLink(query),
  ].join("\n");
}

export const HELP = [
  "สวัสดีค่ะ 🔍 บอทเช็คราคาก่อนซื้อ",
  "",
  "พิมพ์ชื่อของที่จะซื้อได้เลย เช่น",
  '• "ถุงซิป 10*15"',
  '• "กล่องกระดาษ"',
  "",
  "จะได้ราคาที่เคยจ่ายจริง + ลิงก์ค้นราคาปัจจุบันใน Shopee",
  "ถ้าเจอหลายแบบ บอทจะให้เลือก แล้วครั้งหน้าจะจำชื่อเล่นนั้นให้",
].join("\n");
