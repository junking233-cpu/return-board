/* ============================================================
   POST /api/telegram   — 텔레그램 웹훅
   ------------------------------------------------------------
   등록된 채팅방에서 온 /시세 · /help · /start 만 받음 (다른 말은 조용히 무시).

   우리 매장 시세는 이제 장부 「손님 시세」 한 곳에서 바꿈 (세 매장 모두 · api/prices.js SOURCE).
   그래서 /시세 는 아무 데도 쓰지 않음:
     /시세  ·  /시세 골드바 770000/737000  ·  /시세@봇이름 …  ·  고친 메시지(edited_message)
       → 「시세는 이제 장부 『손님 시세』에서 바꿔요」 + 지금 리턴 TV 값만 답함
         (값은 loadOurs('return','ledger') — TV 와 같은 길 · 같은 짝짓기 · 장부 공개 키로 읽기만)
       → 장부를 못 읽으면 「지금 장부 시세를 못 읽었어요 · 장부 『손님 시세』에서 바꿔 주세요」
     /help · /start → 위 안내

   되돌리기 (예전처럼 이 방에서 리턴 TV 시세를 바꾸려면):
     SAVE_FROM_CHAT = true  +  api/prices.js 의 SOURCE.return = 'board'
     our_prices 표와 저장 코드(sbGet · sbPatch · parse · saveFromChat)는 그래서 지우지 않고 남겨 둠

   환경변수 (Vercel):
     SUPABASE_URL
     SUPABASE_SERVICE_KEY   ← 쓰기용. anon 키 아님 (되돌렸을 때만 씀)
     TELEGRAM_BOT_TOKEN
     TELEGRAM_CHAT_ID       ← 이 방에서 온 것만 처리

   예전 사용법 (SAVE_FROM_CHAT = true 일 때만):
     /시세 골드바 770000/737000
     /시세 18k 546000
     /시세 골드바 770000/737000 18k 546000 14k 424000
     /시세                        ← 현재 시세 조회
   ============================================================ */

import { loadOurs } from './prices.js';

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;
const BOT      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_OK  = String(process.env.TELEGRAM_CHAT_ID || '');

// /시세 로 our_prices 를 고치던 길 — 꺼 둠 (시세는 장부 한 곳에서). 되돌릴 때만 true
export const SAVE_FROM_CHAT = false;

/* 별칭 → DB item_key */
const ALIAS = {
  '골드바':'goldbar', '순금':'goldbar', '24k':'goldbar', '24':'goldbar', '금':'goldbar',
  '18k':'gold18', '18':'gold18',
  '14k':'gold14', '14':'gold14',
  '백금':'platinum', 'pt':'platinum',
  '실버바':'silverbar', '은':'silverbar', '실버':'silverbar',
};

const LABEL = {
  goldbar:'골드바 1돈', gold18:'18K 금시세', gold14:'14K 금시세',
  platinum:'백금 시세', silverbar:'실버바999 1kg',
};

const ORDER = ['goldbar','gold18','gold14','platinum','silverbar'];

/* ---------- Supabase (시세판 DB · 되돌렸을 때만) ---------- */
async function sbGet(path){
  const r = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers:{ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}` },
  });
  if(!r.ok) throw new Error(`GET ${r.status} ${await r.text()}`);
  return r.json();
}

async function sbPatch(itemKey, body){
  const r = await fetch(
    `${SB_URL}/rest/v1/our_prices?store=eq.return&item_key=eq.${itemKey}`,
    { method:'PATCH',
      headers:{
        apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`,
        'Content-Type':'application/json', Prefer:'return=representation',
      },
      body:JSON.stringify(body) }
  );
  if(!r.ok) throw new Error(`PATCH ${r.status} ${await r.text()}`);
  return r.json();
}

/* ---------- 텔레그램 ---------- */
async function reply(chatId, text){
  await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({ chat_id:chatId, text, parse_mode:'HTML' }),
  });
}

const won = n => (n==null ? '—' : Number(n).toLocaleString('ko-KR')+'원');

