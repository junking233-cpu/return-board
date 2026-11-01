/* ============================================================
   GET /api/spot   — 국제 시세 1돈 환산 (참고)
   ------------------------------------------------------------
   화면 오른쪽 아래 「국제 금시세」 그래프 칸의 「1돈 환산 ○○○,○○○원 · 참고」 한 줄 값
   (그래프가 묵었을 때 오른쪽 위 숫자도). 돌려 보기 장으로는 안 씀 (살때/팔때가 없어서).
   국제 금값(USD/oz) × 원·달러 환율 → 순금 1돈(3.75g) 원.
   부가세·수수료가 없는 국제 시세 기준이라 손님 화면엔 「참고」로만 냄.

   출처 (키 없음 · 무료 공개):
     금     https://api.gold-api.com/price/XAU
            → { price, updatedAt(ISO), currency:'USD', symbol:'XAU' }
            updatedAt 은 장 시각이 아니라 그쪽이 값을 다시 읽은 시각 (일요일에도 「몇 초 전」).
            그래서 화면의 「2시간」 규칙은 「우리 서버가 금값을 못 받은 지 2시간」이라는 뜻.
     환율 순서: frankfurter v2 → v1 → er-api (er-api 는 출처 표기 조건이 있어 마지막 예비로만)
     환율   https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW
            → [ { date:'YYYY-MM-DD', base:'USD', quote:'KRW', rate } ]   (2026-11-02 GET 확인)
            유럽중앙은행 기준 영업일 값 (주말·유럽 연휴엔 며칠 전 날짜가 정상)
     환율 예비  https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW
            → { base:'USD', date:'YYYY-MM-DD', rates:{KRW} }
            v1 은 그쪽이 「지원 중단」(deprecation: 2026-05-18 · 후속 v2/rates) 표시를 붙여 둠.
            아직 되지만 언제 없어질지 몰라 v2 뒤에 둠 (없어지면 실패만 하고 끝).
     환율 마지막 예비  https://open.er-api.com/v6/latest/USD
            → { result:'success', rates:{KRW}, time_last_update_unix }  (하루 한 번 바뀜)
            무료 조건: 화면에 「Rates By Exchange Rate API」 표기 · 1시간에 1번 넘게 부르지 말 것
            (넘으면 그 IP 20분 429) → frankfurter 둘 다 안 될 때만 · 아래 3시간 기억.
     (2026-11-01·02 GET 한 번씩 해서 응답 꼴 확인)

   계산: 1돈 원 = USD/oz × KRW ÷ 31.1035 × 3.75 → 100원 단위 반올림
   범위 검사: 금 1000~10000달러 · 환율 900~2000원 밖이면 그 값은 버림
              (환율은 범위 밖이거나 실패하면 예비 출처로)

   응답: { ok, usdPerOz, krwPerUsd, wonPerDon, goldAt, fxAt, source }
   캐시: s-maxage=600, stale-while-revalidate=3600
         → TV 가 여러 대여도 Vercel 이 10분에 한 번만 실제로 받음
   주소 뒤 글자(?x=1 …)는 400 — 글자만 바꿔 캐시를 비켜 가며 바깥 출처를 마구 부르지 못하게.
   같은 서버 인스턴스 안에서는 금 1분 · 환율 3시간 기억 (캐시를 놓친 요청·동시 요청도 한 번만 부름).

   그래프 점: SUPABASE_SERVICE_KEY 가 있으면, gold_spot 마지막 점이
             10분보다 오래됐을 때만 한 점 넣음 (실패해도 응답은 그대로).
             금값만 받았으면 환율이 실패해도 넣음.
             마지막 점 읽기는 anon 키(있으면) · 서비스 키는 넣기 한 번에만 · 키는 이 서버에만.
             결과(skip/stale/recent/busy/saved/error)는 로그에만 남김 (응답에 넣으면 키가 있는지 밖에서 보임).
             ※ 여러 인스턴스가 동시에 넣는 것까지 막으려면 DB 쪽 unique(10분 칸) 가 필요 (SQL · 다음 단계).

   환경변수 (선택): SUPABASE_URL · SUPABASE_SERVICE_KEY · SUPABASE_ANON_KEY
   ============================================================ */

const GOLD_URL = 'https://api.gold-api.com/price/XAU';
const FX_URL   = 'https://open.er-api.com/v6/latest/USD';
const FX_URL2  = 'https://api.frankfurter.dev/v2/rates?base=USD&quotes=KRW';
const FX_URL3  = 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=KRW';

