/* ============================================================
   POST /api/save-competitor
   ------------------------------------------------------------
   크롬 확장(매장 PC)이 수집한 경쟁사 시세를 받아 Supabase에 저장.
   secret key는 이 서버에만 있고 확장에는 없음.

   환경변수:
     SUPABASE_URL
     SUPABASE_SERVICE_KEY
     SCRAPER_TOKEN        — 확장과 공유하는 간단한 인증 토큰

   요청 형식:
     헤더  x-scraper-token: <SCRAPER_TOKEN>
     본문  { "company":"A", "rows":[ {item_key,label,buy_price,...}, ... ] }
   ============================================================ */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const TOKEN  = process.env.SCRAPER_TOKEN;

const COMPANIES = ['A', 'B', 'C'];
const ITEMS = ['gold24', 'gold18', 'gold14', 'platinum'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-scraper-token');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // 아무나 시세를 덮어쓰지 못하게
  if (!TOKEN || req.headers['x-scraper-token'] !== TOKEN) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const { company, rows } = req.body || {};

    if (!COMPANIES.includes(company)) {
      return res.status(400).json({ error: 'bad company' });
    }
    if (!Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ error: 'no rows' });
    }

    const now = new Date().toISOString();
    const clean = [];

    for (const r of rows) {
      if (!ITEMS.includes(r.item_key)) continue;

      const buy  = Number.isFinite(r.buy_price)  ? r.buy_price  : null;
      const sell = Number.isFinite(r.sell_price) ? r.sell_price : null;

      // 말이 안 되는 값은 버림 (파싱 깨졌을 때 엉뚱한 숫자가 들어가는 것 방지)
      const sane = v => v == null || (v > 1000 && v < 100000000);
      if (!sane(buy) || !sane(sell)) continue;

      clean.push({
        company,
        item_key:   r.item_key,
        label:      String(r.label || '').slice(0, 40),
        buy_price:  buy,
        buy_text:   r.buy_text  ? String(r.buy_text).slice(0, 40)  : null,
        sell_price: sell,
        sell_text:  r.sell_text ? String(r.sell_text).slice(0, 40) : null,
        sort_order: Number(r.sort_order) || 0,
        updated_at: now,
      });
    }

    // 순금이 없으면 파싱이 깨진 것 → 저장하지 않음
    // (엉뚱한 값이 시세판에 뜨느니 옛 값 + 빨간 경고가 안전)
    const g = clean.find(r => r.item_key === 'gold24');
    if (!g || (g.buy_price == null && g.sell_price == null)) {
      return res.status(400).json({ error: 'gold24 missing' });
    }

    const r = await fetch(
      `${SB_URL}/rest/v1/competitor_prices?on_conflict=company,item_key`,
      { method: 'POST',
        headers: {
          apikey: SB_KEY,
          Authorization: `Bearer ${SB_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(clean) }
    );

    if (!r.ok) throw new Error(`supabase ${r.status}: ${await r.text()}`);

    return res.status(200).json({ ok: true, company, saved: clean.length });

  } catch (err) {
    console.error('[save-competitor]', err);
    return res.status(500).json({ error: 'save failed' });
  }
}
