/* ============================================================
   GET /api/competitors   — 타사 시세 (돌려 보기 「A사」·「B사」 장)
   ------------------------------------------------------------
   손님 화면에는 A사·B사 코드만 나감 (응답에도 이름·주소 없음).
   공개 저장소라 회사 이름은 주석·글자에 적지 않음 — A사·B사 코드로만 부름.
     A사 = 아래 A_HOME · A_MARKET   (www 없이 · 사업자 매입시세 표 HTML)
     B사 = 아래 B_URL               (JSON)
   ※ 예전 확장 프로그램(competitor_prices 표)의 A·B·C 와 뜻이 다름 — 그쪽은 /api/prices 옛 요청에만 남음.
     (옛 코드 A·B 두 곳은 2026-11-02 실장님 결정으로 뺌. 확장이 계속 보내도 새 화면은 안 씀)

   두 곳 다 하루 한 번(오전 10~11시쯤) 고시 · 주말엔 금/토 값 그대로.
   예의: 30분에 한 번 이하로만 읽음
     - 응답 캐시 s-maxage=1800, stale-while-revalidate=7200 (TV 가 여러 대여도 Vercel 이 30분에 한 번)
       한쪽·둘 다 실패한 응답도 같은 머리글로 200 (5xx 는 Vercel 이 캐시하지 않아 TV 가 부를 때마다
       함수가 돌고 타사를 다시 두드리게 됨 → 실패도 캐시에 30분 둠 · 화면은 실패한 회사의 앞 값을 그대로 둠)
     - 같은 서버 인스턴스 안에서도 회사마다 30분 기억 · 실패도 30분 기억 ·
       HTTP 403·429(막힘·너무 잦음)는 3시간 기억 (막혔을 때 두드리지 않음)
     - 머리글·쿠키 꾸미지 않은 평범한 GET 한 번씩 (A 는 도매가 날짜 보조 JSON 까지 두 번)
     - 본문은 3MB 까지만 읽음 (content-length 로 먼저 보고 · 읽는 중에도 넘으면 끊음)
   회사마다 따로 받음 (각 8초 제한 · 한쪽이 실패해도 다른 쪽은 줌).
   다시 읽다 실패하면 이 인스턴스가 마지막으로 받은 값을 그대로 줌 (fetchedAt 은 그때 시각 —
   화면이 24시간 넘은 값은 뺌).
   CORS * 는 지시서대로 둠 (화면은 같은 주소에서 불러 없어도 됨 — 실장님 확인 사항).

   A사 읽는 법 (2026-11-02 저장 원본 · 2026-02-10 보관본 둘 다 같은 구조)
     홈 HTML 의 <div id="crawling"> 안 ul.pricing-table 4개
       첫째(클래스 pricing-table 만) = 품목 이름  순금 · 18K · 14K · 백금 · 은
       ul.b_g375 = 살때(vat포함) · ul.s_g375 = 팔때 · ul.b_diff = 변동(안 씀)
       값은 li.detail > span.first-line · 「제품시세적용」은 글자값 · 품목 이름으로 짝을 맞춤
     고시일 칸이 없음 (표 위 날짜는 화면 그린 날 = 늘 오늘) → 보조로
       /realtime/ajax/getMarketData.php 의 domesticData.date (도매가 날짜) 를 읽어 dataDate 로만 줌
       (화면은 4일 규칙에만 씀 · 장 머리에 「○/○ 고시」로 내지 않음).
       도매가 날짜가 매입시세(10~11시 고시)와 같은 때 바뀌는지 아직 확인 못 함 (11-02 00:05 원본에서
       같은 응답의 다른 날짜는 11-02, domesticData.date 만 10-31). 먼저 바뀌면 토요일 값이 「11/2 고시」로
       나가게 되므로 noticeDate 는 null (화면은 「HH:MM 기준」 = 받은 시각).
       고시 앞뒤로 몇 번 받아 같이 바뀌는 것이 확인되면 A_NOTICE_FROM_MARKET 한 줄만 true 로.
     CORS 머리글이 없어 화면이 직접 못 읽음 → 이 서버에서만.
     미국(Vercel 기본 iad1) IP 를 막는지는 모름. 막히면 A 만 빠지고 화면은 멀쩡함.
       막히면 먼저 응답(403 본문·머리글)으로 「해외 전체 차단」인지 「우리를 겨냥한 차단」인지 확인할 것.
       겨냥한 차단을 지역을 옮겨 피하는 것은 우회이므로, vercel.json 의 "regions": ["icn1"] (서울) 시험은
       실장님 결정 뒤에만 (이번엔 안 넣음).
   B사 읽는 법: JSON · CORS * · t_gold_date(고시일) · t_gold_b_24/t_gold_s_24(순금 살때/팔때)
     t_gold_s_18 · t_gold_s_14 · t_pla_price_b/t_pla_price_s. 18K·14K 살때는 안 내므로 「제품시세적용」.
     서버에서 B 가 빠지면 화면이 30분에 한 번 직접 읽어 예비로 씀 (같은 검사).

   말 되는지 검사 (화면 index.html 의 vetRival 과 같은 규칙 — 시험이 둘을 맞대 봄)
     순금 살때·팔때 30만~150만 · 살때 ≥ 팔때      → 깨지면 그 회사 통째로 버림
     18K 팔때 < 순금 팔때 (그리고 순금 팔때의 절반보다 큼)
     14K 팔때 < 18K 팔때 (18K 가 깨졌으면 순금) (그리고 순금 팔때의 40%보다 큼)
     백금 살때·팔때 5만~100만 · 살때 ≥ 팔때
     숫자 자리에 숫자가 아니면 버림 (쉼표 「731,000」 은 숫자 · 「▼16,000」 같은 건 아님)
     → 순금 말고 다른 줄이 깨지면 그 줄만 「-」

   응답: { v:1, now, companies:[{ code:'A'|'B', noticeDate:'YYYY-MM-DD'|null, dataDate:'YYYY-MM-DD'|null,
           fetchedAt, rows:[{label,buy,buyText,sell,sellText} ×4 — 순금 1돈 · 18K 금시세 · 14K 금시세 · 백금 시세] }],
           failed:['A'|'B' …] }   — 늘 200 (둘 다 실패면 companies:[] · failed:['A','B'])
     noticeDate = 장 머리에 「○/○ 고시」로 내는 날짜 (B 의 t_gold_date · A 는 지금 null)
     dataDate   = 값이 언제 것인지 가늠하는 날짜 (화면의 4일 규칙에만 · B 는 noticeDate 와 같음 · A 는 도매가 날짜)
   ============================================================ */

