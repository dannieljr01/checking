// ============================================================================
//  받아쓰기 실시간 채점 서버
//  - 참가자: /play  → 번호 칸 채워 제출. 진행자가 '띄어쓰기 공개'하면 단어 틈이 생김.
//  - 진행자: /host  → 암호 → 게임 시작 / 띄어쓰기 공개 / 번호별 정답 / 순위 / 조별 답지
//  - 채점은 '칸 번호 위치' 기준 (32번 칸 = 정답 32번째 글자). 띄어쓰기는 화면 표시용일 뿐.
//  무료 배포: Render 무료 등급. PORT 환경변수 자동 사용.
// ============================================================================

const express = require('express');
const app = express();
app.use(express.json());

const HOST_CODE = process.env.HOST_CODE || 'banana';   // 진행자 암호 (원하는 값으로 변경)
const TEAM_COUNT = 8;                                // 조 선택지 1~N조

// ===== 정답 (고정) — 노래만 바꾸려면 ANSWER 와 ROWS 를 함께 수정 =====
const ANSWER =
  "이는 보좌 가운데에 계신 어린 양이\n" +
  "그들의 목자가 되사 생명수 샘으로 인도하시고\n" +
  "하나님께서 그들의 눈에서 모든 눈물을 씻어 주실 것임이라";

// 화면 칸 줄 배치(PPT 그대로). 합계가 정답 글자수와 같아야 함.
const ROWS = [10, 12, 11, 11, 9, 4];

// ===== 메모리 상태 =====
let state = { roundId: null, no: 0, subs: {}, revealed: false };

