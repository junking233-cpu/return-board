/* ============================================================
   GET /api/prices?store=return|sagyejeol|geumsarang[&v=2][&spot=0][&src=ledger|board]
   ------------------------------------------------------------
   시세판(index.html)이 30초마다 부르는 읽기 전용 API.
   어디에도 쓰지 않음 (시세판 Supabase · 장부 Supabase 둘 다 읽기만).

   store 없음 = return (예전 주소 그대로). 정해진 세 값 말고는 400.

   ── 우리 매장 시세 출처 (loadOurs) ──
     SOURCE = { return:'ledger', geumsarang:'ledger', sagyejeol:'ledger' }   ← 세 매장 모두 장부
       ledger = 장부 Supabase 의 site_rates (장부 「손님 시세」 · SQL 161) — 시세는 장부 한 곳에서만 바꿈
                매장 번호 return 1 · geumsarang 2 · sagyejeol 3
       board  = 시세판 Supabase 의 our_prices (예전에 텔레그램 /시세 가 고치던 표)
                이제 아무도 안 고침 (/시세 는 안내만 · api/telegram.js) — 되돌리기용으로 마지막 값 그대로 남겨 둠
     되돌리기: SOURCE.return 한 줄만 'board' 로 (그러면 리턴 TV 는 our_prices 의 마지막 값 · /시세 저장은 telegram.js 에서 따로 켜야 함).
     ?src=ledger|board 로 미리 볼 수 있음 (그 밖의 값은 400).
     장부 읽기: GET {LEDGER_URL}/rest/v1/site_rates?select=data&id=eq.N (공개용 publishable 키 · 2.5초 제한)
       → [{data}] 또는 [] (아직 안 넣음). live 를 「이름으로」 찾음. 키 뜻이 서로 반대:
         site_rates live.sell (손님이 살 때) → TV buy  (내가 살때)
         site_rates live.buy  (손님이 팔 때) → TV sell (내가 팔때)
         줄 짝: 골드바 1돈←골드바 (9999) · 18K 금시세 · 14K 금시세 · 백금 시세 · 실버바999 1kg←은 시세
       모르는 키·hero 는 안 봄.
       꼴 (설계서 A-5 build · parse 그대로 — 정상 저장이면 늘 이 꼴):
         buy (손님이 팔 때 · 우리 매입가) = 0보다 큰 숫자 (꼭 있음)
         sell(손님이 살 때 · 우리 판매가) = 키는 꼭 있음 · 숫자 또는 null (null → TV 「제품시세적용」)
                                           골드바 (9999)·은 시세는 null 이면 안 됨
         unit = 은 시세 '1kg' · 나머지 '1돈'
       updatedAt = data.at, 없으면 data.updated(YYYY.MM.DD) 그날 00:00 KST (그때 oursDateOnly:true) · 둘 다 없으면 틀린 꼴
       꼴이 틀리면(줄·키 없음 · 숫자 아님 · 단위 다름 · 날짜 없음) 그리지 않음 → 못 읽은 것과 같게
       (가짜·반쪽 값 안 냄 · SQL 편집기로 손으로 고쳐 키가 빠져도 손님 화면에 「전부 제품시세적용」이 나가지 않게)

   ── 응답 꼴 ──
   · &v=2 (새 화면): 덩이마다 따로 버팀 · 늘 200 · 경쟁사는 안 읽음 (새 화면은 /api/competitors)
       { v:2, store, now, oursOk, oursEmpty, oursSource, oursDateOnly, updatedAt,
         ours:[…늘 배열…], spotOk, spot:[…]|null (spot=0 이면 두 칸 다 없음), failed }
       못 읽음 → oursOk:false · ours:[]  /  아직 안 넣음 → oursEmpty:true · ours:[]
   · 버전 없음 (옛 화면 · 배포 뒤 6시간 새로고침 전까지 떠 있는 리턴 TV): 지금과 똑같은 꼴
       { store, now, updatedAt, ours, competitors, spot, failed }
       ours 줄 꼴도 같음 {label,buy,buyText,sell,sellText} — 장부에서 읽어도 위 짝짓기로 같은 5줄
       store 도 없이 부르면 예전처럼 「다 되거나 500」 (덩이 하나만 null 이어도 옛 화면이 멈추므로)
         우리 매장 값이 0줄(장부에 아직 없음)이어도 500 — 옛 화면은 빈 표를 그리지 않고 마지막 값 + 끊김 띠
       store 를 붙이면 덩이마다 따로 (실패한 덩이는 null · 셋 다 실패면 500)

   spot=0 이면 그래프 점을 안 읽음 (화면이 5분에 한 번만 점을 달라고 함 · DB 전송량 줄이기).
   응답의 now = 서버 시각 (TV 시계가 틀려도 화면이 이 시각으로 신선도를 판단).

   환경변수 (Vercel에 등록 · 시세판 DB):
     SUPABASE_URL       — https://xxxxx.supabase.co
     SUPABASE_ANON_KEY  — anon public 키
   장부 주소·키는 공개 값이라 아래 상수 (새 비밀값 없음 · sb_secret_ 는 절대 넣지 말 것)

   옛 요청의 competitor_prices(확장 프로그램이 저장) 는 회사를 코드 A·B·C 로만 부름
   (새 화면의 A사·B사 는 /api/competitors 쪽 — 뜻이 다름. 공개 저장소라 회사 이름은 적지 않음 · 응답에는 코드만)
   ============================================================ */

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_ANON_KEY;

