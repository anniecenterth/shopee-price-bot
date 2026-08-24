// ─────────────────────────────────────────────────────────────────────────────
// price-bot · บอทเช็คราคาก่อนซื้อ (Telegram + Supabase Edge Function)
//
// พิมพ์ชื่อของในแชท → ตอบราคาที่ "เคยจ่ายจริง" จากประวัติสั่งซื้อ Shopee
// ของตัวเอง พร้อมลิงก์ค้นราคาปัจจุบันให้กดดูเอง
//
// ⚠️ บอทนี้ไม่ดึงราคาปัจจุบันจาก Shopee อัตโนมัติ และจะไม่ทำ
//    Shopee บล็อกการดึงผลค้นหาด้วย CAPTCHA (scene=crawler_item)
//    การหลบเลี่ยงไม่อยู่ในขอบเขตของโปรเจกต์นี้ — บอทส่ง "ลิงก์" ให้กดเอง
//
// ตรรกะล้วน ๆ อยู่ใน lib.ts (เขียนเทสต์ไว้ที่ lib.test.ts)
// ─────────────────────────────────────────────────────────────────────────────
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  callbackData,
  buttonLabel,
  type Grouped,
  groupAndRank,
  HELP,
  normalizeQuery,
  notFoundAnswer,
  priceAnswer,
  PURCHASE_COLS,
  type PurchaseRow,
  stripPricePrefix,
} from "./lib.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";

/** chat id ที่อนุญาต คั่นด้วยจุลภาค — ว่างไว้ = ไม่อนุญาตใคร (ปลอดภัยไว้ก่อน)
 *  บอทจะบอก chat id กลับไปให้ เอาไปใส่ใน env ได้เลย */
const ALLOWED_CHAT_IDS = (Deno.env.get("TELEGRAM_ALLOWED_CHAT_IDS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const H = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// ─────────────────────────────────────────────────────────────
// ฐานข้อมูล
// ─────────────────────────────────────────────────────────────

/** ดึงแถวที่ search_text มีครบทุก token (AND) */
async function findPurchases(query: string): Promise<PurchaseRow[]> {
  const tokens = normalizeQuery(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const conds = tokens.map((t) => `search_text.ilike.*${t}*`).join(",");
  // nullslast สำคัญ: Postgres เรียง DESC จะเอา NULL ขึ้นก่อน ทำให้ "ซื้อล่าสุด" ผิด
  const url = `${SB_URL}/rest/v1/purchases?select=${PURCHASE_COLS}`
    + `&and=(${conds})&order=purchased_at.desc.nullslast&limit=500`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error("findPurchases failed:", r.status, await r.text()); return []; }
  return await r.json();
}

async function purchasesByItem(
  itemId: string | number,
  modelId: string | number | null,
): Promise<PurchaseRow[]> {
  const mf = modelId ? `&model_id=eq.${modelId}` : "";
  const url = `${SB_URL}/rest/v1/purchases?select=${PURCHASE_COLS}`
    + `&item_id=eq.${itemId}${mf}&order=purchased_at.desc.nullslast&limit=500`;
  const r = await fetch(url, { headers: H });
  if (!r.ok) { console.error("purchasesByItem failed:", r.status, await r.text()); return []; }
  return await r.json();
}

async function lookupAlias(query: string): Promise<{ item_id: number; model_id: number | null } | null> {
  const url = `${SB_URL}/rest/v1/item_aliases`
    + `?alias=eq.${encodeURIComponent(normalizeQuery(query))}&select=item_id,model_id`;
  const rows = await fetch(url, { headers: H }).then((r) => r.json()).catch(() => []);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function rememberAlias(alias: string, itemId: number, modelId: number | null, who: string) {
  await fetch(`${SB_URL}/rest/v1/item_aliases`, {
    method: "POST",
    headers: { ...H, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ alias, item_id: itemId, model_id: modelId, created_by: who }),
  });
}

// ─────────────────────────────────────────────────────────────
// Telegram
// ─────────────────────────────────────────────────────────────

async function tg(method: string, body: unknown) {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  }).then((r) => r.json());
  // ต้องเช็คผลลัพธ์เสมอ ไม่งั้นบอทเงียบสนิทเวลา Telegram ปฏิเสธ
  // (เคยเจอจริง: callback_data ยาวเกิน 64 ไบต์)
  if (!res.ok) {
    console.error(`telegram ${method} failed:`, res.description, JSON.stringify(body).slice(0, 300));
  }
  return res;
}

/** ส่งข้อความ ถ้าตอบกลับแบบ reply ไม่ได้ ให้ส่งแบบธรรมดาแทน จะได้ไม่เงียบ */
async function sendSafe(
  chatId: number | string,
  text: string,
  replyTo?: number,
  extra: Record<string, unknown> = {},
) {
  const first = await tg("sendMessage", { chat_id: chatId, text, reply_to_message_id: replyTo, ...extra });
  if (first.ok) return first;
  const second = await tg("sendMessage", { chat_id: chatId, text, ...extra });
  if (!second.ok) console.error("sendSafe: ส่งไม่สำเร็จทั้งสองแบบ", second.description);
  return second;
}

