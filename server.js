// ============================================================================
//  도레미 마켓 실시간 채점 서버 (정답 고정 / 번호 칸 / 조별 답지)
//  - 참가자: /play  → 줄·띄어쓰기 모양대로 뜬 번호 칸을 채워 제출 (정답 글자 안 보임)
//  - 진행자: /host  → 암호 → '게임 시작' → 번호별 정답표 + 순위 + 조별 답지 비교
//  - 정답은 아래 ANSWER에 고정. 채점은 띄어쓰기 무시, 음절 단위.
//  무료 배포: Render 무료 등급. PORT 환경변수 자동 사용.
// ============================================================================

const express = require('express');
const app = express();
app.use(express.json());

const HOST_CODE = process.env.HOST_CODE || '1234';   // 진행자 암호
const TEAM_COUNT = 10;                                // 조 선택지 1~N조

// ===== 정답 (고정) — 노래만 바꾸려면 이 부분만 수정 =====
const ANSWER =
  "이는 보좌 가운데에 계신 어린 양이\n" +
  "그들의 목자가 되사 생명수 샘으로 인도하시고\n" +
  "하나님께서 그들의 눈에서 모든 눈물을 씻어 주실 것임이라";

// ===== 메모리 상태 =====
let state = { roundId: null, no: 0, subs: {} };

// ===== 정규화 / 모양 / 번호 / 채점 =====
function normalize(text) {
  // 소문자 + 문장부호 제거 + 공백 전부 제거(띄어쓰기 무시 채점)
  return (text || '').toLowerCase().replace(/[.,!?~…“”"'`·\-—:;()\[\]<>]/g, '').replace(/\s+/g, '');
}
// 2D 모양: [[1줄 단어별 글자수], [2줄...], ...]  (글자는 미포함 → 정답 안 새어나감)
function shape2D(text) {
  return String(text || '').split('\n').map(function (line) {
    var t = line.toLowerCase().replace(/[.,!?~…“”"'`·\-—:;()\[\]<>]/g, '').replace(/\s+/g, ' ').trim();
    if (!t) return [];
    return t.split(' ').map(function (w) { return Array.from(w).length; }).filter(function (n) { return n > 0; });
  }).filter(function (l) { return l.length > 0; });
}
// 번호별 음절 (띄어쓰기 제외) — 진행자 힌트용. [{n:1,ch:'이'}, ...]
function numberedSyllables(text) {
  return Array.from(normalize(text)).map(function (ch, i) { return { n: i + 1, ch: ch }; });
}
// 정답·답안 정렬 → match/sub/del/ins
function align(correct, guess) {
  const a = Array.from(correct), b = Array.from(guess);
  const n = a.length, m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) dp[i][0] = i;
  for (let j = 0; j <= m; j++) dp[0][j] = j;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + c);
  }
  let i = n, j = m; const cols = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) {
      cols.unshift({ c: a[i - 1], g: b[j - 1], type: a[i - 1] === b[j - 1] ? 'match' : 'sub' }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) { cols.unshift({ c: a[i - 1], g: null, type: 'del' }); i--; }
    else { cols.unshift({ c: null, g: b[j - 1], type: 'ins' }); j--; }
  }
  return cols;
}
function gradeAll() {
  const correct = normalize(ANSWER);
  const total = Array.from(correct).length;
  const results = Object.values(state.subs).map(function (s) {
    const cols = align(correct, normalize(s.answer));
    const matched = cols.filter(function (c) { return c.type === 'match'; }).length;
    const extra = cols.filter(function (c) { return c.type === 'ins'; }).length;
    return { team: s.team, matched: matched, wrong: total - matched, extra: extra, total: total, cols: cols };
  });
  results.sort(function (x, y) { return y.matched - x.matched || x.extra - y.extra; });
  results.forEach(function (t, i) {
    t.rank = (i > 0 && t.matched === results[i - 1].matched && t.extra === results[i - 1].extra) ? results[i - 1].rank : i + 1;
  });
  return { no: state.no, count: results.length, total: total, results: results, numbered: numberedSyllables(ANSWER) };
}

