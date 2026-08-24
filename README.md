# price-bot — บอทเช็คราคาก่อนซื้อ

พิมพ์ชื่อของในแชท Telegram แล้วได้ราคาที่ **คุณเคยจ่ายจริง** จากประวัติสั่งซื้อ Shopee ของตัวเอง
พร้อมลิงก์ค้นราคาปัจจุบันให้กดดูเอง — จะได้รู้ว่าที่กำลังจะกดซื้อนี่ แพงกว่าเดิมหรือเปล่า

> A Telegram bot that answers "how much did I pay for this last time?" from your own
> Shopee order history, then links you to a live price search. Thai-language, built for
> small shop owners who restock the same supplies over and over.

```
คุณ:  ถุงซิป

บอท: 📌 ราคาอ้างอิงจากประวัติซื้อของคุณ

     (100 ใบ/แพ็ค) ถุงซิปล็อค ถุงใส่ขนม ถุงซิปใสห…
     🎨 ขนาด 10x15 (100 ใบ)
     🏪 ตัวอย่างร้านค้า
     📅 ซื้อล่าสุด 05/03/68

     จำนวน 1
     ราคาป้าย ฿180 → จ่ายจริง ฿149 (ลด 17%)
     ราคาต่อหน่วย ฿149

     ช่วงราคาที่เคยได้ ฿132.50 – ฿180 · ซื้อมาแล้ว 12 ครั้ง

     🛒 ร้านเดิม: https://shopee.co.th/product/…
     🔍 ค้นราคาใหม่ตอนนี้ (เรียงถูก→แพง)
     https://shopee.co.th/search?keyword=…&sortBy=price&order=asc

     ถ้าเจอต่ำกว่า ฿149 = คุ้มกว่าครั้งที่แล้ว
     ถูกที่สุดที่เคยได้คือ ฿132.50
```

> ตัวอย่างข้างบนเป็นข้อมูลสมมติทั้งหมด ไม่ใช่ประวัติการซื้อของใคร

ถ้าคำที่พิมพ์ตรงกับของหลายแบบ บอทจะให้เลือก แล้ว **จำชื่อเล่นนั้นไว้** ครั้งหน้าตอบทันที

---

## บอทนี้ไม่ทำอะไรบ้าง

อ่านตรงนี้ก่อนตัดสินใจใช้ — ข้อจำกัดพวกนี้แก้ไม่ได้ ไม่ใช่ฟีเจอร์ที่ยังไม่ได้ทำ

- **ไม่ดึงราคาปัจจุบันจาก Shopee อัตโนมัติ** Shopee บล็อกการดึงผลค้นหาด้วย CAPTCHA
  (`scene=crawler_item`) บอทจึงส่ง *ลิงก์* ให้กดดูเอง
  โปรเจกต์นี้จะไม่เพิ่มระบบแก้ CAPTCHA และไม่รับ PR ที่ทำแบบนั้น
- **ไม่สั่งซื้อให้** เป็นตัวช่วยตัดสินใจอย่างเดียว การกดซื้อยังเป็นของคุณ
- **ไม่ใช้ Shopee Open API** เพราะ Affiliate/Open API ต้องเป็นบัญชีที่มี Key Account Manager
  บัญชีบุคคลทั่วไปสมัครไม่ได้ ข้อมูลจึงมาจากประวัติการซื้อของบัญชีคุณเองเท่านั้น
- **อ่านได้เฉพาะบัญชีของคุณเอง** สคริปต์ดึงข้อมูลรันในเบราว์เซอร์ที่คุณล็อกอินอยู่
  ใช้ endpoint เดียวกับที่หน้า "การซื้อของฉัน" เรียกอยู่แล้ว

---

## ทำงานยังไง

```
เบราว์เซอร์ที่ล็อกอิน Shopee          เครื่องคุณ              Supabase            Telegram
  scripts/shopee-scan.js    →  purchases.json  →  upload.mjs  →  purchases  ←  price-bot
     scan() + validate()                                            ↑              ↓
                                                              item_aliases      คุณพิมพ์ถาม
```

| ส่วน | ไฟล์ | ทำอะไร |
|---|---|---|
| ดึงข้อมูล | `scripts/shopee-scan.js` | วางในคอนโซลเบราว์เซอร์ ดึงประวัติสั่งซื้อ → ไฟล์ JSON |
| อัปโหลด | `scripts/upload.mjs` | รันบนเครื่องตัวเอง เขียนลง Supabase ด้วย service role key |
| ฐานข้อมูล | `supabase/migrations/0001_purchases.sql` | ตาราง `purchases` + `item_aliases` |
| บอท | `supabase/functions/price-bot/` | Edge Function รับ webhook จาก Telegram |

---

## ติดตั้ง

### 1. เตรียมฐานข้อมูล