const A_HOME   = 'https://samsunggold.co.kr/';
const A_MARKET = 'https://samsunggold.co.kr/realtime/ajax/getMarketData.php';
const B_URL    = 'https://irena111.cafe24.com/api/goldgold/mapper.indexPrice.php';

export const TIMEOUT_MS = 8000;              // 회사마다 (A 는 홈 + 도매가 날짜 JSON 합쳐서)
export const OK_MEMO_MS = 30 * 60 * 1000;    // 같은 인스턴스 안에서 받은 값 기억
export const FAIL_MEMO_MS = 30 * 60 * 1000;  // 실패도 기억 (고장 났을 때도 30분에 한 번 이하)
export const BLOCK_MEMO_MS = 3 * 60 * 60 * 1000;   // HTTP 403·429 (막힘·너무 잦음) 는 3시간 쉼
export const CACHE_HEADER = 's-maxage=1800, stale-while-revalidate=7200';
// A 고시일: 도매가 날짜(domesticData.date)가 매입시세 고시와 같이 바뀌는 것이 확인되면 true (그 전엔 dataDate 로만)
export const A_NOTICE_FROM_MARKET = false;
const MAX_BODY = 3 * 1024 * 1024;            // 이보다 큰 본문은 이상한 응답으로 봄
const MAX_BOX = 64 * 1024;                   // A 표(#crawling ~ </div>)는 2.4KB · 이보다 길면 모양이 바뀐 것 (정규식이 오래 돌지 않게)
const KST_MS = 9 * 3600 * 1000;

