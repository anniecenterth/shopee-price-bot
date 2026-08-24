// รัน: deno test --allow-read
//
// เทสต์ครอบ "กับดัก" ที่เคยทำระบบพังจริง ไม่ได้เขียนไว้ให้ครบตามพิธี
// ข้อมูลทดสอบทั้งหมดเป็นข้อมูลสมมติ
import { assert, assertEquals } from "jsr:@std/assert";
import {
  beShort,
  buttonLabel,
  callbackData,
  displayName,
  groupAndRank,
  normalizeQuery,
  notFoundAnswer,
  priceAnswer,
  type PurchaseRow,
  stripPricePrefix,
} from "./lib.ts";

// ─────────────────────────────────────────────────────────────
// กับดัก 1 — normalize ของบอทกับของสคริปต์นำเข้าต้องตรงกันเป๊ะ
// ถ้าไม่ตรง ข้อมูลจะถูกนำเข้าด้วยกฎหนึ่งแต่ค้นด้วยอีกกฎหนึ่ง = ค้นไม่เจอทั้งระบบ
// ─────────────────────────────────────────────────────────────
Deno.test("normalize ของ lib.ts กับ shopee-scan.js ต้องเหมือนกัน", () => {
  const grab = (src: string) => {
    const start = src.indexOf(".toLowerCase()");
    const end = src.indexOf(".trim();", start);
    assert(start > 0 && end > start, "หา normalize ในไฟล์ไม่เจอ");
    return src.slice(start, end).replace(/\s+/g, "").replace(/['"]/g, "");
  };
  const lib = Deno.readTextFileSync(new URL("./lib.ts", import.meta.url));
  const scan = Deno.readTextFileSync(new URL("../../../scripts/shopee-scan.js", import.meta.url));
  assertEquals(
    grab(lib),
    grab(scan),
    "normalizeQuery (lib.ts) กับ normalize (shopee-scan.js) ไม่ตรงกัน — แก้ให้ตรงกันทั้งสองไฟล์",
  );
});

// ─────────────────────────────────────────────────────────────
// กับดัก 2 — callback_data ของ Telegram ห้ามเกิน 64 ไบต์
// เคยพังจริงเพราะยัดคำค้นภาษาไทยลงไป (ไทย 1 ตัว = 3 ไบต์)
// Telegram ปฏิเสธทั้งข้อความ ผลคือบอทเงียบสนิทโดยไม่มี error ให้เห็น
// ─────────────────────────────────────────────────────────────
Deno.test("callbackData ไม่เกิน 64 ไบต์แม้ id ยาวสุด", () => {
  const data = callbackData(999_999_999_999_999, 888_888_888_888_888);
  const bytes = new TextEncoder().encode(data).length;
  assert(bytes <= 64, `callback_data ยาว ${bytes} ไบต์`);
  assertEquals(callbackData(123, null), "p|123|0");
});

Deno.test("callbackData เป็น ASCII ล้วน ไม่มีอักษรไทยหลุดเข้าไป", () => {
  const data = callbackData(123456789, 987654321);
  assertEquals(new TextEncoder().encode(data).length, data.length);
});

// ─────────────────────────────────────────────────────────────
// normalize / display
// ─────────────────────────────────────────────────────────────
Deno.test("normalizeQuery แปลงสัญลักษณ์คูณให้เป็น x", () => {
  assertEquals(normalizeQuery("ถุงซิป 10*15"), "ถุงซิป 10x15");
  assertEquals(normalizeQuery("ถุงซิป 10 × 15"), "ถุงซิป 10x15");
  assertEquals(normalizeQuery("ถุงซิป 10X15"), "ถุงซิป 10x15");
});

Deno.test("normalizeQuery ตัดคำโปรยการตลาดออก", () => {
  assertEquals(normalizeQuery("กล่องกระดาษ พร้อมส่ง ส่งฟรี"), "กล่องกระดาษ");
  assertEquals(normalizeQuery("ถาดพลาสติก ราคาส่ง"), "ถาดพลาสติก");
});

Deno.test("normalizeQuery ตัดอิโมจิและช่องว่างซ้ำ", () => {
  assertEquals(normalizeQuery("🔥 ถุงซิป   ล็อค 📦"), "ถุงซิป ล็อค");
});

Deno.test("normalizeQuery รับค่าว่าง/undefined ได้", () => {
  assertEquals(normalizeQuery(""), "");
  assertEquals(normalizeQuery(undefined as unknown as string), "");
});

Deno.test("stripPricePrefix ตัดคำนำหน้าที่ผู้ใช้พิมพ์", () => {
  assertEquals(stripPricePrefix("ราคา ถุงซิป 10*15"), "ถุงซิป 10*15");
  assertEquals(stripPricePrefix("? ถุงซิป"), "ถุงซิป");
  assertEquals(stripPricePrefix("ถุงซิป 10*15"), "ถุงซิป 10*15");
});

Deno.test("displayName เก็บกวาดวงเล็บที่ว่างหลังตัดคำโปรย", () => {
  // "(พร้อมส่ง)" กลายเป็น "( )" หลัง normalize ต้องไม่เหลือค้างในชื่อที่โชว์
  assertEquals(displayName("กล่องกระดาษ (พร้อมส่ง)"), "กล่องกระดาษ");
  assertEquals(displayName("- กล่องกระดาษ"), "กล่องกระดาษ");
});

// ─────────────────────────────────────────────────────────────
// วันที่ พ.ศ.
// ─────────────────────────────────────────────────────────────
Deno.test("beShort แปลง ค.ศ. เป็น พ.ศ.", () => {
  assertEquals(beShort("2025-03-05"), "05/03/68");
  assertEquals(beShort(null), "ไม่ระบุวันที่");
});

// ─────────────────────────────────────────────────────────────
// จัดกลุ่ม + จัดอันดับ  (ข้อมูลสมมติทั้งหมด)
// ─────────────────────────────────────────────────────────────
function row(over: Partial<PurchaseRow> = {}): PurchaseRow {
  return {
    item_id: 123456789, model_id: null, shop_id: 987654321,
    shop_name: "ตัวอย่างร้านค้า",
    name: "สินค้าตัวอย่าง", model_name: "", qty: 1,
    list_price: 180, paid_price: 149, unit_price: 149,
    purchased_at: "2025-03-05",
    ...over,
  };
}

const NOW = new Date("2025-04-01T00:00:00Z").getTime();

Deno.test("groupAndRank แยกกลุ่มตาม item_id + model_id", () => {
  const g = groupAndRank([
    row({ model_id: 1 }),
    row({ model_id: 2 }),
    row({ model_id: 1 }),
  ], NOW);
  assertEquals(g.length, 2);
  assertEquals(g[0].count, 2); // กลุ่มที่ซื้อ 2 ครั้งต้องมาก่อน
});

Deno.test("groupAndRank คิด min/max จากราคาต่อหน่วย", () => {
  const g = groupAndRank([
    row({ unit_price: 149 }),
    row({ unit_price: 132.5 }),
    row({ unit_price: 180 }),
  ], NOW);
  assertEquals(g[0].min, 132.5);
  assertEquals(g[0].max, 180);
  assertEquals(g[0].count, 3);
});

Deno.test("groupAndRank ไม่นับราคา 0 เป็นราคาต่ำสุด", () => {
  const g = groupAndRank([row({ unit_price: 0 }), row({ unit_price: 120 })], NOW);
  assertEquals(g[0].min, 120);
});

Deno.test("groupAndRank แถวที่ไม่มีวันที่ต้องไม่ถูกเลือกเป็นรายการล่าสุด", () => {
  // Postgres เรียง DESC เอา NULL ขึ้นก่อน ถ้าไม่กันไว้ "ซื้อล่าสุด" จะผิด
  const g = groupAndRank([
    row({ purchased_at: null, unit_price: 999 }),
    row({ purchased_at: "2025-03-05", unit_price: 149 }),
  ], NOW);
  assertEquals(g[0].latest.purchased_at, "2025-03-05");
  assertEquals(g[0].latest.unit_price, 149);
});

Deno.test("groupAndRank ให้แต้มพิเศษกับของที่ซื้อภายใน 90 วัน", () => {
  const recent = groupAndRank([row({ item_id: 1, purchased_at: "2025-03-05" })], NOW)[0];
  const old = groupAndRank([row({ item_id: 2, purchased_at: "2023-01-01" })], NOW)[0];
  assert(recent.score > old.score, "ของที่เพิ่งซื้อควรได้คะแนนมากกว่า");
});

// ─────────────────────────────────────────────────────────────
// ข้อความตอบ
// ─────────────────────────────────────────────────────────────
Deno.test("priceAnswer คิดเปอร์เซ็นต์ส่วนลดจากราคาป้ายกับราคาที่จ่ายจริง", () => {
  const g = groupAndRank([row({ list_price: 180, paid_price: 149, unit_price: 149 })], NOW)[0];
  const out = priceAnswer(g, "ถุงซิป");
  assert(out.includes("ราคาป้าย ฿180 → จ่ายจริง ฿149 (ลด 17%)"), out);
  assert(out.includes("ราคาต่อหน่วย ฿149"));
});

Deno.test("priceAnswer ไม่โชว์บรรทัดส่วนลดถ้าไม่ได้ลด", () => {
  const g = groupAndRank([row({ list_price: 100, paid_price: 100, unit_price: 100 })], NOW)[0];
  const out = priceAnswer(g, "ของ");
  assert(out.includes("จ่ายจริง ฿100"));
  assert(!out.includes("ลด "), "ไม่ควรมีบรรทัดส่วนลด");
});

Deno.test("priceAnswer เตือนราคาถูกสุดเฉพาะตอนที่เคยได้ถูกกว่าครั้งล่าสุด", () => {
  const cheaper = groupAndRank([
    row({ unit_price: 149, purchased_at: "2025-03-05" }),
    row({ unit_price: 132.5, purchased_at: "2024-01-01" }),
  ], NOW)[0];
  assert(priceAnswer(cheaper, "x").includes("ถูกที่สุดที่เคยได้คือ ฿132.5"));

  const same = groupAndRank([row({ unit_price: 149 })], NOW)[0];
  assert(!priceAnswer(same, "x").includes("ถูกที่สุดที่เคยได้"), "ราคาเดียวไม่ต้องเตือนซ้ำ");
});

Deno.test("priceAnswer ตัดชื่อสินค้าที่ยาวเกินและใส่จุดไข่ปลา", () => {
  const g = groupAndRank([row({ name: "ก".repeat(120) })], NOW)[0];
  assert(priceAnswer(g, "x").includes("…"));
});

Deno.test("priceAnswer ใส่ลิงก์ค้นหาที่ encode คำไทยถูกต้อง", () => {
  const g = groupAndRank([row()], NOW)[0];
  const out = priceAnswer(g, "ถุงซิป");
  assert(out.includes("https://shopee.co.th/search?keyword=" + encodeURIComponent("ถุงซิป")));
  assert(out.includes("sortBy=price&order=asc"), "ต้องเรียงจากถูกไปแพง");
});

Deno.test("priceAnswer ลิงก์ร้านเดิมถอยไปใช้การค้นหาเมื่อไม่มี shop_id", () => {
  const g = groupAndRank([row({ shop_id: null, item_id: 555 })], NOW)[0];
  assert(priceAnswer(g, "x").includes("keyword=555"));
});

Deno.test("notFoundAnswer ยังให้ลิงก์ค้นหาไปต่อได้", () => {
  const out = notFoundAnswer("ของที่ไม่เคยซื้อ");
  assert(out.includes("ยังไม่เคยซื้อ"));
  assert(out.includes("https://shopee.co.th/search?keyword="));
});

Deno.test("buttonLabel ขึ้นต้นด้วยชื่อรุ่น เพราะชื่อสินค้ามักซ้ำกันหมด", () => {
  const g = groupAndRank([row({ model_name: "ขนาด 10x15 (100 ใบ)", unit_price: 149 })], NOW)[0];
  const label = buttonLabel(g);
  assert(label.startsWith("ขนาด 10x15"), label);
  assert(label.includes("฿149"));
  assert(label.includes("1 ครั้ง"));
});