const OZ_G  = 31.1035;   // 트로이온스 g
const DON_G = 3.75;      // 1돈 g

const GOLD_MIN = 1000, GOLD_MAX = 10000;   // USD/oz
const FX_MIN   = 900,  FX_MAX   = 2000;    // 원/달러

const TIMEOUT_MS = 5000;
// 환율 출처가 멈춰 있으면 버림
//   er-api 는 주말에도 날마다 바뀌므로 이틀(50시간) 넘으면 고장으로 봄
//   frankfurter 는 영업일 값이라 주말·유럽 연휴에 3~5일 전 날짜가 정상 → 6일
const FX_ER_MAX_AGE_MS = 50 * 3600 * 1000;
const FX_FR_MAX_AGE_MS = 6 * 24 * 3600 * 1000;
// 같은 인스턴스 안에서 기억하는 시간
const GOLD_MEMO_MS = 60 * 1000;
const FX_MEMO_MS   = 3 * 3600 * 1000;
// 그래프 점은 10분에 한 점만
const POINT_GAP_MS = 10 * 60 * 1000;
// 금값 시각이 이보다 묵었으면 그래프에 새 점으로 넣지 않음 (옛 값을 지금 값처럼 찍지 않게)
const POINT_FRESH_MS = 30 * 60 * 1000;

function wonPerDon(usd, krw) {
  return Math.round(usd * krw / OZ_G * DON_G / 100) * 100;
}

