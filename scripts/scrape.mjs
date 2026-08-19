/* ============================================================
   경쟁사 시세 수집  scripts/scrape.mjs
   ------------------------------------------------------------
   GitHub Actions에서 주기적으로 실행 → Supabase competitor_prices 갱신

   A사 = 한국금거래소   (koreagoldx)   JSON API
   B사 = 한국공인금거래소 (kaggold)      HTML 파싱
   C사 = 한국표준금거래소 (goldgold)     JSON API

   환경변수:
     SUPABASE_URL
     SUPABASE_SERVICE_KEY
   ============================================================ */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

const num = v => {
  if (v == null) return null;
  const n = String(v).replace(/[^\d]/g, '');
  return n ? Number(n) : null;
};

/* ---------- A사: 한국금거래소 ---------- */
async function fetchA() {
  const r = await fetch('https://www.koreagoldx.co.kr/api/main', {
    method: 'POST',
    headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`A ${r.status}`);
  const d = await r.json();
  const o = d.officialPrice4;
  if (!o) throw new Error('A: officialPrice4 없음');

  return [
    { item_key:'gold24',   label:'순금 1돈',   buy_price:num(o.s_pure),  sell_price:num(o.p_pure),  sort_order:1 },
    { item_key:'gold18',   label:'18K 금시세', buy_text:'제품시세적용',   sell_price:num(o.p_18k),   sort_order:2 },
    { item_key:'gold14',   label:'14K 금시세', buy_text:'제품시세적용',   sell_price:num(o.p_14k),   sort_order:3 },
    { item_key:'platinum', label:'백금 시세',  buy_price:num(o.s_white), sell_price:num(o.p_white), sort_order:4 },
  ];
}

/* ---------- B사: 한국공인금거래소 (HTML) ---------- */
async function fetchB() {
  const r = await fetch('https://www.kaggold.com/', { headers:{ 'User-Agent':UA } });
  if (!r.ok) throw new Error(`B ${r.status}`);
  const html = await r.text();

  // <tr class="trN"> ... </tr> 단위로 잘라서 td 추출
  const rowOf = cls => {
    const m = html.match(new RegExp(`<tr class="${cls}">([\\s\\S]*?)</tr>`));
    if (!m) return null;
    return [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
      .map(t => t[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
  };

  // 금: [품목][살때][변동][팔때][변동]
  const t2 = rowOf('tr2'), t3 = rowOf('tr3'), t4 = rowOf('tr4');
  // 백금: [품목][변동][팔때][변동]  ← 살때 칸 없음
  const t5 = rowOf('tr5');
  if (!t2 || !t3 || !t4) throw new Error('B: 금시세 행 파싱 실패');

  const cell = (arr, i) => {
    const v = arr?.[i] ?? '';
    return /제품시세적용/.test(v) ? { text:'제품시세적용' } : { price:num(v) };
  };

  const b24 = cell(t2,1), s24 = cell(t2,3);
  const b18 = cell(t3,1), s18 = cell(t3,3);
  const b14 = cell(t4,1), s14 = cell(t4,3);
  const sPt = t5 ? cell(t5,2) : { price:null };

  return [
    { item_key:'gold24',   label:'순금 1돈',   buy_price:b24.price ?? null, buy_text:b24.text ?? null,
                                               sell_price:s24.price ?? null, sort_order:1 },
    { item_key:'gold18',   label:'18K 금시세', buy_price:b18.price ?? null, buy_text:b18.text ?? '제품시세적용',
                                               sell_price:s18.price ?? null, sort_order:2 },
    { item_key:'gold14',   label:'14K 금시세', buy_price:b14.price ?? null, buy_text:b14.text ?? '제품시세적용',
                                               sell_price:s14.price ?? null, sort_order:3 },
    { item_key:'platinum', label:'백금 시세',  buy_text:'제품시세적용',
                                               sell_price:sPt.price ?? null, sort_order:4 },
  ];
}

/* ---------- C사: 한국표준금거래소 ---------- */
async function fetchC() {
  const r = await fetch('https://www.goldgold.co.kr/mapper.indexPrice.php', {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'X-Requested-With': 'XMLHttpRequest',
      Accept: 'application/json',
    },
  });
  if (!r.ok) throw new Error(`C ${r.status}`);
  const d = await r.json();

  // t_ = today. 최상위 t_* 필드가 화면에 뜨는 값과 같음
  const g = d.gold_price?.[0] || {};
  const p = d.pla_price?.[0]  || {};

  const buy24 = num(d.t_gold_b_24    ?? g.gp_buy_pure);
  const sel24 = num(d.t_gold_s_24    ?? g.gp_sale_pure);
  const sel18 = num(d.t_gold_s_18    ?? g.gp_sale_18k);
  const sel14 = num(d.t_gold_s_14    ?? g.gp_sale_14k);
  const buyPt = num(d.t_pla_price_b  ?? p.gp_buy_white);
  const selPt = num(d.t_pla_price_s  ?? p.gp_sale_white);

  return [
    { item_key:'gold24',   label:'순금 1돈',   buy_price:buy24,        sell_price:sel24, sort_order:1 },
    { item_key:'gold18',   label:'18K 금시세', buy_text:'제품시세적용', sell_price:sel18, sort_order:2 },
    { item_key:'gold14',   label:'14K 금시세', buy_text:'제품시세적용', sell_price:sel14, sort_order:3 },
    { item_key:'platinum', label:'백금 시세',  buy_price:buyPt,        sell_price:selPt, sort_order:4 },
  ];
}

/* ---------- Supabase 저장 ---------- */
async function save(company, rows) {
  const now = new Date().toISOString();
  const body = rows.map(r => ({
    company,
    item_key:   r.item_key,
    label:      r.label,
    buy_price:  r.buy_price  ?? null,
    buy_text:   r.buy_text   ?? null,
    sell_price: r.sell_price ?? null,
    sell_text:  r.sell_text  ?? null,
    sort_order: r.sort_order,
    updated_at: now,
  }));

  const res = await fetch(
    `${SB_URL}/rest/v1/competitor_prices?on_conflict=company,item_key`,
    { method:'POST',
      headers:{
        apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`,
        'Content-Type':'application/json',
        Prefer:'resolution=merge-duplicates,return=minimal',
      },
      body:JSON.stringify(body) }
  );
  if (!res.ok) throw new Error(`저장 실패 ${res.status}: ${await res.text()}`);
}

/* ---------- 실행 ---------- */
const TARGETS = [
  { code:'A', name:'한국금거래소',     fn:fetchA },
  { code:'B', name:'한국공인금거래소', fn:fetchB },
  { code:'C', name:'한국표준금거래소', fn:fetchC },
];

let failed = 0;

for (const t of TARGETS) {
  try {
    const rows = await t.fn();

    // 순금 살때가 비어 있으면 파싱이 깨진 것 → 저장하지 않음
    // (엉뚱한 값이 시세판에 뜨는 것보다 옛 값이 남아 경고 뜨는 편이 안전)
    const g24 = rows.find(r => r.item_key === 'gold24');
    if (!g24?.buy_price && !g24?.sell_price) {
      throw new Error('순금 값이 비어 있음 — 구조 변경 의심');
    }

    await save(t.code, rows);
    console.log(`✅ ${t.code}사 (${t.name})`,
      rows.map(r => `${r.label}:${r.buy_price ?? r.buy_text ?? '-'}/${r.sell_price ?? '-'}`).join('  '));
  } catch (err) {
    failed++;
    console.error(`❌ ${t.code}사 (${t.name}):`, err.message);
  }
}

// 세 곳 다 실패하면 Actions를 빨간불로 → 알림 받을 수 있게
if (failed === TARGETS.length) {
  console.error('세 곳 모두 실패');
  process.exit(1);
}