/* ── 말 되는지 검사 (index.html 과 같은 글자로 유지할 것) ── */
export const RIVAL_TEXT = '제품시세적용';
export function wonNum(v) {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '').replace(/원$/, '');
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
export function vetRival(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const part = k => (r[k] && typeof r[k] === 'object' ? r[k] : {});
  const isText = v => typeof v === 'string' && v.replace(/\s+/g, '') === RIVAL_TEXT;
  const inR = (n, lo, hi) => n != null && n >= lo && n <= hi;
  const dash = label => ({ label, buy: null, buyText: '-', sell: null, sellText: '-' });
  const g = part('gold'), gb = wonNum(g.buy), gs = wonNum(g.sell);
  if (!inR(gb, 300000, 1500000) || !inR(gs, 300000, 1500000) || gb < gs) return null;
  const rows = [{ label: '순금 1돈', buy: gb, buyText: null, sell: gs, sellText: null }];
  // K금: 팔때는 숫자 · 살때는 「제품시세적용」 또는 (팔때 < 살때 < 순금 살때) 숫자
  const kRow = (label, p, sell) => {
    if (isText(p.buy)) return { label, buy: null, buyText: RIVAL_TEXT, sell, sellText: null };
    const b = wonNum(p.buy);
    return b != null && b > sell && b < gb ? { label, buy: b, buyText: null, sell, sellText: null } : dash(label);
  };
  const k18 = part('k18'), s18 = wonNum(k18.sell);
  const ok18 = s18 != null && s18 < gs && s18 > gs * 0.5;
  rows.push(ok18 ? kRow('18K 금시세', k18, s18) : dash('18K 금시세'));
  const k14 = part('k14'), s14 = wonNum(k14.sell);
  const ok14 = s14 != null && s14 < (ok18 ? s18 : gs) && s14 > gs * 0.4;
  rows.push(ok14 ? kRow('14K 금시세', k14, s14) : dash('14K 금시세'));
  const pt = part('pt'), ps = wonNum(pt.sell);
  let ptRow = dash('백금 시세');
  if (inR(ps, 50000, 1000000)) {
    if (isText(pt.buy)) ptRow = { label: '백금 시세', buy: null, buyText: RIVAL_TEXT, sell: ps, sellText: null };
    else {
      const pb = wonNum(pt.buy);
      if (inR(pb, 50000, 1000000) && pb >= ps) ptRow = { label: '백금 시세', buy: pb, buyText: null, sell: ps, sellText: null };
    }
  }
  rows.push(ptRow);
  return rows;
}
/* 고시일 'YYYY-MM-DD' — 있는 날짜이고 한국 날짜로 오늘 이전일 때만 (아니면 null) */
export function validNoticeDate(v, now = Date.now()) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
  const today = new Date(now + KST_MS).toISOString().slice(0, 10);
  return s <= today ? s : null;
}
/* B사 JSON → 검사 전 값 */
export function standardRaw(j) {
  if (!j || typeof j !== 'object') return null;
  return {
    gold: { buy: j.t_gold_b_24, sell: j.t_gold_s_24 },
    k18:  { buy: RIVAL_TEXT, sell: j.t_gold_s_18 },
    k14:  { buy: RIVAL_TEXT, sell: j.t_gold_s_14 },
    pt:   { buy: j.t_pla_price_b, sell: j.t_pla_price_s },
  };
}
/* ── 검사 끝 ── */

