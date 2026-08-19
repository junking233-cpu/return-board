/* ============================================================
   POST /api/telegram   — 텔레그램 웹훅
   ------------------------------------------------------------
   등록된 채팅방에서 온 /시세 명령어만 처리해서 our_prices 갱신.

   환경변수 (Vercel):
     SUPABASE_URL
     SUPABASE_SERVICE_KEY   ← 쓰기용. anon 키 아님
     TELEGRAM_BOT_TOKEN
     TELEGRAM_CHAT_ID       ← 이 방에서 온 것만 처리

   사용법:
     /시세 골드바 770000/737000
     /시세 18k 546000
     /시세 골드바 770000/737000 18k 546000 14k 424000
     /시세                        ← 현재 시세 조회
   ============================================================ */

const SB_URL   = process.env.SUPABASE_URL;
const SB_KEY   = process.env.SUPABASE_SERVICE_KEY;
const BOT      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_OK  = String(process.env.TELEGRAM_CHAT_ID || '');

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

/* ---------- Supabase ---------- */
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

const HELP =
`<b>시세 입력 방법</b>

/시세 골드바 770000/737000
   → 살때/팔때 같이

/시세 18k 546000
   → 팔때만 (살때는 '제품시세적용' 유지)

여러 개 한 번에:
/시세 골드바 770000/737000 18k 546000

품목: 골드바(순금·24k) / 18k / 14k / 백금 / 실버바(은)

/시세  ← 현재 시세 보기`;

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

    const { empty, items, bad } = parse(text);

    // 값 없이 /시세 만 → 현재 시세 조회
    if(empty){
      const rows = await sbGet('our_prices?store=eq.return&order=sort_order.asc');
      await reply(chatId, `<b>현재 우리 매장 시세</b>\n\n${table(rows)}`);
      return res.status(200).send('ok');
    }

    if(!items.length){
      await reply(chatId, `못 알아들었어요.\n\n${HELP}`);
      return res.status(200).send('ok');
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

    return res.status(200).send('ok');

  }catch(err){
    console.error('[api/telegram]', err);
    try{
      const chatId = req.body?.message?.chat?.id;
      if(chatId) await reply(chatId, `저장 실패: ${err.message}`);
    }catch{}
    return res.status(200).send('ok');   // 텔레그램 재시도 폭탄 방지
  }
}