// ===== API =====
app.post('/api/round', function (req, res) {            // (진행자) 게임 시작 — 정답은 고정
  if ((req.body || {}).code !== HOST_CODE) return res.status(403).json({ error: '암호가 틀렸어요.' });
  state.no += 1; state.roundId = Date.now(); state.subs = {};
  res.json({ roundId: state.roundId, no: state.no });
});
app.get('/api/round', function (req, res) {             // (참가자) 모양만 — 글자는 안 보냄
  res.json({ active: !!state.roundId, roundId: state.roundId, no: state.no, shape: state.roundId ? shape2D(ANSWER) : [] });
});
app.post('/api/submit', function (req, res) {            // (참가자) 제출
  const body = req.body || {};
  if (!state.roundId) return res.status(400).json({ error: '아직 게임이 시작되지 않았어요.' });
  if (body.roundId !== state.roundId) return res.status(409).json({ error: '새 문제가 시작됐어요. 새로고침 해주세요.' });
  if (!body.team || !body.answer || !String(body.answer).trim()) return res.status(400).json({ error: '조와 답을 확인하세요.' });
  state.subs[body.team] = { team: body.team, answer: String(body.answer), ts: Date.now() };
  res.json({ ok: true });
});
app.get('/api/results', function (req, res) {            // (진행자) 번호표 + 순위 + 답지 — 암호 필요
  if (req.query.code !== HOST_CODE) return res.status(403).json({ error: '암호가 틀렸어요.' });
  res.json(gradeAll());
});

// ===== 공용 CSS =====
const CSS = `
  :root{--bg:#FFF7F0;--card:#fff;--ink:#251C15;--muted:#9A8C7E;--line:#F0E2D4;--brand:#FF6A2B;--brand2:#FF8A4B;
    --ok-bg:#E3F9EC;--ok-fg:#0E8A4F;--ok-line:#BDEBCF;--no-bg:#FDE7E5;--no-fg:#C5342A;--no-line:#F6C9C4;--gold:#FFF3D6;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);line-height:1.5;-webkit-text-size-adjust:100%;
    font-family:'Apple SD Gothic Neo','Pretendard','Malgun Gothic','Noto Sans KR',system-ui,sans-serif}
  .wrap{max-width:820px;margin:0 auto;padding:0 16px 56px}
  header{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;text-align:center;padding:24px 16px 26px;border-radius:0 0 24px 24px;margin-bottom:20px}
  header h1{margin:0;font-size:23px;font-weight:800;letter-spacing:-.5px}
  header p{margin:6px 0 0;font-size:14px;opacity:.92}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
  .label{font-size:13px;font-weight:700;color:var(--muted);margin-bottom:10px}
  .hint{font-size:12px;color:var(--muted);margin:10px 0 0}
  input[type=text],select{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:17px;font-family:inherit;color:var(--ink);background:#FFFDFB}
  input:focus,select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(255,106,43,.15)}
  button{font-family:inherit;font-weight:800;border:none;border-radius:12px;cursor:pointer}
  .btn-main{width:100%;background:var(--brand);color:#fff;padding:16px;font-size:17px}
  .btn-main:active{transform:translateY(1px)}
  .btn-ghost{background:#fff;color:var(--brand);border:1.5px solid var(--brand);padding:13px 16px;font-size:15px}
  .banner{padding:12px 14px;border-radius:12px;font-size:14px;font-weight:700;margin-bottom:14px;text-align:center}
  .banner.info{background:#EAF2FF;color:#1F5FBF}
  .banner.ok{background:var(--ok-bg);color:var(--ok-fg)}
  .done{text-align:center;padding:8px 0}
  .done .big{font-size:44px}.done .who{font-size:20px;font-weight:800;margin:6px 0}
  .done .ans{background:#FFFDFB;border:1px solid var(--line);border-radius:12px;padding:12px;margin:12px 0;font-size:16px}
  /* 참가자 번호 칸 */
  .grid{display:flex;flex-direction:column;gap:18px;margin:4px 0}        /* 줄 사이 */
  .gline{display:flex;flex-wrap:wrap;gap:16px}                            /* 한 줄: 단어들(gap=띄어쓰기) */
  .gword{display:flex;gap:5px}                                            /* 단어 안 글자 */
  .gcellwrap{display:flex;flex-direction:column;align-items:center;gap:3px}
  .gnum{font-size:10px;color:var(--muted);line-height:1;font-weight:700}
  .grid .gcell{flex:0 0 auto;width:46px;height:54px;text-align:center;font-size:25px;font-weight:800;border:2px solid var(--line);border-radius:10px;background:#FFFDFB;color:var(--ink);padding:0}
  .grid .gcell:focus{border-color:var(--brand);outline:none;box-shadow:0 0 0 3px rgba(255,106,43,.15)}
  /* 진행자 번호별 정답표 */
  .ansref{display:flex;flex-wrap:wrap;gap:6px}
  .refchip{font-size:16px;font-weight:700;background:#FFFDFB;border:1px solid var(--line);border-radius:8px;padding:3px 9px}
  .refchip b{color:var(--brand);font-size:11px;margin-right:3px;font-weight:800}
  /* 순위표 */
  .status{display:flex;justify-content:space-between;align-items:center;font-size:14px;color:var(--muted);margin-bottom:12px}
  .status b{color:var(--ink)}
  .scroll{overflow-x:auto}
  table{width:100%;border-collapse:collapse;min-width:340px}
  th,td{padding:11px 8px;border-bottom:1px solid var(--line);font-size:15px;text-align:center}
  th{font-size:12px;color:var(--muted);font-weight:700}
  td.team{text-align:left;font-weight:700}
  .rk{font-size:18px;font-weight:800}
  td.num{font-variant-numeric:tabular-nums;font-weight:700}
  .wrong{color:var(--no-fg)}.right{color:var(--ok-fg)}
  tr.top td{background:var(--gold)}
  /* 조별 답지 비교 */
  .sheet-team{font-weight:800;margin:16px 0 4px;font-size:15px}
  .diff{display:flex;flex-wrap:wrap;gap:5px;padding:4px 0}
  .col{display:flex;flex-direction:column;gap:4px}
  .tile{width:38px;height:38px;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:800;border-radius:9px;border:1.5px solid transparent}
  .tile.ok{background:var(--ok-bg);color:var(--ok-fg);border-color:var(--ok-line)}
  .tile.no{background:var(--no-bg);color:var(--no-fg);border-color:var(--no-line)}
  .tile.gap{background:transparent;border:1.5px dashed var(--line)}
  .dlegend{font-size:11px;color:var(--muted);margin-bottom:8px}
  .empty{text-align:center;color:var(--muted);padding:24px 0;font-size:14px}
  a.big-link{display:block;text-align:center;background:#fff;border:1.5px solid var(--brand);color:var(--brand);text-decoration:none;font-weight:800;padding:18px;border-radius:16px;margin-bottom:12px;font-size:18px}
  @media(max-width:420px){.grid .gcell{width:40px;height:48px;font-size:22px}.tile{width:34px;height:34px;font-size:18px}}
`;