/* A사 홈 HTML → 검사 전 값 (표 모양이 바뀌었으면 throw) */
const A_NAMES = { '순금': 'gold', '24K': 'gold', '18K': 'k18', '14K': 'k14', '백금': 'pt' };
function textOf(h) {
  return String(h)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
function cellsOf(ulInner) {
  const out = [];
  for (const li of ulInner.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/gi)) {
    const cls = (/\bclass\s*=\s*["']([^"']*)["']/i.exec(li[1]) || [])[1] || '';
    if (!cls.split(/\s+/).includes('detail')) continue;      // 머리 칸(table-price)은 건너뜀
    const sp = /<span\b[^>]*\bclass\s*=\s*["'][^"']*\bfirst-line\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(li[2]);
    out.push(sp ? textOf(sp[1]) : '');
  }
  return out;
}
export function parseSamsungHome(html) {
  if (typeof html !== 'string' || !html) throw new Error('A 본문 없음');
  const at = html.search(/\bid\s*=\s*["']crawling["']/i);
  if (at < 0) throw new Error('A 표(#crawling) 없음');
  const end = html.indexOf('</div>', at);                     // 표 안에는 div 가 없음 (ul·li·span·font 만)
  if (end < 0) throw new Error('A 표 끝 없음');
  if (end - at > MAX_BOX) throw new Error('A 표가 너무 김 (모양 바뀜)');
  const box = html.slice(at, end);
  let names = null, buy = null, sell = null;
  for (const m of box.matchAll(/<ul\b([^>]*)>([\s\S]*?)<\/ul>/gi)) {
    const cls = ((/\bclass\s*=\s*["']([^"']*)["']/i.exec(m[1]) || [])[1] || '').split(/\s+/).filter(Boolean);
    if (cls.includes('b_g375')) buy = buy || cellsOf(m[2]);
    else if (cls.includes('s_g375')) sell = sell || cellsOf(m[2]);
    else if (cls.includes('b_diff')) continue;
    else if (cls.includes('pricing-table')) names = names || cellsOf(m[2]);
  }
  if (!names || !buy || !sell) throw new Error('A 표 모양 바뀜');
  if (names.length !== buy.length || names.length !== sell.length) throw new Error('A 칸 수가 안 맞음');
  const idx = {};
  names.forEach((n, i) => {
    const k = A_NAMES[n.replace(/\s+/g, '').toUpperCase()];
    if (k && !(k in idx)) idx[k] = i;
  });
  if (!('gold' in idx)) throw new Error('A 순금 줄 없음');
  const raw = {};
  for (const k of ['gold', 'k18', 'k14', 'pt']) {
    raw[k] = k in idx ? { buy: buy[idx[k]], sell: sell[idx[k]] } : { buy: null, sell: null };
  }
  return raw;
}
export function samsungNoticeDate(j, now = Date.now()) {
  return validNoticeDate(j && j.domesticData && j.domesticData.date, now);
}

/* ── 받기 ── */
function tooBig() { return new Error('본문이 너무 큼'); }
async function getBody(url, signal) {
  // 머리글·쿠키 안 꾸밈 (평범한 GET)
  const r = await fetch(url, { signal });
  if (!r.ok) {
    const e = new Error(`HTTP ${r.status}`);
    e.status = r.status;            // 403·429 는 더 오래 쉼 (failMemoMs)
    throw e;
  }
  const len = Number(r.headers.get('content-length'));
  if (len > MAX_BODY) throw tooBig();
  // 읽는 중에도 3MB 를 넘으면 끊음 (다 받은 뒤에 재지 않음)
  if (!r.body || typeof r.body.getReader !== 'function') {
    const t = await r.text();
    if (t.length > MAX_BODY) throw tooBig();
    return t;
  }
  const reader = r.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > MAX_BODY) {
      try { await reader.cancel(); } catch (e) { /* 이미 끊김 */ }
      throw tooBig();
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { all.set(p, o); o += p.byteLength; }
  return new TextDecoder('utf-8').decode(all);
}

async function loadA() {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  const html = await getBody(A_HOME, signal);
  const rows = vetRival(parseSamsungHome(html));
  if (!rows) throw new Error('A 순금 값이 말이 안 됨');
  // 도매가 날짜는 보조 — 홈을 읽은 뒤에만 한 번 (못 받아도 시세는 줌)
  let dataDate = null;
  try {
    dataDate = samsungNoticeDate(JSON.parse(await getBody(A_MARKET, signal)));
  } catch (e) {
    console.warn('[api/competitors] A 도매가 날짜 못 받음 (시세는 그대로):', e.message);
  }
  return { code: 'A', noticeDate: A_NOTICE_FROM_MARKET ? dataDate : null, dataDate, fetchedAt: new Date(Date.now()).toISOString(), rows };
}

async function loadB() {
  const j = JSON.parse(await getBody(B_URL, AbortSignal.timeout(TIMEOUT_MS)));
  const rows = vetRival(standardRaw(j));
  if (!rows) throw new Error('B 순금 값이 말이 안 됨');
  const noticeDate = validNoticeDate(j.t_gold_date);
  return { code: 'B', noticeDate, dataDate: noticeDate, fetchedAt: new Date(Date.now()).toISOString(), rows };
}

/* 실패를 얼마나 기억할지 — 막힘(403)·너무 잦음(429)은 3시간, 그 밖은 30분 */
export function failMemoMs(e) {
  return e && (e.status === 403 || e.status === 429) ? BLOCK_MEMO_MS : FAIL_MEMO_MS;
}

/* 받은 값은 okMs · 실패는 failMsOf(오류) 동안 기억. 받는 중이면 그 약속을 같이 기다림.
   다시 받다 실패하면 마지막으로 받은 값을 그대로 줌 (없으면 실패) */
function memo(okMs, failMsOf, load, name) {
  let val = null, err = null, until = 0, busy = null;
  return () => {
    if (Date.now() < until) return val ? Promise.resolve(val) : Promise.reject(err);
    if (!busy) {
      busy = load()
        .then(v => { val = v; err = null; until = Date.now() + okMs; return v; },
              e => {
                err = e; until = Date.now() + failMsOf(e);
                console.error(`[api/competitors] ${name} 실패:`, e && e.message);
                if (val) return val;
                throw e;
              })
        .finally(() => { busy = null; });
    }
    return busy;
  };
}

const getA = memo(OK_MEMO_MS, failMemoMs, loadA, 'A');
const getB = memo(OK_MEMO_MS, failMemoMs, loadB, 'B');

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');   // 지시서대로 (빼도 화면은 그대로 — 같은 주소에서 부름)
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(405).json({ error: 'GET only' });
  }
  // 화면은 글자 없이 부름. 뒤에 글자가 붙으면 (캐시를 비켜 가며 타사 사이트를 두드리지 못하게) 400
  if (req.query && Object.keys(req.query).length) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(400).json({ error: 'no query' });
  }

  const settled = await Promise.allSettled([getA(), getB()]);
  const companies = [], failed = [];
  settled.forEach((s, i) => {
    const code = i === 0 ? 'A' : 'B';
    if (s.status === 'fulfilled') companies.push(s.value);
    else failed.push(code);
  });
  const body = { v: 1, now: new Date(Date.now()).toISOString(), companies, failed };

  // 둘 다 실패해도 200 + 30분 캐시 (5xx 는 캐시되지 않아 TV 가 부를 때마다 타사를 두드리게 됨).
  // 화면은 failed 에 든 회사의 앞 값을 그대로 두고, 24시간·4일 규칙으로만 뺌.
  res.setHeader('Cache-Control', CACHE_HEADER);
  return res.status(200).json(body);
}