function table(rows){
  const by = {}; rows.forEach(r => by[r.item_key] = r);
  return ORDER.filter(k=>by[k]).map(k=>{
    const r = by[k];
    const buy  = r.buy_price  != null ? won(r.buy_price)  : (r.buy_text  || '—');
    const sell = r.sell_price != null ? won(r.sell_price) : (r.sell_text || '—');
    return `${LABEL[k]}\n   살때 ${buy}  |  팔때 ${sell}`;
  }).join('\n');
}

/* ---------- 장부 안내 (지금 쓰는 길) ---------- */
const MOVED     = '<b>시세는 이제 장부 『손님 시세』에서 바꿔요</b>';
const NOT_SAVED = '이 방에서 보낸 값은 저장하지 않았어요.';
const READ_FAIL = '지금 장부 시세를 못 읽었어요 · 장부 『손님 시세』에서 바꿔 주세요';

// 장부 값의 날짜 → 「11/02 저장」 · 시각까지 알면 「11/02 09:51 저장」 (한국시간 · 기기 시간대와 무관)
export function savedStamp(updatedAt, dateOnly){
  const ms = Date.parse(updatedAt);
  if(!Number.isFinite(ms)) return '';
  const k = new Date(ms + 9 * 3600 * 1000);
  const p = n => String(n).padStart(2, '0');
  const day = `${p(k.getUTCMonth() + 1)}/${p(k.getUTCDate())}`;
  return dateOnly ? `${day} 저장` : `${day} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())} 저장`;
}

// loadOurs 줄 {label,buy,buyText,sell,sellText} → 예전 /시세 조회와 같은 꼴 (TV 칸 「내가 살때 · 내가 팔때」 순서)
export function ledgerTable(rows){
  return rows.map(r => {
    const buy  = r.buy  != null ? won(r.buy)  : (r.buyText  || '—');
    const sell = r.sell != null ? won(r.sell) : (r.sellText || '—');
    return `${r.label}\n   살때 ${buy}  |  팔때 ${sell}`;
  }).join('\n');
}

// /시세 에 대한 답 글 (아무 데도 안 씀 · 장부를 읽기만). sent = /시세 뒤에 값을 붙여 보냈나
export async function guideText(sent){
  const head = sent ? `${MOVED}\n${NOT_SAVED}` : MOVED;
  let o;
  try{
    o = await loadOurs('return', 'ledger');
  }catch(err){
    console.error('[api/telegram] 장부 읽기 실패', err);
    return sent ? `${READ_FAIL}\n${NOT_SAVED}` : READ_FAIL;
  }
  if(o.empty || !o.rows.length){
    return `${head}\n\n장부에 리턴 시세가 아직 없어요 · 장부 『손님 시세』에서 넣어 주세요`;
  }
  const stamp = savedStamp(o.updatedAt, o.dateOnly);
  return `${head}\n\n<b>지금 리턴 TV</b>${stamp ? ` (${stamp})` : ''}\n${ledgerTable(o.rows)}`;
}

const HELP_LEDGER =
`${MOVED}

장부 → 손님 시세 → 리턴 탭에서 바꾸고 저장하면
TV 는 30초 안에 바뀌어요 (홈페이지도 같은 값).

이 방에서는 더 바꾸지 않아요.
/시세  ← 지금 리턴 TV 값 보기`;

/* ---------- 예전 저장 길 (SAVE_FROM_CHAT = true 일 때만) ---------- */
const HELP_SAVE =
`<b>시세 입력 방법</b>

/시세 골드바 770000/737000
   → 살때/팔때 같이

/시세 18k 546000
   → 팔때만 (살때는 '제품시세적용' 유지)

여러 개 한 번에:
/시세 골드바 770000/737000 18k 546000

품목: 골드바(순금·24k) / 18k / 14k / 백금 / 실버바(은)

/시세  ← 현재 시세 보기`;

const HELP = SAVE_FROM_CHAT ? HELP_SAVE : HELP_LEDGER;