let TEAM_OPTIONS = '<option value="">조를 선택하세요</option>';
for (let k = 1; k <= TEAM_COUNT; k++) TEAM_OPTIONS += '<option value="' + k + '조">' + k + '조</option>';

const HOME_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>도레미 마켓 채점기</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>🎵 도레미 마켓 채점기</h1><p>주소가 분리된 실시간 채점</p></header>
<a class="big-link" href="/play">참가자 화면 (빈칸 채우기) →</a>
<a class="big-link" href="/host">진행자 화면 (출제·결과) →</a>
<p class="hint">참가자에게는 <b>/play</b> 주소를, 진행자만 <b>/host</b> 주소를 사용하세요.</p>
</div></body></html>`;

// 참가자 페이지 — 클라이언트 스크립트엔 백틱/${} 사용 금지
const PLAY_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>참가자 · 도레미 마켓</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>🎵 빈칸 채우기</h1><p>번호를 보고 칸을 채우세요</p></header>
<div id="banner"></div>
<div class="card"><div class="label">우리 조</div><select id="team">${TEAM_OPTIONS}</select></div>
<div id="answer" class="card" style="display:none">
  <div class="label">빈칸 채우기</div>
  <div id="gridwrap">
    <div id="grid" class="grid"></div>
    <button class="btn-main" id="submit" style="margin-top:16px">제출하기</button>
    <p class="hint">칸 위 숫자는 글자 번호예요. 칸을 눌러 한 글자씩 입력하고, 아무 칸이나 다시 눌러 고칠 수 있어요. 모르는 칸은 비워도 돼요.</p>
  </div>
  <div id="wait" style="display:none"><p class="hint">진행자가 게임을 시작하면 빈칸이 나타나요.</p></div>
</div>
<div id="done" class="card" style="display:none"><div class="done">
  <div class="big">✅</div><div class="who" id="dwho"></div><div>제출 완료!</div>
  <button class="btn-ghost" id="redo">답 고치기</button></div></div>
</div>
<script>
  var curRound=null, doneRound=null, renderedRound=null, curShape=[], gridInputs=[];
  function $(id){return document.getElementById(id);}
  function setBanner(txt,cls){ $('banner').innerHTML='<div class="banner '+(cls||'info')+'">'+txt+'</div>'; }

  // 2D 모양에 맞춰 줄·단어·글자 칸 생성 + 칸마다 번호
  function renderGrid(shape){
    var box=$('grid'); box.innerHTML=''; gridInputs=[]; var num=0;
    shape.forEach(function(line){
      var lineDiv=document.createElement('div'); lineDiv.className='gline';
      line.forEach(function(len){
        var word=document.createElement('div'); word.className='gword';
        for(var k=0;k<len;k++){
          num++;
          var wrap=document.createElement('div'); wrap.className='gcellwrap';
          var lab=document.createElement('div'); lab.className='gnum'; lab.textContent=num;
          var inp=document.createElement('input'); inp.type='text'; inp.maxLength=1; inp.className='gcell';
          inp.addEventListener('focus', function(){ var el=this; setTimeout(function(){el.select();},0); }); // 탭→글자 선택→수정 쉬움
          wrap.appendChild(lab); wrap.appendChild(inp);
          word.appendChild(wrap); gridInputs.push(inp);
        }
        lineDiv.appendChild(word);
      });
      box.appendChild(lineDiv);
    });
  }
  function clearGrid(){ $('grid').innerHTML=''; gridInputs=[]; }

  function refreshView(){
    var team=$('team').value;
    if(!team){ $('answer').style.display='none'; $('done').style.display='none'; setBanner('먼저 우리 조를 선택하세요'); return; }
    if(curRound!==null && doneRound===curRound){ $('answer').style.display='none'; $('done').style.display='block'; setBanner('제출 완료','ok'); return; }
    $('done').style.display='none'; $('answer').style.display='block';
    if(!curRound){ $('gridwrap').style.display='none'; $('wait').style.display='block'; renderedRound=null; clearGrid(); setBanner('진행자가 게임을 시작하면 빈칸이 나타나요'); return; }
    $('wait').style.display='none'; $('gridwrap').style.display='block';
    if(renderedRound!==curRound){ renderGrid(curShape); renderedRound=curRound; } // 새 문제일 때만 새로 그림(입력 보존)
    setBanner('빈칸을 채워 제출하세요');
  }

  function pollRound(){
    fetch('/api/round').then(function(r){return r.json();}).then(function(d){
      if(d.active){ curRound=d.roundId; curShape=d.shape||[]; } else { curRound=null; curShape=[]; }
      refreshView();
    }).catch(function(){});
  }
  $('team').addEventListener('change', refreshView);

  $('submit').onclick=function(){
    var team=$('team').value;
    if(!team){ alert('조를 선택하세요.'); return; }
    if(!gridInputs.length){ alert('아직 빈칸이 없어요.'); return; }
    var answer=gridInputs.map(function(i){return i.value;}).join('');  // 글자만 이어붙임(띄어쓰기 무시 채점)
    if(!answer){ alert('답을 입력하세요.'); return; }
    fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roundId:curRound,team:team,answer:answer})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){ alert(res.j.error||'제출 실패'); return; }
      doneRound=curRound; $('dwho').textContent=team; refreshView();
    }).catch(function(){ alert('네트워크 오류로 제출하지 못했어요.'); });
  };
  $('redo').onclick=function(){ doneRound=null; refreshView(); };  // 칸 값은 그대로 남아 고칠 수 있음

  pollRound(); setInterval(pollRound,3000);
</script></body></html>`;