function toIso(t) {
  const d = new Date(t);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

async function getJson(url) {
  const r = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${url} ${r.status}`);
  return r.json();
}

/* 받은 값을 ms 동안 기억 · 받는 중이면 그 약속을 같이 기다림 (실패는 기억 안 함) */
function memo(ms, load) {
  let val = null, until = 0, busy = null;
  return () => {
    if (val && Date.now() < until) return Promise.resolve(val);
    if (!busy) {
      busy = load()
        .then(v => { val = v; until = Date.now() + ms; return v; })
        .finally(() => { busy = null; });
    }
    return busy;
  };
}

// 금 (예비 출처 없음 — 실패하면 ok:false, 화면은 그 장만 뺌)
async function loadGold() {
  const d = await getJson(GOLD_URL);
  const usd = Number(d && d.price);
  if (!(usd >= GOLD_MIN && usd <= GOLD_MAX)) throw new Error(`gold out of range: ${d && d.price}`);
  // updatedAt 이 없으면 받은 시각 (그쪽 updatedAt 도 원래 「다시 읽은 시각」이라 뜻이 같음)
  return { usd, at: toIso(d.updatedAt) || new Date().toISOString(), source: 'gold-api.com' };
}

function checkFx(krw, at, maxAge, name) {
  if (!(krw >= FX_MIN && krw <= FX_MAX)) throw new Error(`${name} KRW out of range: ${krw}`);
  if (at && Date.now() - Date.parse(at) > maxAge) throw new Error(`${name} too old: ${at}`);
}

async function loadFxEr() {
  const d = await getJson(FX_URL);
  if (!d || d.result !== 'success') throw new Error(`er-api result: ${d && d.result}`);
  const krw = Number(d.rates && d.rates.KRW);
  const at = d.time_last_update_unix ? toIso(d.time_last_update_unix * 1000) : null;
  checkFx(krw, at, FX_ER_MAX_AGE_MS, 'er-api');
  return { krw, at: at || new Date().toISOString(), source: 'open.er-api.com' };
}

async function loadFxFrankfurter2() {
  const d = await getJson(FX_URL2);
  const row = Array.isArray(d) ? d.find(x => x && x.base === 'USD' && x.quote === 'KRW') : null;
  const krw = Number(row && row.rate);
  const at = row && row.date ? toIso(`${row.date}T00:00:00Z`) : null;
  checkFx(krw, at, FX_FR_MAX_AGE_MS, 'frankfurter v2');
  return { krw, at: at || new Date().toISOString(), source: 'frankfurter.dev' };
}

async function loadFxFrankfurter1() {
  const d = await getJson(FX_URL3);
  const krw = Number(d && d.rates && d.rates.KRW);
  const at = d && d.date ? toIso(`${d.date}T00:00:00Z`) : null;
  checkFx(krw, at, FX_FR_MAX_AGE_MS, 'frankfurter v1');
  return { krw, at: at || new Date().toISOString(), source: 'frankfurter.dev' };
}

// 환율: 첫 출처가 실패하거나 범위 밖·너무 묵음이면 예비 출처 차례로
// frankfurter v2 → v1 → er-api (er-api 는 출처 표기 조건이 있어서 마지막 예비)
async function loadFx() {
  const tries = [loadFxFrankfurter2, loadFxFrankfurter1, loadFxEr];
  let last;
  for (const t of tries) {
    try {
      return await t();
    } catch (e) {
      last = e;
      console.warn('[api/spot] 환율 출처 실패, 다음으로:', e.message);
    }
  }
  throw last;
}

const getGold = memo(GOLD_MEMO_MS, loadGold);
const getFx   = memo(FX_MEMO_MS, loadFx);

/* 그래프용 한 점 (서비스 키 있을 때만)
   돌려주는 값: 'skip'(키 없음) · 'stale'(금값이 묵음) · 'recent'(10분 안에 점 있음)
               'busy'(이 인스턴스가 지금 넣는 중) · 'saved' · 'error' */
let pointBusy = false;   // 이 인스턴스 안에서 동시에 온 요청이 같이 넣지 않게
let pointLastAt = 0;     // 이 인스턴스가 아는 마지막 점 시각 (10분 안이면 DB 를 다시 읽지도 않음)

async function recordPoint(usd, goldAt) {
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_SERVICE_KEY;
  if (!sbUrl || !sbKey) return 'skip';
  if (!(Date.now() - Date.parse(goldAt) <= POINT_FRESH_MS)) return 'stale';
  if (Date.now() - pointLastAt < POINT_GAP_MS) return 'recent';
  if (pointBusy) return 'busy';

  pointBusy = true;
  try {
    // 읽기는 anon 키 (prices.js 가 같은 표를 anon 으로 읽음) · 없으면 서비스 키
    const readKey = process.env.SUPABASE_ANON_KEY || sbKey;
    const lr = await fetch(
      `${sbUrl}/rest/v1/gold_spot?select=recorded_at&order=recorded_at.desc&limit=1`,
      { headers: { apikey: readKey, Authorization: `Bearer ${readKey}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }
    );
    if (!lr.ok) throw new Error(`gold_spot read ${lr.status}`);
    const last = await lr.json();
    const lastAt = last && last[0] ? Date.parse(last[0].recorded_at) : NaN;
    if (Number.isFinite(lastAt) && Date.now() - lastAt < POINT_GAP_MS) {
      pointLastAt = lastAt;
      return 'recent';
    }

    const wr = await fetch(`${sbUrl}/rest/v1/gold_spot`, {
      method: 'POST',
      headers: {
        apikey: sbKey, Authorization: `Bearer ${sbKey}`,
        'Content-Type': 'application/json', Prefer: 'return=minimal',
      },
      body: JSON.stringify([{ price_usd: usd, recorded_at: new Date().toISOString() }]),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!wr.ok) throw new Error(`gold_spot write ${wr.status}`);
    pointLastAt = Date.now();
    return 'saved';
  } catch (e) {
    console.error('[api/spot] 그래프 점 넣기 실패 (응답은 그대로):', e.message);
    return 'error';
  } finally {
    pointBusy = false;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ ok: false, error: 'GET only' });
  }
  // 화면은 /api/spot 을 글자 없이 부름. 뒤에 글자가 붙으면 바깥 출처를 부르지 않고 돌려보냄
  if (req.query && Object.keys(req.query).length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ ok: false, error: 'no query' });
  }

  const [gold, fx] = await Promise.allSettled([getGold(), getFx()]);

  // 금값을 받았으면 환율과 상관없이 그래프 점은 넣음
  if (gold.status === 'fulfilled') {
    const point = await recordPoint(gold.value.usd, gold.value.at);
    console.log('[api/spot] 그래프 점:', point);
  }

  if (gold.status === 'rejected' || fx.status === 'rejected') {
    if (gold.status === 'rejected') console.error('[api/spot] 금 실패:', gold.reason && gold.reason.message);
    if (fx.status === 'rejected')   console.error('[api/spot] 환율 실패:', fx.reason && fx.reason.message);
    // 실패는 캐시하지 않음 (다음 요청에서 바로 다시 받게)
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({
      ok: false,
      error: gold.status === 'rejected' ? 'gold' : 'fx',
    });
  }

  const g = gold.value, f = fx.value;
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=3600');
  return res.status(200).json({
    ok: true,
    usdPerOz: g.usd,
    krwPerUsd: f.krw,
    wonPerDon: wonPerDon(g.usd, f.krw),
    goldAt: g.at,
    fxAt: f.at,
    source: `${g.source} + ${f.source}`,
  });
}