// 장부 매장 id 와 같은 이름만 받음 (값을 주소에 끼워 넣으므로 아무 글자나 받으면 안 됨)
const STORES = ['return', 'sagyejeol', 'geumsarang'];

// 장부(손님 시세) — 리턴 홈페이지 index.html 2144-2145 에 이미 공개된 값과 같음 (읽기 전용 publishable 키)
const LEDGER_URL = 'https://odbwpyiavenrwfsjsppk.supabase.co';
const LEDGER_KEY = 'sb_publishable_vfQOB-gVznQAHNHswDy_jg_-CK6ATiZ';
// 장부 매장 번호 (설정 표 site_rates_stores 와 같은 값 · 영구히 안 바뀜)
const LEDGER_ID = { return: 1, geumsarang: 2, sagyejeol: 3 };
// 우리 매장 시세를 어디서 읽나 — 세 매장 모두 장부 (되돌리기: return 만 'board' = 시세판 our_prices 의 마지막 값)
export const SOURCE = { return: 'ledger', geumsarang: 'ledger', sagyejeol: 'ledger' };
const SOURCES = ['ledger', 'board'];
const LEDGER_TIMEOUT_MS = 2500;
// TV 줄 ← 장부 live 이름 (순서는 TV 순서) · 단위 · 판매가(장부 sell)가 꼭 숫자여야 하나
const LEDGER_ROWS = [
  { label: '골드바 1돈',    live: '골드바 (9999)', unit: '1돈', sellRequired: true },
  { label: '18K 금시세',    live: '18K 금시세',    unit: '1돈' },
  { label: '14K 금시세',    live: '14K 금시세',    unit: '1돈' },
  { label: '백금 시세',     live: '백금 시세',     unit: '1돈' },
  { label: '실버바999 1kg', live: '은 시세',       unit: '1kg', sellRequired: true },
];

// 옛 코드 A 회사는 2026-10-28 23:07(한국시간)부터 그쪽이 일부러 막아 수집이 멈춤.
// 더 안 쓰기로 했으므로 옛 요청 응답에서 뺌 (확장이 계속 저장해도 손님 화면엔 안 나감).
const HIDDEN_COMPANIES = ['A'];