const HOST_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>진행자 · 도레미 마켓</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>🎛️ 진행자 화면</h1><p>번호별 정답 · 순위 · 조별 답지</p></header>
<div id="gate" class="card"><div class="label">진행자 암호</div>
  <input type="text" id="code" placeholder="암호 입력">
  <button class="btn-main" id="enter" style="margin-top:14px">입장</button>
  <p class="hint">암호는 서버에서 확인합니다. 참가자에게 알려주지 마세요.</p></div>
<div id="main" style="display:none">
  <div class="card">
    <div class="label">정답이 고정돼 있어요</div>
    <button class="btn-main" id="start">게임 시작 (참가자에게 빈칸 띄우기)</button>
    <p class="hint">누르면 참가자들이 빈칸을 받고, 이전 제출은 초기화돼요.</p>
  </div>
  <div class="card"><div class="label">번호별 정답 (힌트용 — "32번째는 시")</div><div id="ansref" class="ansref"></div></div>
  <div class="card" id="board" style="display:none">
    <div class="status"><span>현재 <b id="rno">-</b>번 게임</span><span><b id="cnt">0</b>개 조 제출</span></div>
    <div class="scroll"><table>
      <thead><tr><th>순위</th><th style="text-align:left">조</th><th>맞음</th><th>틀림</th><th>정답률</th></tr></thead>
      <tbody id="body"></tbody></table></div>
    <div class="empty" id="empty">아직 제출이 없어요.</div>
    <button class="btn-ghost" id="refresh" style="width:100%;margin-top:14px">지금 새로고침</button>
  </div>
  <div class="card" id="sheets" style="display:none">
    <div class="label">조별 답지 (정답과 음절별 비교)</div>
    <div class="dlegend">위=정답 · 아래=제출 / 초록=맞음, 빨강=틀림, 점선=빠짐·잉여</div>
    <div id="sheets-body"></div>
  </div>
