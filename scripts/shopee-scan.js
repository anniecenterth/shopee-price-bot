/**
 * ดึงประวัติการสั่งซื้อ Shopee ของ "บัญชีตัวเอง" → ไฟล์ JSON
 *
 * ทำไมต้องรันในเบราว์เซอร์: Shopee ยืนยันตัวตนด้วยคุกกี้ของเซสชันที่ล็อกอินอยู่
 * สคริปต์นี้เรียก endpoint เดียวกับที่หน้าเว็บ "การซื้อของฉัน" เรียกอยู่แล้ว
 * ไม่ได้หลบ CAPTCHA ไม่ได้แตะข้อมูลของคนอื่น อ่านเฉพาะออเดอร์ของบัญชีที่ล็อกอิน
 *
 * วิธีใช้:
 *   1. เปิด https://shopee.co.th/user/purchase/ แล้วล็อกอิน
 *   2. เปิด DevTools Console วางไฟล์นี้ทั้งไฟล์ แล้ว Enter
 *   3. await shopeeImport.scan()    → ดึงข้อมูล
 *   4. shopeeImport.validate()      → ตรวจสูตรปันส่วนราคา (ต้องผ่านก่อน)
 *   5. shopeeImport.save()          → ดาวน์โหลดเป็น purchases.json
 *   6. อัปโหลดด้วย  node scripts/upload.mjs purchases.json
 *
 * ⚠️ อย่าวาง service role key ลงในคอนโซลของหน้าเว็บ Shopee เด็ดขาด
 *    การอัปโหลดทำนอกเบราว์เซอร์ด้วย scripts/upload.mjs
 */