// 국제 그래프: 최근 48시간 안의 점만, 최대 200개
const SPOT_HOURS = 48;
const SPOT_LIMIT = 200;
// 이보다 가까이 붙은 점은 마지막 하나만 (확장이 회사마다 spot 을 같이 보내 0.4초 간격 점이 생김 ·
// /api/spot 이 동시에 불려 같은 점이 여러 개 들어가도 그래프가 눌리지 않게)
const SPOT_MERGE_MS = 60 * 1000;

// Supabase 가 매달려도 그 덩이만 5초 뒤 null (다른 덩이까지 같이 늦지 않게)
const SB_TIMEOUT_MS = 5000;

async function sb(path) {
  const res = await fetch(`${URL}/rest/v1/${path}`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
    },
    signal: AbortSignal.timeout(SB_TIMEOUT_MS),
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

/* 장부 site_rates 한 줄의 data → TV 줄 (꼴이 틀리면 throw — 반쪽 값은 내지 않음)
   돌려주는 값: { updatedAt, rows:[{label,buy,buyText,sell,sellText}×5], dateOnly } */
export function ledgerView(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.live)) throw new Error('ledger shape: live 없음');
  const byName = new Map();
  for (const it of data.live) {
    if (it && typeof it === 'object' && typeof it.name === 'string' && !byName.has(it.name.trim())) {
      byName.set(it.name.trim(), it);
    }
  }
  const isWon = v => typeof v === 'number' && Number.isFinite(v) && v > 0;
  const bad = what => new Error(`ledger shape: ${what}`);
  const rows = LEDGER_ROWS.map(({ label, live, unit, sellRequired }) => {
    const it = byName.get(live);
    if (!it) throw bad(`${live} 없음`);
    if (typeof it.unit !== 'string' || it.unit.replace(/\s+/g, '') !== unit) throw bad(`${live} unit`);
    // 장부 buy (손님이 팔 때) → TV sell (내가 팔때) — 꼭 숫자
    if (!isWon(it.buy)) throw bad(`${live} buy`);
    // 장부 sell (손님이 살 때) → TV buy (내가 살때) — 키는 꼭 있음 · null 이면 「제품시세적용」
    if (!Object.prototype.hasOwnProperty.call(it, 'sell')) throw bad(`${live} sell 키 없음`);
    if (it.sell === null && !sellRequired) {
      return { label, buy: null, buyText: '제품시세적용', sell: it.buy, sellText: null };
    }
    if (!isWon(it.sell)) throw bad(`${live} sell`);
    return { label, buy: it.sell, buyText: null, sell: it.buy, sellText: null };
  });
  let updatedAt = null, dateOnly = false;
  const atMs = typeof data.at === 'string' ? Date.parse(data.at) : NaN;
  const ymd = typeof data.updated === 'string' ? /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(data.updated.trim()) : null;
  if (Number.isFinite(atMs)) {
    updatedAt = new Date(atMs).toISOString();
  } else if (ymd && Number.isFinite(Date.parse(`${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00+09:00`))) {
    updatedAt = `${ymd[1]}-${ymd[2]}-${ymd[3]}T00:00:00+09:00`;   // 그날 00:00 한국시간 (화면은 날짜만)
    dateOnly = true;
  } else {
    throw bad('at·updated 둘 다 없음');   // 언제 값인지 모르면 그리지 않음 (빨갛게 깜빡이는 「—」 대신)
  }
  return { updatedAt, rows, dateOnly };
}

/* 우리 매장 시세 → { source, empty, updatedAt, rows, dateOnly }
   ledger: 장부 site_rates (2.5초 제한)
   board : 시세판 our_prices (예전 텔레그램 /시세 가 고치던 표 · 되돌리기용)
   api/telegram.js 의 /시세 안내도 이 함수로 리턴 값을 읽음 (TV 와 같은 값 · 같은 짝짓기) */
