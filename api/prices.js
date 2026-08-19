/* ============================================================
   GET /api/prices
   ------------------------------------------------------------
   시세판(index.html)과 카페24 홈페이지가 공용으로 쓰는 읽기 전용 API.
   Supabase에서 읽기만 하고, 쓰기는 절대 하지 않음.

   환경변수 (Vercel에 등록):
     SUPABASE_URL       — https://xxxxx.supabase.co
     SUPABASE_ANON_KEY  — anon public 키

   A사=한국금거래소 / B사=한국공인금거래소 / C사=한국표준금거래소
   (매핑은 이 주석과 DB에만. 응답에는 코드만 나감)
   ============================================================ */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

async function sb(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

// DB 행 → 시세판이 기대하는 모양으로
function toRow(r) {
  return {
    label: r.label,
    buy: r.buy_price,
    buyText: r.buy_text,
    sell: r.sell_price,
    sellText: r.sell_text,
  };
}

export default async function handler(req, res) {
  // 카페24 홈페이지에서도 부를 수 있게 CORS 개방 (읽기 전용이라 안전)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // 캐시 금지 — 엣지에 굳어서 옛날 가격이 뜨는 사고 방지
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    const store = req.query.store || 'return';

    const [ours, comps, spot] = await Promise.all([
      sb(`our_prices?store=eq.${store}&order=sort_order.asc`),
      sb(`competitor_prices?order=company.asc,sort_order.asc`),
      sb(`gold_spot?order=recorded_at.asc&limit=200`),
    ]);

    // 경쟁사를 A/B/C 로 묶기
    const byCompany = {};
    for (const r of comps) {
      if (!byCompany[r.company]) {
        byCompany[r.company] = { code: r.company, updatedAt: r.updated_at, rows: [] };
      }
      byCompany[r.company].rows.push(toRow(r));
      // 그 회사 안에서 가장 최근 갱신 시각을 대표로
      if (r.updated_at > byCompany[r.company].updatedAt) {
        byCompany[r.company].updatedAt = r.updated_at;
      }
    }

    // 우리 매장 대표 갱신 시각 = 가장 최근 행
    const oursUpdatedAt = ours.length
      ? ours.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)).updated_at
      : null;

    res.status(200).json({
      updatedAt: oursUpdatedAt,
      ours: ours.map(toRow),
      competitors: Object.values(byCompany).sort((a, b) => a.code.localeCompare(b.code)),
      spot: spot.map(s => ({ t: s.recorded_at, v: Number(s.price_usd) })),
    });
  } catch (err) {
    console.error('[api/prices]', err);
    res.status(500).json({ error: 'failed to load prices' });
  }
}
