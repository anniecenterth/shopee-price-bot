-- 0001: ประวัติราคาที่ซื้อจริงจาก Shopee + ชื่อเล่นสินค้า
--
-- ความปลอดภัย: ตารางทั้งสองเปิด RLS ไว้และ "ไม่มี policy ใด ๆ"
-- แปลว่าเข้าถึงได้เฉพาะ service role key (ฝั่งเซิร์ฟเวอร์) เท่านั้น
-- ทั้ง Edge Function และสคริปต์อัปโหลดใช้ service role key จึงทำงานได้ปกติ
-- ห้ามเพิ่ม policy ให้ anon เว้นแต่คุณตั้งใจเปิดข้อมูลการซื้อของตัวเองให้คนทั่วไปอ่าน

create extension if not exists pg_trgm;

create table if not exists purchases (
  id            uuid primary key default gen_random_uuid(),
  order_id      text        not null,
  item_id       bigint      not null,
  model_id      bigint,
  shop_id       bigint,
  shop_name     text,
  name          text        not null,
  model_name    text        default '',
  search_text   text        not null,
  qty           integer     not null default 1,
  list_price    numeric(12,2) not null default 0,
  paid_price    numeric(12,2) not null default 0,
  unit_price    numeric(12,2) not null default 0,
  purchased_at  date,
  source        text        not null default 'SHOPEE_ORDERS',
  source_ref    text,
  created_at    timestamptz not null default now()
);

-- กันนำเข้าซ้ำ: model_id เป็น null ได้ จึงต้อง coalesce ใน unique index
-- ทำให้รันสคริปต์นำเข้าซ้ำกี่รอบก็ได้ ข้อมูลไม่ซ้ำ
create unique index if not exists purchases_unique_line
  on purchases (order_id, item_id, coalesce(model_id, 0));

-- ค้นหาด้วย ilike ทีละ token — trigram index ทำให้เร็วพอแม้ข้อมูลหลักหมื่นแถว
create index if not exists purchases_search_trgm
  on purchases using gin (search_text gin_trgm_ops);

create index if not exists purchases_item on purchases (item_id, model_id);
create index if not exists purchases_date on purchases (purchased_at desc);

-- ชื่อเล่นที่ผู้ใช้ "สอน" บอทตอนกดเลือกจากรายการ
-- ครั้งต่อไปพิมพ์คำเดิมจะตอบทันทีโดยไม่ต้องเลือกอีก
create table if not exists item_aliases (
  id          uuid primary key default gen_random_uuid(),
  alias       text        not null unique,
  item_id     bigint      not null,
  model_id    bigint,
  created_by  text,
  created_at  timestamptz not null default now()
);

alter table purchases    enable row level security;
alter table item_aliases enable row level security;