/* ---------- 파싱 ---------- */
function parse(text){
  // "/시세" 또는 "/시세@봇이름" 제거
  const body = text.replace(/^\/시세(@\S+)?\s*/, '').trim();
  if(!body) return { empty:true, items:[] };

  const tokens = body.split(/\s+/);
  const items = [];
  const bad = [];

  for(let i=0;i<tokens.length;i++){
    const key = ALIAS[tokens[i].toLowerCase()];
    if(!key){ bad.push(tokens[i]); continue; }

    const val = tokens[i+1];
    if(!val){ bad.push(`${tokens[i]}(값 없음)`); continue; }
    i++;

    const nums = val.split('/').map(s=>s.replace(/[,원]/g,''));
    if(nums.some(n=>!/^\d+$/.test(n))){ bad.push(`${tokens[i-1]} ${val}`); continue; }

    const [a,b] = nums.map(Number);
    items.push(b!=null ? { key, buy:a, sell:b } : { key, sell:a });
  }
  return { items, bad };
}

async function saveFromChat(msg, chatId, text){
  const { empty, items } = parse(text);

  // 값 없이 /시세 만 → 현재 시세 조회
  if(empty){
    const rows = await sbGet('our_prices?store=eq.return&order=sort_order.asc');
    await reply(chatId, `<b>현재 우리 매장 시세</b>\n\n${table(rows)}`);
    return;
  }

  if(!items.length){
    await reply(chatId, `못 알아들었어요.\n\n${HELP}`);
    return;
  }

  // 직전 값과 비교 — ±5% 넘으면 경고 (0 하나 더 친 사고 방지)
  const before = await sbGet('our_prices?store=eq.return');
  const prev = {}; before.forEach(r => prev[r.item_key] = r);

  const warn = [];
  for(const it of items){
    const p = prev[it.key]; if(!p) continue;
    for(const f of ['buy','sell']){
      if(it[f]==null) continue;
      const old = p[`${f}_price`];
      if(old && Math.abs(it[f]-old)/old > 0.05){
        warn.push(`${LABEL[it.key]} ${f==='buy'?'살때':'팔때'}: ${won(old)} → ${won(it[f])}`);
      }
    }
  }

  // 저장
  for(const it of items){
    const patch = { updated_by: msg.from?.first_name || 'telegram' };
    if(it.buy  != null){ patch.buy_price  = it.buy;  patch.buy_text  = null; }
    if(it.sell != null){ patch.sell_price = it.sell; patch.sell_text = null; }
    await sbPatch(it.key, patch);
  }

  const rows = await sbGet('our_prices?store=eq.return&order=sort_order.asc');
  const now = new Date().toLocaleTimeString('ko-KR',{
    timeZone:'Asia/Seoul', hour:'2-digit', minute:'2-digit',
  });

  let out = `✅ <b>시세 반영 완료</b> (${now})\n\n${table(rows)}`;
  if(warn.length){
    out += `\n\n⚠️ <b>5% 이상 변동</b>\n${warn.join('\n')}\n확인해 주세요.`;
  }
  await reply(chatId, out);
}

/* ---------- 핸들러 ---------- */
export default async function handler(req, res){
  if(req.method !== 'POST') return res.status(200).send('ok');

  try{
    const msg = req.body?.message || req.body?.edited_message;
    if(!msg?.text) return res.status(200).send('ok');

    const chatId = String(msg.chat.id);
    // 등록된 방이 아니면 조용히 무시
    if(CHAT_OK && chatId !== CHAT_OK) return res.status(200).send('ok');

    const text = msg.text.trim();
    if(!/^\/(시세|help|start)/.test(text)) return res.status(200).send('ok');

    if(/^\/(help|start)/.test(text)){
      await reply(chatId, HELP);
      return res.status(200).send('ok');
    }

    if(SAVE_FROM_CHAT){
      await saveFromChat(msg, chatId, text);
      return res.status(200).send('ok');
    }

    // /시세 … — 아무 데도 안 씀 · 안내 + 지금 리턴 TV 값 (값을 붙여 보냈으면 「저장 안 함」 한 줄 더)
    const sent = text.replace(/^\/시세(@\S+)?/, '').trim() !== '';
    await reply(chatId, await guideText(sent));
    return res.status(200).send('ok');

  }catch(err){
    console.error('[api/telegram]', err);
    try{
      const m = req.body?.message || req.body?.edited_message;
      const chatId = m?.chat?.id;
      if(chatId) await reply(chatId, SAVE_FROM_CHAT ? `저장 실패: ${err.message}` : `처리 실패: ${err.message}`);
    }catch{}
    return res.status(200).send('ok');   // 텔레그램 재시도 폭탄 방지
  }
}