const ok = () => new Response("ok", { status: 200 });

// ─────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // ยืนยันว่ามาจาก Telegram จริง — ตั้ง secret ตอน setWebhook
  if (!WEBHOOK_SECRET || req.headers.get("x-telegram-bot-api-secret-token") !== WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  if (!BOT_TOKEN) {
    console.error("ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN");
    return ok();
  }

  let update: Record<string, any>;
  try { update = await req.json(); } catch { return ok(); }

  // ── ผู้ใช้กดเลือกสินค้าจากรายการตัวเลือก (ไม่มี update.message) ──
  if (update.callback_query) {
    const cq = update.callback_query;
    if (!ALLOWED_CHAT_IDS.includes(String(cq.message?.chat?.id))) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      return ok();
    }
    const [kind, itemId, modelRaw] = String(cq.data || "").split("|");
    if (kind !== "p") return ok();

    const modelId = modelRaw === "0" ? null : Number(modelRaw);
    // คำค้นเดิมอยู่ในข้อความที่บอทตอบกลับ ไม่ต้องยัดลง callback_data (จำกัด 64 ไบต์)
    const original = cq.message?.reply_to_message?.text || cq.message?.reply_to_message?.caption || "";
    const alias = normalizeQuery(stripPricePrefix(original));
    const who = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(" ") || "ไม่ทราบชื่อ";

    if (alias) await rememberAlias(alias, Number(itemId), modelId, who);

    const groups = groupAndRank(await purchasesByItem(itemId, modelId));
    await tg("answerCallbackQuery", { callback_query_id: cq.id, text: alias ? "จำไว้แล้ว" : "ได้เลย" });
    if (groups.length) {
      await sendSafe(cq.message.chat.id, priceAnswer(groups[0], alias || groups[0].latest.name));
    }
    return ok();
  }

  const msg = update.message;
  if (!msg?.chat || !msg?.from) return ok();

  const chatId = String(msg.chat.id);
  const text: string = (msg.text || msg.caption || "").trim();
  if (!text) return ok();

  // ── ใครใช้ได้บ้าง ──
  // ค่าเริ่มต้นคือไม่อนุญาตใครเลย แล้วบอก chat id กลับไปให้เอาไปใส่ env
  if (!ALLOWED_CHAT_IDS.includes(chatId)) {
    await sendSafe(
      chatId,
      `บอทนี้ยังไม่เปิดให้แชทนี้ใช้งาน\n\nchat id ของแชทนี้คือ:\n${chatId}\n\n`
      + `ถ้าคุณเป็นเจ้าของบอท ใส่ค่านี้ใน TELEGRAM_ALLOWED_CHAT_IDS แล้ว deploy ใหม่`,
      msg.message_id,
    );
    return ok();
  }

  if (/^\/(start|help)/.test(text)) {
    await sendSafe(chatId, HELP, msg.message_id);
    return ok();
  }

  // ── ถามราคา ──
  const query = stripPricePrefix(text);
  if (!query) {
    await sendSafe(chatId, HELP, msg.message_id);
    return ok();
  }

  // ชื่อเล่นที่เคยสอนไว้มาก่อน ถ้ามีก็ตอบตรงนั้นเลย
  const alias = await lookupAlias(query);
  const groups: Grouped[] = alias
    ? groupAndRank(await purchasesByItem(alias.item_id, alias.model_id))
    : groupAndRank(await findPurchases(query));

  if (!groups.length) {
    await sendSafe(chatId, notFoundAnswer(query), msg.message_id);
    return ok();
  }

  // ชัดเจนพอ → ตอบเลย
  if (groups.length === 1 || groups[0].score >= groups[1].score * 2) {
    await sendSafe(chatId, priceAnswer(groups[0], query), msg.message_id);
    return ok();
  }

  // ไม่ชัด → ให้เลือก แล้วจำเป็น alias
  // คำค้นเดิมดึงจาก cq.message.reply_to_message.text ตอนผู้ใช้กดปุ่ม
  const top = groups.slice(0, 5);
  await sendSafe(
    chatId,
    `"${query}" มี ${groups.length} แบบที่เคยซื้อ — เลือกแบบที่ใช่ แล้วครั้งหน้าจะจำให้\n`
    + `(รุ่น · ราคาต่อหน่วยล่าสุด · จำนวนครั้งที่ซื้อ)`,
    msg.message_id,
    {
      reply_markup: {
        inline_keyboard: top.map((g) => [{
          text: buttonLabel(g),
          callback_data: callbackData(g.latest.item_id, g.latest.model_id),
        }]),
      },
    },
  );
  return ok();
});