// ===== 도우미 =====
function normalize(text) {
  // 소문자 + 문장부호 제거 + 공백 전부 제거 → 순수 글자열
  return (text || '').toLowerCase().replace(/[.,!?~…“”"'`·\-—:;()\[\]<>]/g, '').replace(/\s+/g, '');
}
const CORRECT = Array.from(normalize(ANSWER));   // 정답 글자 배열 (위치 = 칸 번호-1)
const TOTAL = CORRECT.length;

// 단어별 글자수 → 단어가 끝나는 칸 번호들(띄어쓰기 공개 시 틈 위치)
const WORD_LENS = String(ANSWER).split('\n').reduce(function (acc, line) {
  var t = line.toLowerCase().replace(/[.,!?~…“”"'`·\-—:;()\[\]<>]/g, '').replace(/\s+/g, ' ').trim();
  if (t) t.split(' ').forEach(function (w) { acc.push(Array.from(w).length); });
  return acc;
}, []);
function wordEnds() { var ends = [], n = 0; WORD_LENS.forEach(function (len) { n += len; ends.push(n); }); return ends; }

// 번호별 정답 (힌트용). [{n:1,ch:'이'}, ...]
function numbered() { return CORRECT.map(function (ch, i) { return { n: i + 1, ch: ch }; }); }

// 한 조 채점: 칸 위치별로 정답과 비교
function gradeOne(cells) {
  var marks = CORRECT.map(function (ans, i) {
    var put = (cells && cells[i] != null) ? String(cells[i]) : '';
    return { n: i + 1, put: put, ans: ans, ok: put !== '' && put === ans };
  });
  var matched = marks.filter(function (m) { return m.ok; }).length;
  return { matched: matched, wrong: TOTAL - matched, total: TOTAL, marks: marks };
}
function gradeAll() {
  var results = Object.values(state.subs).map(function (s) {
    var g = gradeOne(s.cells);
    return { team: s.team, matched: g.matched, wrong: g.wrong, total: g.total, marks: g.marks };
  });
  results.sort(function (x, y) { return y.matched - x.matched; });
  results.forEach(function (t, i) { t.rank = (i > 0 && t.matched === results[i - 1].matched) ? results[i - 1].rank : i + 1; });
  return { no: state.no, count: results.length, total: TOTAL, results: results, numbered: numbered() };
}

// ===== API =====
app.post('/api/round', function (req, res) {            // (진행자) 게임 시작
  if ((req.body || {}).code !== HOST_CODE) return res.status(403).json({ error: '암호가 틀렸어요.' });
  state.no += 1; state.roundId = Date.now(); state.subs = {}; state.revealed = false;
  res.json({ roundId: state.roundId, no: state.no });
});
app.post('/api/reveal', function (req, res) {            // (진행자) 띄어쓰기 공개
  if ((req.body || {}).code !== HOST_CODE) return res.status(403).json({ error: '암호가 틀렸어요.' });
  if (!state.roundId) return res.status(400).json({ error: '먼저 게임을 시작하세요.' });
  state.revealed = true;
  res.json({ ok: true });
});
app.get('/api/round', function (req, res) {             // (참가자) 칸 배치 + 공개 여부 (정답 글자는 미포함)
  res.json({
    active: !!state.roundId, roundId: state.roundId, no: state.no, total: TOTAL,
    rows: state.roundId ? ROWS : [], revealed: state.revealed,
    wordEnds: (state.roundId && state.revealed) ? wordEnds() : []   // 공개 전엔 경계 안 보냄
  });
});
app.post('/api/submit', function (req, res) {            // (참가자) 제출 (칸 배열)
  var body = req.body || {};
  if (!state.roundId) return res.status(400).json({ error: '아직 게임이 시작되지 않았어요.' });
  if (body.roundId !== state.roundId) return res.status(409).json({ error: '새 문제가 시작됐어요. 새로고침 해주세요.' });
  if (!body.team || !Array.isArray(body.cells)) return res.status(400).json({ error: '제출 형식 오류' });
  if (!body.cells.join('').trim()) return res.status(400).json({ error: '답을 입력하세요.' });
  state.subs[body.team] = { team: body.team, cells: body.cells.slice(0, TOTAL), ts: Date.now() };
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
  .wrap{max-width:860px;margin:0 auto;padding:0 16px 56px}
  header{background:linear-gradient(135deg,var(--brand),var(--brand2));color:#fff;text-align:center;padding:24px 16px 26px;border-radius:0 0 24px 24px;margin-bottom:20px}
  header h1{margin:0;font-size:24px;font-weight:800;letter-spacing:-.5px}
  header p{margin:6px 0 0;font-size:14px;opacity:.92}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;margin-bottom:16px}
  .label{font-size:13px;font-weight:700;color:var(--muted);margin-bottom:10px}
  .hint{font-size:12px;color:var(--muted);margin:10px 0 0}
  input[type=text],select{width:100%;border:1.5px solid var(--line);border-radius:12px;padding:13px 14px;font-size:17px;font-family:inherit;color:var(--ink);background:#FFFDFB}
  input:focus,select:focus{outline:none;border-color:var(--brand);box-shadow:0 0 0 3px rgba(255,106,43,.15)}
  button{font-family:inherit;font-weight:800;border:none;border-radius:12px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .btn-main{width:100%;background:var(--brand);color:#fff;padding:16px;font-size:17px}
  .btn-main:active{transform:translateY(1px)}
  .btn-ghost{background:#fff;color:var(--brand);border:1.5px solid var(--brand);padding:13px 16px;font-size:15px}
  .banner{padding:12px 14px;border-radius:12px;font-size:14px;font-weight:700;margin-bottom:14px;text-align:center}
  .banner.info{background:#EAF2FF;color:#1F5FBF}
  .banner.ok{background:var(--ok-bg);color:var(--ok-fg)}
  .done{text-align:center;padding:8px 0}
  .done .big{font-size:44px}.done .who{font-size:20px;font-weight:800;margin:6px 0}
  /* 참가자 번호 칸 */
  .gridscaler{width:100%;overflow:hidden;position:relative}    /* 화면 폭에 맞춰 축소되는 영역 */
  .grid{display:flex;flex-direction:column;gap:14px;align-items:center;width:max-content;transform-origin:top left}
  .row{display:flex;gap:5px;justify-content:center;flex-wrap:nowrap}   /* 한 줄 절대 안 깨짐 */
  .gcellwrap{display:flex;flex-direction:column;align-items:center;gap:3px;flex:0 0 auto}
  .grid.revealed .gcellwrap.wordend{margin-right:22px}        /* 공개 시 단어 끝에 틈 */
  .gnum{font-size:10px;color:var(--muted);line-height:1;font-weight:700}
  .grid .gcell{flex:0 0 auto;width:40px;height:48px;text-align:center;font-size:23px;font-weight:800;border:2px solid var(--line);border-radius:10px;background:#FFFDFB;color:var(--ink);padding:0}
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
  /* 조별 답지 — 틀린 칸만 강조 */
  .sheet-team{font-weight:800;margin:18px 0 6px;font-size:15px}
  .msheet{display:flex;flex-wrap:wrap;gap:4px}
  .mark{display:flex;flex-direction:column;align-items:center;gap:1px}
  .mn{font-size:9px;color:var(--muted);line-height:1}
  .mcell{width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-size:16px;border-radius:7px}
  .mcell.ok{background:#F6F2EC;color:#C9BCA9;border:1px solid #EEE6DA}            /* 맞음: 아주 연하게 */
  .mcell.no{background:var(--no-bg);color:var(--no-fg);border:2px solid var(--no-line);font-weight:800}  /* 틀림: 빨강 강조 */
  .mcorr{font-size:9px;color:var(--ok-fg);line-height:1;font-weight:800}          /* 정답 글자 작게 */
  .empty{text-align:center;color:var(--muted);padding:24px 0;font-size:14px}
  a.big-link{display:block;text-align:center;background:#fff;border:1.5px solid var(--brand);color:var(--brand);text-decoration:none;font-weight:800;padding:18px;border-radius:16px;margin-bottom:12px;font-size:18px}
  @media(max-width:420px){.mcell{width:27px;height:27px;font-size:14px}}
`;

let TEAM_OPTIONS = '<option value="">조를 선택하세요</option>';
for (let k = 1; k <= TEAM_COUNT; k++) TEAM_OPTIONS += '<option value="' + k + '조">' + k + '조</option>';

const HOME_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>받아쓰기</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>✏️ 받아쓰기</h1><p>주소가 분리된 실시간 채점</p></header>
<a class="big-link" href="/play">참가자 화면 (빈칸 채우기) →</a>
<a class="big-link" href="/host">진행자 화면 (출제·결과) →</a>
<p class="hint">참가자에게는 <b>/play</b> 주소를, 진행자만 <b>/host</b> 주소를 사용하세요.</p>
</div></body></html>`;

// 참가자 페이지 — 클라이언트 스크립트엔 백틱/${} 금지
const PLAY_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>참가자 · 받아쓰기</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>✏️ 받아쓰기</h1><p>번호를 보고 칸을 채우세요</p></header>
<div id="banner"></div>
<div class="card"><div class="label">우리 조</div><select id="team">${TEAM_OPTIONS}</select></div>
<div id="answer" class="card" style="display:none">
  <div class="label">빈칸 채우기</div>
  <div id="gridwrap">
    <div id="gridscaler"><div id="grid" class="grid"></div></div>
    <button class="btn-main" id="submit" style="margin-top:16px">제출하기</button>
    <p class="hint">칸을 눌러 한 글자씩 입력하고, <b>스페이스를 누르면 다음 칸</b>으로 넘어가요. 특정 칸을 직접 눌러 고칠 수도 있어요(빈 칸에서 ←백스페이스는 이전 칸으로). 모르는 칸은 비워도 됩니다.</p>
  </div>
  <div id="wait" style="display:none"><p class="hint">진행자가 게임을 시작하면 빈칸이 나타나요.</p></div>
</div>
<div id="done" class="card" style="display:none"><div class="done">
  <div class="big">✅</div><div class="who" id="dwho"></div><div>제출 완료!</div>
  <button class="btn-ghost" id="redo">답 고치기</button></div></div>
<p class="hint" style="text-align:center;opacity:.45;margin-top:18px">레이아웃 v5</p>
</div>
<script>
  var curRound=null, doneRound=null, renderedRound=null, revealedShown=false;
  var curRows=[], curWordEnds=[], curRevealed=false, gridInputs=[];
  function $(id){return document.getElementById(id);}
  function setBanner(txt,cls){ $('banner').innerHTML='<div class="banner '+(cls||'info')+'">'+txt+'</div>'; }

  // 줄 배치(rows)대로 칸 생성 + 칸마다 번호. revealed면 단어 끝에 틈.
  function renderGrid(rows, wordEndsArr, revealed){
    var box=$('grid'); box.innerHTML=''; gridInputs=[];
    var we={}; (wordEndsArr||[]).forEach(function(n){we[n]=true;});
    var num=0;
    rows.forEach(function(rowLen){
      var row=document.createElement('div'); row.className='row';
      for(var k=0;k<rowLen;k++){
        num++;
        var isLast=(k===rowLen-1);   // 줄 끝 칸은 틈 불필요(줄바꿈이 구분)
        var wrap=document.createElement('div'); wrap.className='gcellwrap'+((we[num]&&!isLast)?' wordend':'');
        var lab=document.createElement('div'); lab.className='gnum'; lab.textContent=num;
        var inp=document.createElement('input'); inp.type='text'; inp.maxLength=1; inp.className='gcell';
        inp.addEventListener('focus', function(){ var el=this; setTimeout(function(){el.select();},0); });
        // 스페이스 → 다음 칸 이동 (공백은 칸에 입력되지 않음). 한글 조합과 충돌 없음.
        inp.addEventListener('beforeinput', function(e){ if(e.data===' '){ e.preventDefault(); nextCell(this); } });
        inp.addEventListener('input', function(){ if(this.value===' '){ this.value=''; nextCell(this); } });  // 혹시 공백이 들어오면 제거 후 이동
        inp.addEventListener('keydown', function(e){                                                          // 빈 칸 백스페이스 → 이전 칸
          if(e.key==='Backspace' && this.value===''){ var p=gridInputs.indexOf(this); if(p>0){ e.preventDefault(); gridInputs[p-1].focus(); } }
        });
        wrap.appendChild(lab); wrap.appendChild(inp);
        row.appendChild(wrap); gridInputs.push(inp);
      }
      box.appendChild(row);
    });
    if(revealed) box.classList.add('revealed'); else box.classList.remove('revealed');
    fitSoon();
  }
  // 공개로 바뀔 때: 입력값 보존하며 틈만 추가
  function applyReveal(){
    var saved=gridInputs.map(function(i){return i.value;});
    renderGrid(curRows, curWordEnds, true);
    gridInputs.forEach(function(inp,idx){ inp.value=saved[idx]||''; });
    revealedShown=true; fitSoon();
  }
  function clearGrid(){ $('grid').innerHTML=''; gridInputs=[]; }

  // 다음 칸으로 이동 (이미 이동했으면 중복 방지)
  function nextCell(el){
    if(document.activeElement!==el) return;
    var i=gridInputs.indexOf(el);
    if(i>=0 && i<gridInputs.length-1){ gridInputs[i+1].focus(); } else { el.blur(); }
  }

  // 한 줄(10·12·11·11·9·4)을 안 깨지게 두고, 화면 폭에 맞춰 전체 크기를 자동 축소
  function fitGrid(){
    var grid=$('grid'), scaler=$('gridscaler');
    if(!grid||!scaler) return;
    grid.style.transform='none';                       // 원래 크기로 되돌려 측정
    var natW=grid.offsetWidth, natH=grid.offsetHeight;
    if(!natW){ scaler.style.height=''; return; }
    var avail=scaler.clientWidth;
    var s=Math.min(1, avail/natW);                      // 넘치면 줄이고, 남으면 1(확대 안 함)
    grid.style.transform='scale('+s+')';
    grid.style.marginLeft=Math.max(0,(avail-natW*s)/2)+'px';  // 가운데 정렬
    scaler.style.height=(natH*s)+'px';                  // 축소된 높이만큼만 자리 차지
  }
  function fitSoon(){
    if(window.requestAnimationFrame){ requestAnimationFrame(fitGrid); } else { setTimeout(fitGrid,0); }
    setTimeout(fitGrid,250);   // 폰트/레이아웃이 늦게 잡힐 때 한 번 더
  }
  window.addEventListener('load', fitGrid);
  window.addEventListener('resize', fitGrid);
  window.addEventListener('orientationchange', function(){ setTimeout(fitGrid,200); });

  function refreshView(){
    var team=$('team').value;
    if(!team){ $('answer').style.display='none'; $('done').style.display='none'; setBanner('먼저 우리 조를 선택하세요'); return; }
    if(curRound!==null && doneRound===curRound){ $('answer').style.display='none'; $('done').style.display='block'; setBanner('제출 완료','ok'); return; }
    $('done').style.display='none'; $('answer').style.display='block';
    if(!curRound){ $('gridwrap').style.display='none'; $('wait').style.display='block'; renderedRound=null; clearGrid(); setBanner('진행자가 게임을 시작하면 빈칸이 나타나요'); return; }
    $('wait').style.display='none'; $('gridwrap').style.display='block';
    if(renderedRound!==curRound){ renderGrid(curRows, curRevealed?curWordEnds:[], curRevealed); renderedRound=curRound; revealedShown=curRevealed; }
    else if(curRevealed && !revealedShown){ applyReveal(); }
    setBanner(curRevealed ? '띄어쓰기 공개됨 — 빈칸을 채워 제출하세요' : '빈칸을 채워 제출하세요');
  }

  function pollRound(){
    fetch('/api/round').then(function(r){return r.json();}).then(function(d){
      if(d.active){ curRound=d.roundId; curRows=d.rows||[]; curRevealed=!!d.revealed; curWordEnds=d.wordEnds||[]; }
      else { curRound=null; curRows=[]; curRevealed=false; curWordEnds=[]; }
      refreshView();
    }).catch(function(){});
  }
  $('team').addEventListener('change', refreshView);

  $('submit').onclick=function(){
    var team=$('team').value;
    if(!team){ alert('조를 선택하세요.'); return; }
    if(!gridInputs.length){ alert('아직 빈칸이 없어요.'); return; }
    var cells=gridInputs.map(function(i){return (i.value||'').replace(/\s/g,'');});  // 공백 제거
    if(!cells.join('')){ alert('답을 입력하세요.'); return; }
    fetch('/api/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({roundId:curRound,team:team,cells:cells})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){ alert(res.j.error||'제출 실패'); return; }
      doneRound=curRound; $('dwho').textContent=team; refreshView();
    }).catch(function(){ alert('네트워크 오류로 제출하지 못했어요.'); });
  };
  $('redo').onclick=function(){ doneRound=null; refreshView(); };  // 칸 값 유지 → 고치기

  pollRound(); setInterval(pollRound,3000);
</script></body></html>`;

const HOST_PAGE =
`<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>진행자 · 받아쓰기</title><style>${CSS}</style></head><body><div class="wrap">
<header><h1>🎛️ 진행자 화면</h1><p>번호별 정답 · 순위 · 조별 답지</p></header>
<div id="gate" class="card"><div class="label">진행자 암호</div>
  <input type="text" id="code" placeholder="암호 입력">
  <button class="btn-main" id="enter" style="margin-top:14px">입장</button>
  <p class="hint">암호는 서버에서 확인합니다. 참가자에게 알려주지 마세요.</p></div>
<div id="main" style="display:none">
  <div class="card">
    <button class="btn-main" id="start">게임 시작 (참가자에게 빈칸 띄우기)</button>
    <button class="btn-ghost" id="reveal" style="width:100%;margin-top:10px" disabled>띄어쓰기 공개 (게임 시작 후)</button>
    <p class="hint">'게임 시작'을 누르면 참가자가 빈칸을 받고 이전 제출은 초기화돼요. 원할 때 '띄어쓰기 공개'를 누르면 모든 참가자 화면에 단어 틈이 생겨요.</p>
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
    <div class="label">조별 답지 (틀린 칸 빨강 · 아래 작은 글자=정답)</div>
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
      renderRef(d.numbered);
    }).catch(function(){ alert('서버에 연결하지 못했어요.'); });
  };

  $('start').onclick=function(){
    fetch('/api/round',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:hostCode})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){ alert(res.j.error||'시작 실패'); return; }
      $('board').style.display='block'; $('sheets').style.display='block'; $('rno').textContent=res.j.no;
      var rv=$('reveal'); rv.disabled=false; rv.textContent='띄어쓰기 공개';   // 시작 후 활성화
      poll(); if(timer) clearInterval(timer); timer=setInterval(poll,2500);
    }).catch(function(){ alert('네트워크 오류'); });
  };
  $('reveal').onclick=function(){
    fetch('/api/reveal',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:hostCode})})
    .then(function(r){return r.json().then(function(j){return {ok:r.ok,j:j};});})
    .then(function(res){
      if(!res.ok){ alert(res.j.error||'공개 실패'); return; }
      var rv=$('reveal'); rv.disabled=true; rv.textContent='✓ 띄어쓰기 공개됨';
    }).catch(function(){ alert('네트워크 오류'); });
  };
  $('refresh').onclick=poll;

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
      var body=$('body'); body.innerHTML=''; $('empty').style.display=d.results.length?'none':'block';
      d.results.forEach(function(t){
        var tr=document.createElement('tr'); tr.className=(t.rank===1?'top':'');
        tr.innerHTML='<td class="rk">'+(MEDAL[t.rank]||t.rank)+'</td><td class="team"></td>'+
          '<td class="num right">'+t.matched+'</td><td class="num wrong">'+t.wrong+'</td>'+
          '<td class="num">'+(t.total?Math.round(t.matched/t.total*100):0)+'%</td>';
        tr.children[1].textContent=t.team;
        body.appendChild(tr);
      });
      renderSheets(d.results);
    }).catch(function(){});
  }

  // 조별 답지: 칸 위치별 비교, 틀린 칸만 빨강 + 정답 글자 작게
  function renderSheets(results){
    var sb=$('sheets-body'); sb.innerHTML='';
    if(!results.length){ sb.innerHTML='<div class="empty">제출이 들어오면 여기에 표시돼요.</div>'; return; }
    results.forEach(function(t){
      var head=document.createElement('div'); head.className='sheet-team';
      head.textContent=(MEDAL[t.rank]||('#'+t.rank))+' '+t.team+'  ·  '+t.matched+'/'+t.total+' 맞음 · '+t.wrong+' 틀림';
      sb.appendChild(head);
      var grid=document.createElement('div'); grid.className='msheet';
      t.marks.forEach(function(m){
        var w=document.createElement('div'); w.className='mark';
        var mn=document.createElement('div'); mn.className='mn'; mn.textContent=m.n;
        var cell=document.createElement('div'); cell.className='mcell '+(m.ok?'ok':'no'); cell.textContent=m.put||'';
        w.appendChild(mn); w.appendChild(cell);
        if(!m.ok){ var c=document.createElement('div'); c.className='mcorr'; c.textContent=m.ans; w.appendChild(c); }
        grid.appendChild(w);
      });
      sb.appendChild(grid);
    });
  }
</script></body></html>`;

// ===== 라우트 =====
app.get('/', function (req, res) { res.type('html').send(HOME_PAGE); });
app.get('/play', function (req, res) { res.type('html').send(PLAY_PAGE); });
app.get('/host', function (req, res) { res.type('html').send(HOST_PAGE); });

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () { console.log('받아쓰기 채점 서버 실행 중: 포트 ' + PORT); });