สร้างโปรเจกต์ที่ [supabase.com](https://supabase.com) แล้วรัน `supabase/migrations/0001_purchases.sql`
ใน SQL Editor (หรือ `supabase db push` ถ้าใช้ CLI)

ตารางเปิด RLS ไว้โดย **ไม่มี policy ใด ๆ** = เข้าถึงได้เฉพาะ service role key
ประวัติการซื้อของคุณจึงไม่หลุดออกทางเน็ต

### 2. ดึงประวัติสั่งซื้อ

1. เปิด <https://shopee.co.th/user/purchase/> แล้วล็อกอิน
2. เปิด DevTools Console วาง `scripts/shopee-scan.js` ทั้งไฟล์ แล้ว Enter
3. รันทีละขั้น:

```js
await shopeeImport.scan()    // ดึงข้อมูล
shopeeImport.validate()      // ต้องขึ้น ✅ ก่อน ถ้า ❌ อย่าไปต่อ
shopeeImport.save()          // ดาวน์โหลด purchases.json
```

`validate()` ตรวจว่าผลรวมราคาที่ปันส่วนของแต่ละออเดอร์เท่ากับยอดที่จ่ายจริง
ถ้าไม่ผ่านแปลว่าโครงสร้างข้อมูลของ Shopee เปลี่ยน — อย่าอัปโหลดข้อมูลที่ผิด

### 3. อัปโหลด

```bash
SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx node scripts/upload.mjs purchases.json
```

รันซ้ำได้ตลอด แถวที่ซ้ำถูกข้ามด้วย unique index อัตโนมัติ

### 4. สร้างบอทแล้ว deploy

ขอโทเคนจาก [@BotFather](https://t.me/BotFather) แล้วตั้ง secrets ใน
Supabase → Edge Functions → Secrets ตาม `.env.example`

```bash
supabase functions deploy price-bot --no-verify-jwt
```

> `--no-verify-jwt` จำเป็น เพราะ Telegram ไม่ได้ส่ง JWT มา
> การยืนยันตัวตนใช้ header `X-Telegram-Bot-Api-Secret-Token` แทน

### 5. ผูก webhook

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT>.supabase.co/functions/v1/price-bot&secret_token=<TELEGRAM_WEBHOOK_SECRET>"
```

### 6. เปิดสิทธิ์ให้ตัวเอง

ทักบอทไปหนึ่งข้อความ บอทจะตอบ chat id กลับมา เอาค่านั้นใส่
`TELEGRAM_ALLOWED_CHAT_IDS` แล้ว deploy ใหม่ — ค่าเริ่มต้นคือไม่อนุญาตใครเลย
ใช้ในกลุ่มก็ได้ ใส่ chat id ของกลุ่มเพิ่มเข้าไป (คั่นด้วยจุลภาค)

---

## กับดัก 3 ข้อที่เคยทำระบบพังจริง

เขียนไว้เพราะเสียเวลาแก้มาแล้ว ถ้าจะแก้โค้ดส่วนนี้อ่านก่อน

**1. `item_price` ของ Shopee ไม่ใช่ราคาที่จ่าย**
เป็นราคาป้ายของทั้งบรรทัด ไม่ใช่ต่อชิ้น และไม่ได้หักส่วนลด/คูปองที่คิดระดับออเดอร์
ต้องปันส่วน `final_total` ตามสัดส่วนราคาป้าย แล้วค่อยหารจำนวน
ใช้ตรง ๆ ราคาเพี้ยน **25–40%** — `validate()` มีไว้จับเรื่องนี้

**2. `callback_data` ของ Telegram จำกัด 64 ไบต์**
อักษรไทย 1 ตัว = 3 ไบต์ ยัดคำค้นภาษาไทยลงไปแล้วเกินทันที
Telegram ปฏิเสธทั้งข้อความโดยไม่แจ้ง error → **บอทเงียบสนิท**
โค้ดนี้จึงใส่แค่ id ที่เป็น ASCII แล้วดึงคำค้นเดิมจาก `reply_to_message.text` แทน

**3. `normalizeQuery` กับ `normalize` ต้องเหมือนกันเป๊ะ**
ตัวหนึ่งใช้ตอนนำเข้า อีกตัวใช้ตอนค้นหา ถ้าไม่ตรงกันจะค้นไม่เจอทั้งระบบ
มีเทสต์เทียบสองไฟล์นี้ให้อัตโนมัติแล้ว

เรื่องเรียงข้อมูล: ต้องใช้ `order=purchased_at.desc.nullslast` เสมอ
Postgres เรียง DESC เอา NULL ขึ้นก่อน ถ้าลืมใส่ "ซื้อล่าสุด" จะกลายเป็นแถวที่ไม่มีวันที่

---

## เทสต์

```bash
deno task test
```

23 เทสต์ ครอบกับดักทั้ง 3 ข้อข้างบน + การจัดกลุ่ม/จัดอันดับ/ข้อความตอบ

---

## สัญญาอนุญาต

MIT — ดู [LICENSE](LICENSE)