</div>
</div>
<script>
  var hostCode=null, timer=null; var MEDAL={1:'🥇',2:'🥈',3:'🥉'};
  function $(id){return document.getElementById(id);}

  $('enter').onclick=function(){
    var code=$('code').value.trim();
    fetch('/api/results?code='+encodeURIComponent(code)).then(function(r){
      if(r.status===403){ alert('암호가 틀렸어요.'); return null; }
      return r.json();
    }).then(function(d){
      if(!d) return;
      hostCode=code; $('gate').style.display='none'; $('main').style.display='block';
      renderRef(d.numbered);  // 번호별 정답표 표시
    }).catch(function(){ alert('서버에 연결하지 못했어요.'); });
  };

  $('start').onclick=function(){
    fetch('/api/round',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:hostCode})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){ alert(res.j.error||'시작 실패'); return; }
      $('board').style.display='block'; $('sheets').style.display='block'; $('rno').textContent=res.j.no;
      poll(); if(timer) clearInterval(timer); timer=setInterval(poll,2500);
    }).catch(function(){ alert('네트워크 오류'); });
  };
  $('refresh').onclick=poll;

  // 번호별 정답표 (힌트용)
  function renderRef(numbered){
    var box=$('ansref'); box.innerHTML='';
    (numbered||[]).forEach(function(s){
      var chip=document.createElement('span'); chip.className='refchip';
      var b=document.createElement('b'); b.textContent=s.n;
      chip.appendChild(b); chip.appendChild(document.createTextNode(s.ch));
      box.appendChild(chip);
    });
  }

  function poll(){
    if(!hostCode) return;
    fetch('/api/results?code='+encodeURIComponent(hostCode)).then(function(r){return r.json();}).then(function(d){
      $('cnt').textContent=d.count; $('rno').textContent=d.no;
      // 순위표
      var body=$('body'); body.innerHTML=''; $('empty').style.display=d.results.length?'none':'block';
      d.results.forEach(function(t){
        var tr=document.createElement('tr'); tr.className=(t.rank===1?'top':'');
        tr.innerHTML='<td class="rk">'+(MEDAL[t.rank]||t.rank)+'</td><td class="team"></td>'+
          '<td class="num right">'+t.matched+'</td><td class="num wrong">'+t.wrong+'</td>'+
          '<td class="num">'+(t.total?Math.round(t.matched/t.total*100):0)+'%</td>';
        tr.children[1].textContent=t.team+(t.extra?' (+'+t.extra+')':'');
        body.appendChild(tr);
      });
      // 조별 답지
      var sb=$('sheets-body'); sb.innerHTML='';
      if(!d.results.length){ sb.innerHTML='<div class="empty">제출이 들어오면 여기에 표시돼요.</div>'; }
      d.results.forEach(function(t){
        var head=document.createElement('div'); head.className='sheet-team';
        head.textContent=(MEDAL[t.rank]||('#'+t.rank))+' '+t.team+'  ·  '+t.matched+'/'+t.total+' 맞음, '+t.wrong+' 틀림';
        sb.appendChild(head);
        sb.appendChild(buildDiff(t.cols));
      });
    }).catch(function(){});
  }

  function buildDiff(cols){
    var box=document.createElement('div'); box.className='diff';
    cols.forEach(function(col){
      var w=document.createElement('div'); w.className='col';
      w.appendChild(tile(col.c,col.type==='match',col.c===null));
      w.appendChild(tile(col.g,col.type==='match',col.g===null));
      box.appendChild(w);
    });
    return box;
  }
  function tile(ch,isMatch,isGap){ var el=document.createElement('div'); el.className='tile '+(isGap?'gap':isMatch?'ok':'no'); el.textContent=isGap?'':ch; return el; }
</script></body></html>`;

// ===== 라우트 =====
app.get('/', function (req, res) { res.type('html').send(HOME_PAGE); });
app.get('/play', function (req, res) { res.type('html').send(PLAY_PAGE); });
app.get('/host', function (req, res) { res.type('html').send(HOST_PAGE); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () { console.log('도레미 마켓 채점 서버 실행 중: 포트 ' + PORT); });