export async function loadOurs(store, src = SOURCE[store]) {
  // 값을 주소에 끼워 넣으므로 정해진 매장만 (handler 는 이미 거르지만 다른 파일에서도 부르므로 한 번 더)
  if (!STORES.includes(store)) throw new Error(`bad store: ${store}`);
  if (src === 'ledger') {
    const r = await fetch(`${LEDGER_URL}/rest/v1/site_rates?select=data&id=eq.${LEDGER_ID[store]}`, {
      headers: { apikey: LEDGER_KEY, Authorization: `Bearer ${LEDGER_KEY}` },
      signal: AbortSignal.timeout(LEDGER_TIMEOUT_MS),
    });
    if (!r.ok) throw new Error(`ledger ${r.status}`);
    const arr = await r.json();
    if (!Array.isArray(arr)) throw new Error('ledger shape: 배열 아님');
    if (!arr.length) return { source: 'ledger', empty: true, updatedAt: null, rows: [], dateOnly: false };   // 아직 안 넣음
    return { source: 'ledger', empty: false, ...ledgerView(arr[0] && arr[0].data) };
  }
  const rows = await sb(`our_prices?store=eq.${store}&order=sort_order.asc`);
  // 우리 매장 대표 갱신 시각 = 가장 최근 행
  const updatedAt = rows.length
    ? rows.reduce((a, b) => (a.updated_at > b.updated_at ? a : b)).updated_at
    : null;
  return { source: 'board', empty: rows.length === 0, updatedAt, rows: rows.map(toRow), dateOnly: false };
}

// 옛 요청용: 경쟁사를 B/C … 로 묶기 (A 는 뺌)
// 줄마다 updatedAt 도 줌 — save-competitor 는 보낸 줄만 덮어써서, 한 줄(예: 백금)만 몇 주 묵을 수 있음.
async function loadCompetitors() {
  const comps = await sb(`competitor_prices?order=company.asc,sort_order.asc`);
  const byCompany = {};
  for (const r of comps) {
    if (HIDDEN_COMPANIES.includes(r.company)) continue;
    if (!byCompany[r.company]) {
      byCompany[r.company] = { code: r.company, updatedAt: r.updated_at, rows: [] };
    }
    byCompany[r.company].rows.push({ ...toRow(r), updatedAt: r.updated_at });
    // 그 회사 안에서 가장 최근 갱신 시각을 대표로
    if (r.updated_at > byCompany[r.company].updatedAt) {
      byCompany[r.company].updatedAt = r.updated_at;
    }
  }
  return Object.values(byCompany).sort((a, b) => a.code.localeCompare(b.code));
}

/* 국제 금시세 그래프 점
   예전 asc&limit=200 은 「가장 오래된 200개」라서 그래프가 2026-08-22 에 멈춰 있었음.
   → 최근 48시간 안에서 최신 순(desc)으로 200개 받아 뒤집어 오래된→최신 순으로 줌. */
async function loadSpot() {
  const since = new Date(Date.now() - SPOT_HOURS * 3600 * 1000).toISOString();
  const rows = await sb(
    `gold_spot?select=recorded_at,price_usd` +
    `&recorded_at=gte.${encodeURIComponent(since)}` +
    `&order=recorded_at.desc&limit=${SPOT_LIMIT}`
  );
  const pts = rows
    .reverse()
    .map(s => ({ t: s.recorded_at, v: Number(s.price_usd) }))
    .filter(p => p.t && Number.isFinite(p.v));
  return pts.filter((p, i) =>
    i === pts.length - 1 || !(Date.parse(pts[i + 1].t) - Date.parse(p.t) < SPOT_MERGE_MS)
  );
}