(() => {
  const PAGE = 20;
  const DELAY_MS = 300;
  const MICRO = 100000;   // ราคาทุกค่าจาก Shopee เป็นหน่วยย่อย ต้องหารด้วยค่านี้

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /** ctime ฝังลึกในโครงสร้าง — ค้นตัวแรกที่เจอ */
  function findCtime(obj) {
    let found = null;
    (function walk(o) {
      if (found || !o || typeof o !== 'object') return;
      if (typeof o.ctime === 'number' && o.ctime > 0) { found = o.ctime; return; }
      for (const k in o) walk(o[k]);
    })(obj);
    return found;
  }

  /** normalize ให้ค้นหาเจอ: ตัวพิมพ์เล็ก, สัญลักษณ์คูณเป็น x, ตัดคำโปรย
   *  ⚠️ ต้องตรงกับ normalizeQuery ใน supabase/functions/price-bot/index.ts เป๊ะ
   *     ถ้าแก้ที่นี่ต้องแก้ที่นั่นด้วย ไม่งั้นข้อมูลที่นำเข้าจะค้นไม่เจอ */
  function normalize(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/(\d)\s*[*×x]\s*(\d)/g, '$1x$2')
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, ' ')
      .replace(/พร้อมส่ง|ส่งฟรี|ราคาส่ง|ราคาโรงงาน|ขายส่ง/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function isoDate(sec) {
    if (!sec) return null;
    const d = new Date(sec * 1000);
    return d.getFullYear() + '-' +
      String(d.getMonth() + 1).padStart(2, '0') + '-' +
      String(d.getDate()).padStart(2, '0');
  }

  /**
   * แปลง 1 ออเดอร์ → หลายแถว พร้อมปันส่วน final_total ตามสัดส่วนราคาป้าย
   *
   * ⚠️ กับดักสำคัญ: it.item_price คือ "ราคาป้ายของทั้งบรรทัด" ไม่ใช่ราคาต่อชิ้น
   *    และไม่ใช่ยอดที่จ่ายจริง เพราะส่วนลด/คูปอง/ค่าส่ง คิดที่ระดับออเดอร์
   *    ต้องปันส่วน final_total ตามสัดส่วนราคาป้าย แล้วค่อยหารด้วยจำนวน
   *    ถ้าใช้ item_price ตรง ๆ ราคาจะเพี้ยนไป 25–40%
   */
  function orderToRows(detail) {
    const ic = detail && detail.info_card;
    if (!ic) return [];
    const ctime = findCtime(detail);
    const finalTotal = (ic.final_total || 0) / MICRO;

    const lines = [];
    (ic.order_list_cards || []).forEach(card => {
      (card.parcel_cards || []).forEach(parcel => {
        (((parcel.product_info || {}).item_groups) || []).forEach(group => {
          (group.items || []).forEach(it => {
            lines.push({
              order_id: String(ic.order_id),
              item_id: it.item_id,
              model_id: it.model_id || null,
              shop_id: (card.shop_info || {}).shop_id || null,
              shop_name: (card.shop_info || {}).shop_name || '',
              name: it.name || '',
              model_name: it.model_name || '',
              qty: it.amount || 1,
              list_price: (it.item_price || 0) / MICRO,
              purchased_at: isoDate(ctime),
              source: 'SHOPEE_ORDERS',
              source_ref: String(ic.order_id)
            });
          });
        });
      });
    });

    const listSum = lines.reduce((a, l) => a + l.list_price, 0);
    lines.forEach(l => {
      l.paid_price = listSum > 0
        ? Math.round(finalTotal * (l.list_price / listSum) * 100) / 100
        : 0;
      l.unit_price = l.qty > 0 ? Math.round((l.paid_price / l.qty) * 100) / 100 : 0;
      l.search_text = normalize(l.name + ' ' + l.model_name);
      l._final_total = finalTotal;   // เก็บไว้ตรวจ ไม่ส่งขึ้นฐานข้อมูล
    });
    return lines;
  }

  const api = {
    rows: [],
    orders: 0,
    scanning: false,
    scanDone: false,

    async scan(maxPages = 80) {
      this.rows = []; this.orders = 0; this.scanning = true; this.scanDone = false;
      for (let p = 0; p < maxPages; p++) {
        const url = `/api/v4/order/get_all_order_and_checkout_list?limit=${PAGE}&offset=${p * PAGE}`;
        const res = await fetch(url, { credentials: 'include' });
        const json = await res.json();
        const arr = (json.new_data && json.new_data.order_or_checkout_data) || [];
        if (!arr.length) break;
        arr.forEach(o => {
          this.orders++;
          this.rows.push(...orderToRows(o.order_list_detail));
        });
        if (arr.length < PAGE) break;
        await sleep(DELAY_MS);   // เว้นจังหวะ ไม่ยิงรัวใส่เซิร์ฟเวอร์
      }
      this.scanning = false; this.scanDone = true;
      console.log(`✅ ดึงเสร็จ: ${this.orders} ออเดอร์ · ${this.rows.length} บรรทัด`);
      return { orders: this.orders, lines: this.rows.length };
    },

    /** ตรวจว่าผลรวม paid_price ของแต่ละออเดอร์ = final_total (คลาด ≤ ฿1)
     *  ถ้าไม่ผ่านแปลว่าสูตรปันส่วนพัง อย่าเอาข้อมูลขึ้นฐานข้อมูล */
    validate() {
      const byOrder = {};
      this.rows.forEach(r => {
        const b = byOrder[r.order_id] = byOrder[r.order_id] || { paid: 0, final: r._final_total };
        b.paid += r.paid_price;
      });
      const bad = Object.entries(byOrder)
        .map(([id, v]) => ({ id, diff: Math.abs(v.paid - v.final), paid: v.paid, final: v.final }))
        .filter(x => x.diff > 1);
      const noDate = this.rows.filter(r => !r.purchased_at).length;
      const result = {
        'ออเดอร์ที่ตรวจ': Object.keys(byOrder).length,
        'ออเดอร์ที่ยอดไม่ตรง': bad.length,
        'ตัวอย่างที่ไม่ตรง': bad.slice(0, 5),
        'บรรทัดที่ไม่มีวันที่': noDate,
        'ผ่าน': bad.length === 0
      };
      console.log(result['ผ่าน'] ? '✅ สูตรปันส่วนถูกต้อง' : '❌ สูตรปันส่วนผิด — อย่าอัปโหลด', result);
      return result;
    },

    /** ดาวน์โหลดเป็นไฟล์ JSON เพื่อเอาไปอัปโหลดด้วย scripts/upload.mjs */
    save(filename = 'purchases.json') {
      const v = this.validate();
      if (!v['ผ่าน']) { console.error('❌ ยังไม่ผ่านการตรวจ — หยุด ไม่บันทึกไฟล์'); return null; }
      const clean = this.rows.map(r => { const { _final_total, ...rest } = r; return rest; });
      const blob = new Blob([JSON.stringify(clean, null, 0)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
      console.log(`✅ บันทึก ${filename} แล้ว (${clean.length} บรรทัด)`);
      console.log('ขั้นต่อไป: node scripts/upload.mjs ' + filename);
      return clean.length;
    }
  };

  window.shopeeImport = api;
  console.log('พร้อมใช้: await shopeeImport.scan() → shopeeImport.validate() → shopeeImport.save()');
})();