export default async function handler(req, res) {
  // 다른 화면에서도 부를 수 있게 CORS 개방 (읽기 전용이라 안전)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  // 캐시 금지 — 엣지에 굳어서 옛날 가격이 뜨는 사고 방지
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // store 없음 = 리턴 (예전 주소 그대로). 빈 값·모르는 값·여러 개는 400.
  const q = req.query || {};
  const raw = q.store;
  // 옛 화면(배포 뒤 6시간 새로고침 전까지 떠 있는 리턴 TV)은 store 를 안 붙이고,
  // 덩이 하나만 null 이어도 왼쪽이 비고 멈춤 → store 없이 부르면 예전처럼 「다 되거나 500」.
  // 새 화면은 늘 store 와 v=2 를 붙여 덩이별로 받음.
  const legacy = raw === undefined;
  const store = legacy ? 'return' : String(raw);
  if (!STORES.includes(store)) {
    return res.status(400).json({ error: 'bad store', stores: STORES });
  }
  if (q.v !== undefined && q.v !== '2') return res.status(400).json({ error: 'bad v' });
  if (q.src !== undefined && !SOURCES.includes(q.src)) return res.status(400).json({ error: 'bad src', sources: SOURCES });
  const v2 = q.v === '2';
  const src = q.src !== undefined ? q.src : SOURCE[store];
  const wantSpot = q.spot !== '0';

  if (v2) {
    // 새 화면: 우리 매장 · 그래프 점만 (경쟁사는 /api/competitors)
    const [ours, spot] = await Promise.allSettled([
      loadOurs(store, src),
      wantSpot ? loadSpot() : null,
    ]);
    const failed = [];
    if (ours.status === 'rejected') { failed.push('ours'); console.error('[api/prices] ours', src, ours.reason); }
    if (spot.status === 'rejected') { failed.push('spot'); console.error('[api/prices] spot', spot.reason); }
    const o = ours.status === 'fulfilled' ? ours.value : null;
    return res.status(200).json({
      v: 2,
      store,
      now: new Date().toISOString(),
      oursOk: !!o,
      oursEmpty: !!(o && o.empty),
      oursSource: src,
      oursDateOnly: !!(o && o.dateOnly),
      updatedAt: o ? o.updatedAt : null,
      ours: o ? o.rows : [],
      // spot=0 이면 두 칸 다 뺌 (화면은 칸이 없거나 null 이면 예전 점 그대로)
      spotOk: wantSpot ? spot.status === 'fulfilled' : undefined,
      spot: !wantSpot ? undefined : spot.status === 'fulfilled' ? spot.value : null,
      failed,
    });
  }

  const [ours, comps, spot] = await Promise.allSettled([
    loadOurs(store, src),
    loadCompetitors(),
    wantSpot ? loadSpot() : null,
  ]);

  const failed = [];
  if (ours.status === 'rejected')  { failed.push('ours');        console.error('[api/prices] ours', ours.reason); }
  if (comps.status === 'rejected') { failed.push('competitors'); console.error('[api/prices] competitors', comps.reason); }
  if (spot.status === 'rejected')  { failed.push('spot');        console.error('[api/prices] spot', spot.reason); }
  // 옛 화면은 0줄을 받으면 빈 표를 그림 → store 없는 옛 요청에서는 못 읽은 것과 같게 500 (마지막 값 + 끊김 띠)
  const legacyEmpty = legacy && ours.status === 'fulfilled' && ours.value.empty;
  if (legacyEmpty) console.error('[api/prices] ours 0줄 (옛 요청)', src);

  if (failed.length === (wantSpot ? 3 : 2) || (legacy && (failed.length || legacyEmpty))) {
    return res.status(500).json({ error: 'failed to load prices' });
  }

  res.status(200).json({
    store,
    now: new Date().toISOString(),
    updatedAt: ours.status === 'fulfilled' ? ours.value.updatedAt : null,
    ours: ours.status === 'fulfilled' ? ours.value.rows : null,
    competitors: comps.status === 'fulfilled' ? comps.value : null,
    // spot=0 이면 칸 자체를 뺌 (화면은 칸이 없거나 null 이면 예전 점 그대로)
    spot: !wantSpot ? undefined : spot.status === 'fulfilled' ? spot.value : null,
    failed,
  });
}
