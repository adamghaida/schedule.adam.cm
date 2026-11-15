(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const DATA = window.CMUQ_SCHEDULE;
if (!DATA){ document.body.insertAdjacentHTML('afterbegin', '<p style="padding:16px">Could not load data.js. Make sure it sits next to index.html.</p>'); return; }
const SEMS = Object.keys(DATA);
const DAYS = 'UMTWRFS';
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const NCOLORS = 8, MAX_PLANS = 6;
const STORE_KEY = 'cmuq-planner-v1';
const fmt = n => /^\d{5}$/.test(n) ? n.slice(0,2) + '-' + n.slice(2) : n;
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

/* ---------- time + text helpers ---------- */
const t12 = m => (((Math.floor(m/60) + 11) % 12) + 1) + ':' + String(m % 60).padStart(2,'0');
const ap = m => m < 720 ? 'am' : 'pm';
const range = (s, e) => ap(s) === ap(e) ? `${t12(s)}–${t12(e)}${ap(e)}` : `${t12(s)}${ap(s)}–${t12(e)}${ap(e)}`;
const secTimes = s => s.m.length ? s.m.map(m => (m.k ? 'Lec ' : '') + m.d + ' ' + range(m.s, m.e)).join(' + ') : 'No set time';
function courseTimes(c){
  const seen = [];
  for (const s of c.s){ const t = (s.mini ? `Mini ${s.mini}: ` : '') + secTimes(s); if (!seen.includes(t)) seen.push(t); }
  if (seen.length <= 2) return seen.join('  or  ');
  return seen.slice(0,2).join('  or  ') + `  +${seen.length - 2} more`;
}

/* ---------- prerequisites ---------- */
function parsePre(str){
  const toks = str.match(/\(|\)|[A-Za-z0-9]+/g) || []; let p = 0;
  const isW = w => toks[p] && toks[p].toLowerCase() === w;
  const uniq = kids => { const seen = new Set(); return kids.filter(k => { const key = JSON.stringify(k); if (seen.has(key)) return false; seen.add(key); return true; }); };
  function expr(){ let kids = [term()]; while (isW('or')){ p++; kids.push(term()); } kids = uniq(kids); return kids.length > 1 ? {op:'or', kids} : kids[0]; }
  function term(){ let kids = [factor()]; while (isW('and')){ p++; kids.push(factor()); } kids = uniq(kids); return kids.length > 1 ? {op:'and', kids} : kids[0]; }
  function factor(){ const t = toks[p++]; if (t === '('){ const e = expr(); if (toks[p] === ')') p++; return e; } return {c: t || ''}; }
  try { return expr(); } catch (e) { return null; }
}
const evalPre = (a, have) => !a ? true : a.c !== undefined ? have.has(a.c) : a.op === 'and' ? a.kids.every(k => evalPre(k, have)) : a.kids.some(k => evalPre(k, have));
const hasOr = a => a && a.c === undefined && (a.op === 'or' || a.kids.some(hasOr));
const leaves = (a, out = []) => { if (a.c !== undefined) out.push(a.c); else a.kids.forEach(k => leaves(k, out)); return out; };
function preHtml(a, have, checking, top = true){
  if (a.c !== undefined) return `<span class="pc ${checking ? (have.has(a.c) ? 'has' : 'lacks') : ''}">${esc(fmt(a.c))}</span>`;
  const inner = a.kids.map(k => preHtml(k, have, checking, false)).join(` <i>${a.op}</i> `);
  return top ? inner : `(${inner})`;
}

/* ---------- catalog prep ---------- */
function prep(sem){
  const cat = DATA[sem];
  if (cat.byNum) return cat;
  cat.byNum = new Map();
  for (const c of cat.courses){
    c.units = /^\d+(\.\d+)?$/.test(c.u) ? +c.u : null;
    for (const s of c.s){
      s.half = s.mini ? (s.mini % 2 ? 1 : 2) : 3;
      s.slots = [];
      for (const m of s.m) for (const ch of m.d){ const d = DAYS.indexOf(ch); if (d >= 0 && !s.slots.some(x => x.day === d && x.s === m.s && x.e === m.e)) s.slots.push({day:d, s:m.s, e:m.e}); }
      s.timed = s.slots.length > 0;
    }
    c.timed = c.s.some(s => s.timed);
    c.search = (c.n + ' ' + fmt(c.n) + ' ' + c.t + ' ' + c.d).toLowerCase();
    c.preAst = c.pre ? parsePre(c.pre) : null;
    c.coList = c.co ? (c.co.match(/\d{5}/g) || []).filter((v, i, a) => a.indexOf(v) === i) : [];
    cat.byNum.set(c.n, c);
  }
  cat.depts = [...new Set(cat.courses.map(c => c.d))].sort();
  return cat;
}

/* ---------- conflict engine ---------- */
function clash(a, b){
  if (!(a.half & b.half)) return false;
  for (const x of a.slots) for (const y of b.slots) if (x.day === y.day && x.s < y.e && y.s < x.e) return true;
  return false;
}
// entries: [{course, pin}] ; fixed: pseudo-sections that cannot move. Returns chosen sections (same order) or null.
function solve(entries, fixed){
  const opts = entries.map(en => { if (en.pin){ const p = en.course.s.find(s => s.id === en.pin); if (p) return [p]; } return en.course.s; });
  const order = entries.map((_, i) => i).sort((a, b) => opts[a].length - opts[b].length);
  const pick = new Array(entries.length);
  const ok = (sec, upto) => { for (const f of fixed) if (clash(sec, f)) return false; for (let k = 0; k < upto; k++) if (clash(sec, pick[order[k]])) return false; return true; };
  const rec = k => { if (k === order.length) return true; const i = order[k]; for (const s of opts[i]) if (ok(s, k)){ pick[i] = s; if (rec(k + 1)) return true; } return false; };
  return rec(0) ? pick : null;
}
const blockSec = b => ({half:3, slots:[...b.d].map(ch => ({day:DAYS.indexOf(ch), s:b.s, e:b.e})).filter(x => x.day >= 0)});

/* ---------- state ---------- */
const blankPlan = name => ({name, items:[], blocks:[]});
function blankState(){
  const s = {v:1, updatedAt:0, sem:SEMS[0], taken:[], canTakeOnly:false, plans:{}};
  for (const k of SEMS) s.plans[k] = {active:0, list:[blankPlan('Plan A')]};
  return s;
}
function normalize(raw){
  const s = blankState();
  if (!raw || typeof raw !== 'object') return s;
  if (SEMS.includes(raw.sem)) s.sem = raw.sem;
  s.updatedAt = Number(raw.updatedAt) || 0;
  s.canTakeOnly = !!raw.canTakeOnly;
  if (Array.isArray(raw.taken)) s.taken = [...new Set(raw.taken.filter(n => typeof n === 'string' && /^\d{5}$/.test(n)))].slice(0, 400);
  for (const k of SEMS){
    const p = raw.plans && raw.plans[k];
    if (!p || !Array.isArray(p.list) || !p.list.length) continue;
    const list = p.list.slice(0, MAX_PLANS).map((pl, i) => {
      const out = blankPlan(typeof pl.name === 'string' && pl.name ? pl.name.slice(0, 20) : 'Plan ' + 'ABCDEF'[i]);
      const seen = new Set();
      for (const it of Array.isArray(pl.items) ? pl.items.slice(0, 40) : []){
        if (!it || typeof it.n !== 'string' || !/^\d{5}$/.test(it.n) || seen.has(it.n)) continue;
        seen.add(it.n);
        out.items.push({n:it.n, sec:typeof it.sec === 'string' ? it.sec.slice(0, 8) : '', on:it.on !== false, c:(Number(it.c) | 0) % NCOLORS});
      }
      for (const b of Array.isArray(pl.blocks) ? pl.blocks.slice(0, 20) : []){
        if (!b || typeof b.d !== 'string') continue;
        const d = [...b.d].filter(ch => DAYS.includes(ch)).join(''), bs = Number(b.s) | 0, be = Number(b.e) | 0;
        if (!d || !(be > bs) || bs < 0 || be > 1440) continue;
        out.blocks.push({id:String(b.id || Math.random().toString(36).slice(2, 8)).slice(0, 12), name:String(b.name || 'Busy').slice(0, 30), d, s:bs, e:be});
      }
      return out;
    });
    s.plans[k] = {active:Math.min(Math.max(Number(p.active) | 0, 0), list.length - 1), list};
  }
  return s;
}
let localOk = true;
function loadLocal(){ try { const t = localStorage.getItem(STORE_KEY); return t ? normalize(JSON.parse(t)) : blankState(); } catch (e) { localOk = false; return blankState(); } }
function saveLocal(){ try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); localOk = true; } catch (e) { localOk = false; } }
const hasContent = s => s.taken.length > 0 || SEMS.some(k => s.plans[k].list.length > 1 || s.plans[k].list.some(p => p.items.length || p.blocks.length));

let state = loadLocal();
const ui = {tab:'fits', q:'', dept:'', tba:false, open:new Set(), preview:null, takenOpen:false};
let cat, plan, R, info, takenSet, checking;
let prevFit = null, prevOn = null, prevVisible = null, deltaTimer = 0;

function setSaveNote(){
  $('#saveNote').textContent = localOk ? 'Your plans are saved in this browser only. Nothing is sent anywhere.' : 'This browser is not letting the page save, so plans last until you close it.';
}

/* ---------- derived plan ---------- */
const curPlan = () => { const p = state.plans[state.sem]; return p.list[p.active] || p.list[0]; };
function resolvePlan(){
  const on = [], maybe = [];
  for (const it of plan.items){ const course = cat.byNum.get(it.n); if (!course) continue; (it.on ? on : maybe).push({item:it, course, pin:it.sec, clashWith:[]}); }
  const blocks = plan.blocks.map(b => ({b, sec:blockSec(b), clashWith:[]}));
  const fixed = blocks.map(x => x.sec);
  let pick = solve(on, fixed);
  const feasible = !!pick;
  if (!pick){
    pick = [];
    on.forEach((en, i) => {
      const pinned = en.pin && en.course.s.find(s => s.id === en.pin);
      let best = null, bc = Infinity;
      for (const s of pinned ? [pinned] : en.course.s){
        let n = 0; for (const f of fixed) if (clash(s, f)) n++; for (let k = 0; k < i; k++) if (clash(s, pick[k])) n++;
        if (n < bc){ bc = n; best = s; }
      }
      pick[i] = best;
    });
  }
  on.forEach((en, i) => { en.sec = pick[i]; });
  for (let i = 0; i < on.length; i++){
    for (let j = i + 1; j < on.length; j++) if (clash(on[i].sec, on[j].sec)){ on[i].clashWith.push(fmt(on[j].course.n)); on[j].clashWith.push(fmt(on[i].course.n)); }
    for (const bl of blocks) if (clash(on[i].sec, bl.sec)){ on[i].clashWith.push(bl.b.name); bl.clashWith.push(fmt(on[i].course.n)); }
  }
  return {on, maybe, blocks, fixed, feasible, entries:on.map(en => ({course:en.course, pin:en.pin})), empty:!on.length && !blocks.length};
}
// who a given section collides with, using the sections currently on the week
function clashNames(sec){
  const out = [];
  for (const en of R.on) if (clash(sec, en.sec)) out.push(fmt(en.course.n));
  for (const bl of R.blocks) if (clash(sec, bl.sec)) out.push(bl.b.name);
  return out;
}
function fitInfo(course, pin){
  const secs = pin && course.s.some(s => s.id === pin) ? course.s.filter(s => s.id === pin) : course.s;
  const fitSecs = [];
  for (const s of secs){
    const ok = R.feasible ? !!solve([...R.entries, {course, pin:s.id}], R.fixed) : clashNames(s).length === 0;
    if (ok) fitSecs.push(s.id);
  }
  let clashWith = [];
  if (!fitSecs.length){
    let best = null;
    for (const s of secs){ const names = clashNames(s); if (!best || names.length < best.length) best = names; }
    clashWith = best || [];
  }
  return {fitSecs, clashWith, nSecs:secs.length};
}
function computeInfo(){
  info = new Map();
  const onSet = new Set(R.on.map(e => e.course.n));
  const itemBy = new Map(plan.items.map(it => [it.n, it]));
  for (const c of cat.courses){
    const it = itemBy.get(c.n);
    const inf = {status:'fit', fitSecs:[], clashWith:[], nSecs:c.s.length};
    if (it && it.on) inf.status = 'on';
    else {
      Object.assign(inf, fitInfo(c, it ? it.sec : ''));
      inf.fits = inf.fitSecs.length > 0;
      inf.status = it ? 'maybe' : inf.fits ? 'fit' : 'clash';
    }
    inf.taken = takenSet.has(c.n);
    inf.preOk = evalPre(c.preAst, takenSet);
    inf.coOk = !c.coList.length || c.coList.some(n => takenSet.has(n) || onSet.has(n));
    inf.canTake = !inf.taken && inf.preOk;
    if (c.preAst && !inf.preOk){
      const miss = hasOr(c.preAst) ? null : leaves(c.preAst).filter(n => !takenSet.has(n));
      inf.preNote = miss && miss.length <= 3 ? 'Needs ' + miss.map(fmt).join(', ') : 'Missing prerequisites';
    }
    info.set(c.n, inf);
  }
  // maybes: which ones cannot share a schedule with each other
  const fitM = R.maybe.filter(en => info.get(en.course.n).fits);
  for (const en of R.maybe){ en.inf = info.get(en.course.n); en.cantPair = []; }
  if (R.feasible) for (let i = 0; i < fitM.length; i++) for (let j = i + 1; j < fitM.length; j++){
    if (!solve([...R.entries, {course:fitM[i].course, pin:fitM[i].pin}, {course:fitM[j].course, pin:fitM[j].pin}], R.fixed)){
      fitM[i].cantPair.push(fmt(fitM[j].course.n)); fitM[j].cantPair.push(fmt(fitM[i].course.n));
    }
  }
  for (const en of R.maybe){
    const want = en.inf.fitSecs[0] || en.pin;
    en.sec = en.course.s.find(s => s.id === want) || en.course.s[0];
  }
  R.fitMaybes = fitM;
}
function combos(){
  const list = R.fitMaybes.slice(0, 10), n = list.length;
  if (n < 2 || !R.feasible) return [];
  const pop = m => { let c = 0; while (m){ c += m & 1; m >>= 1; } return c; };
  const masks = []; for (let m = 1; m < (1 << n); m++) masks.push(m);
  masks.sort((a, b) => pop(b) - pop(a));
  const keep = [];
  for (const m of masks){
    if (keep.some(k => (k & m) === m)) continue;
    const ents = []; for (let i = 0; i < n; i++) if (m >> i & 1) ents.push({course:list[i].course, pin:list[i].pin});
    if (solve([...R.entries, ...ents], R.fixed)) keep.push(m);
  }
  return keep.map(m => list.filter((_, i) => m >> i & 1));
}
function unitsText(ents){
  let sum = 0, vari = false;
  for (const en of ents){ if (en.course.units == null) vari = true; else sum += en.course.units; }
  return (Number.isInteger(sum) ? sum : sum.toFixed(1)) + (vari ? '+' : '') + ' units';
}

/* ---------- rendering ---------- */
function render(opts = {}){
  cat = prep(state.sem); plan = curPlan();
  takenSet = new Set(state.taken); checking = takenSet.size > 0;
  R = resolvePlan(); computeInfo();
  renderTop(); renderSide(); renderWeek(); renderCatalog(opts);
}
function renderTop(){
  $('#semSeg').innerHTML = SEMS.map(k => `<button type="button" data-sem="${k}" aria-pressed="${k === state.sem}">${esc(DATA[k].label)}</button>`).join('');
  const d = $('#dept');
  d.innerHTML = `<option value="">All departments</option>` + cat.depts.map(x => `<option value="${esc(x)}" ${x === ui.dept ? 'selected' : ''}>${esc(x)}</option>`).join('');
  if (ui.dept && !cat.depts.includes(ui.dept)) ui.dept = '';
  $('#srcNote').textContent = `Unofficial planner. Times, sections, units and prerequisites come from CMU's public Schedule of Classes for ${DATA[state.sem].label} (their last update: ${DATA[state.sem].updated}). Seats, reservations and instructor permission are not checked, so confirm in SIO before you register.`;
}
function pickHtml(en, kind){
  const c = en.course, it = en.item, sec = en.sec;
  let ctl = '';
  if (c.s.length > 1){
    ctl = `<label class="secsel"><span class="vh">Section for ${fmt(c.n)}</span><select class="field" id="sec-${c.n}" data-act="sec" data-n="${c.n}">`
      + `<option value="">Any section${!it.sec && sec ? ` (using ${esc(sec.id)} for now)` : ''}</option>`
      + c.s.map(s => `<option value="${esc(s.id)}" ${it.sec === s.id ? 'selected' : ''}>Section ${esc(s.id)} · ${esc(secTimes(s))}</option>`).join('') + `</select></label>`;
  }
  const pills = [];
  if (kind === 'on'){
    if (en.clashWith.length) pills.push(`<span class="pill bad">Clashes with ${en.clashWith.map(esc).join(', ')}</span>`);
  } else {
    if (!sec.timed) pills.push(`<span class="pill">No set time</span>`);
    else if (en.inf.fits) pills.push(`<span class="pill ok">Fits your schedule</span>`);
    else pills.push(`<span class="pill bad">${en.inf.clashWith.length ? 'Clashes with ' + en.inf.clashWith.map(esc).join(', ') : 'No section fits'}</span>`);
    if (en.cantPair.length) pills.push(`<span class="pill warn">Not together with ${en.cantPair.map(esc).join(', ')}</span>`);
  }
  const inf = info.get(c.n);
  if (checking && c.preAst && !inf.preOk) pills.push(`<span class="pill warn">${esc(inf.preNote)}</span>`);
  if (checking && !inf.coOk) pills.push(`<span class="pill warn">Take with ${c.coList.map(fmt).join(' or ')}</span>`);
  return `<li class="pick ${kind}" style="--c:var(--c${it.c})" data-n="${c.n}">
    <span class="sw" aria-hidden="true"></span>
    <div class="pick-body">
      <div class="pick-top"><span class="num">${fmt(c.n)}</span><span class="pick-title" title="${esc(c.t)}">${esc(c.t)}</span></div>
      <div class="times">${sec.mini ? `<span class="mini">Mini ${sec.mini}</span>` : ''}${esc(secTimes(sec))} · ${esc(c.u)} units${c.s.length === 1 ? ` · Sec ${esc(sec.id)}` : ''}</div>
      ${ctl}${pills.length ? `<div class="pills">${pills.join('')}</div>` : ''}
    </div>
    <div class="pick-actions">
      <button class="btn sm quiet" type="button" data-act="${kind === 'on' ? 'demote' : 'promote'}" data-n="${c.n}" title="${kind === 'on' ? 'Move to maybes: keeps it on the week, stops it narrowing the list' : 'Add to your schedule'}">${kind === 'on' ? 'Maybe' : 'Add'}</button>
      <button class="x" type="button" data-act="remove" data-n="${c.n}" aria-label="Remove ${fmt(c.n)}">×</button>
    </div></li>`;
}
function renderSide(){
  const pl = state.plans[state.sem];
  $('#plans').innerHTML = pl.list.map((p, i) => `<button type="button" class="plan" data-act="plan" data-i="${i}" aria-pressed="${i === pl.active}">${esc(p.name)}</button>`).join('')
    + (pl.list.length < MAX_PLANS ? `<button type="button" class="btn sm quiet" data-act="copyplan" title="Copy this plan into a new one to try a different mix">+ Copy as new plan</button>` : '')
    + (pl.list.length > 1 ? `<button type="button" class="btn sm quiet" data-act="delplan">Delete ${esc(plan.name)}</button>` : '');
  $('#vtOn').textContent = R.on.length || '';
  $('#units').textContent = R.on.length ? plural(R.on.length, 'course') + ' · ' + unitsText(R.on) : '';
  let html = '';
  if (!R.on.length && !R.blocks.length) html = `<div class="sideempty">Nothing here yet. Press <strong>Add</strong> on a course you are taking and the list narrows to what still fits around it. Use <strong>Maybe</strong> for courses you are still deciding on.</div>`;
  else {
    html = `<ul class="picks">` + R.on.map(en => pickHtml(en, 'on')).join('')
      + R.blocks.map(bl => `<li class="pick" style="--c:var(--faint)"><span class="sw" aria-hidden="true"></span><div class="pick-body"><div class="pick-top"><span class="pick-title">${esc(bl.b.name)}</span></div><div class="times">${esc(bl.b.d)} ${range(bl.b.s, bl.b.e)} · blocked time</div>${bl.clashWith.length ? `<div class="pills"><span class="pill bad">Clashes with ${bl.clashWith.map(esc).join(', ')}</span></div>` : ''}</div><div class="pick-actions"><button class="x" type="button" data-act="rmblock" data-id="${esc(bl.b.id)}" aria-label="Remove ${esc(bl.b.name)}">×</button></div></li>`).join('') + `</ul>`;
  }
  $('#picksWrap').innerHTML = html;
  const mw = $('#maybeWrap');
  mw.hidden = !R.maybe.length;
  if (R.maybe.length){
    let h = `<h3>Maybes</h3><p class="hint">Shown dashed on the week. They do not shrink the course list until you add them.</p><ul class="picks">` + R.maybe.map(en => pickHtml(en, 'maybe')).join('') + `</ul>`;
    const cs = combos();
    if (cs.length === 1 && cs[0].length === R.fitMaybes.length && R.fitMaybes.length > 1){
      h += `<div class="combo"><div class="combo-c">All ${R.fitMaybes.length} fitting maybes work together <small>${unitsText(cs[0])}</small></div><button class="btn sm" type="button" data-act="usecombo" data-ns="${cs[0].map(e => e.course.n).join(',')}">Add all</button></div>`;
    } else if (cs.length){
      h += `<h3>Maybes that work together</h3>` + cs.slice(0, 6).map(set => `<div class="combo"><div class="combo-c">${set.map(e => `<span class="pc">${fmt(e.course.n)}</span>`).join('')} <small>${unitsText(set)}</small></div><button class="btn sm" type="button" data-act="usecombo" data-ns="${set.map(e => e.course.n).join(',')}">Add ${set.length === 1 ? 'it' : 'these'}</button></div>`).join('');
    }
    mw.innerHTML = h;
  }
  $('#clearBtn').hidden = !plan.items.length && !plan.blocks.length;
  $('#copyBtn').hidden = !R.on.length;
}
function renderWeek(){
  const evs = [];
  const push = (sec, o) => { for (const sl of sec.slots) evs.push(Object.assign({day:sl.day, s:sl.s, e:sl.e, mini:sec.mini || 0}, o)); };
  for (const en of R.on) push(en.sec, {label:fmt(en.course.n), title:en.course.t, c:en.item.c, cls:en.clashWith.length ? 'clash' : ''});
  for (const en of R.maybe) push(en.sec, {label:fmt(en.course.n), title:en.course.t, c:en.item.c, cls:'maybe' + (en.inf.fits || !en.sec.timed ? '' : ' clash')});
  for (const bl of R.blocks) push(bl.sec, {label:bl.b.name, title:'Blocked time', cls:'busy' + (bl.clashWith.length ? ' clash' : '')});
  const pc = ui.preview && cat.byNum.get(ui.preview), pinf = pc && info.get(pc.n);
  if (pc && pinf && pinf.status !== 'on' && pinf.status !== 'maybe'){
    const sec = pc.s.find(s => s.id === pinf.fitSecs[0]) || pc.s.find(s => s.timed) || pc.s[0];
    push(sec, {label:fmt(pc.n), title:pc.t, cls:'preview' + (pinf.fits ? '' : ' clash')});
  }
  const days = [0,1,2,3,4]; if (evs.some(e => e.day === 5)) days.push(5); if (evs.some(e => e.day === 6)) days.push(6);
  let lo = 8 * 60, hi = 18 * 60;
  for (const e of evs){ lo = Math.min(lo, Math.floor(e.s / 60) * 60); hi = Math.max(hi, Math.ceil(e.e / 60) * 60); }
  const pph = 42, H = (hi - lo) / 60 * pph;
  let times = ''; for (let m = lo; m <= hi; m += 60) times += `<span style="top:${(m - lo) / 60 * pph}px">${((Math.floor(m / 60) + 11) % 12) + 1}${ap(m)}</span>`;
  let cols = '';
  for (const d of days){
    const list = evs.filter(e => e.day === d).sort((a, b) => a.s - b.s || b.e - a.e);
    let cur = null; const clusters = [];
    for (const ev of list){
      if (!cur || ev.s >= cur.end){ cur = {end:ev.e, lanes:[], evs:[]}; clusters.push(cur); }
      cur.end = Math.max(cur.end, ev.e);
      let li = cur.lanes.findIndex(end => end <= ev.s);
      if (li < 0){ li = cur.lanes.length; cur.lanes.push(ev.e); } else cur.lanes[li] = ev.e;
      ev.lane = li; cur.evs.push(ev);
    }
    let h = '';
    for (const cl of clusters) for (const ev of cl.evs){
      const n = cl.lanes.length, top = (ev.s - lo) / 60 * pph, ht = Math.max((ev.e - ev.s) / 60 * pph - 2, 14);
      h += `<div class="ev ${ev.cls || ''}" style="${ev.c != null ? `--c:var(--c${ev.c});` : ''}top:${top + 1}px;height:${ht}px;left:${ev.lane / n * 100}%;width:calc(${100 / n}% - 1px)" title="${esc(ev.label + ' ' + ev.title + ' · ' + range(ev.s, ev.e) + (ev.mini ? ' · Mini ' + ev.mini : ''))}"><span>${esc(ev.label)}</span>${ht >= 30 ? `<small>${ev.mini ? 'Mini ' + ev.mini : t12(ev.s) + '–' + t12(ev.e)}</small>` : ''}</div>`;
    }
    cols += `<div class="wk-day">${h}</div>`;
  }
  const untimed = [...R.on, ...R.maybe].filter(en => !en.sec.timed).map(en => fmt(en.course.n));
  $('#week').style.setProperty('--n', days.length); $('#week').style.setProperty('--pph', pph + 'px');
  $('#week').innerHTML = `<div class="wk-head"><span></span>${days.map(d => `<span>${DAY_NAMES[d]}<b>${DAYS[d]}</b></span>`).join('')}</div>
    <div class="wk-body" style="height:${H}px"><div class="wk-times">${times}</div>${cols}</div>`
    + (untimed.length ? `<p class="wk-note">No set time, so not on the grid: ${untimed.join(', ')}</p>` : '')
    + ([...R.on, ...R.maybe].some(en => en.sec.mini) ? `<p class="wk-note">Minis run for half the semester. Two minis in different halves can share a time slot.</p>` : '');
}
function rowHtml(c, cls){
  const inf = info.get(c.n), st = inf.status, pills = [];
  if (st === 'on') pills.push(`<span class="pill acc">In your schedule</span>`);
  else {
    if (st === 'maybe') pills.push(`<span class="pill acc">Maybe</span>`);
    if (!c.timed) pills.push(`<span class="pill">No set time</span>`);
    else if (!R.empty){
      if (inf.fitSecs.length === inf.nSecs) pills.push(`<span class="pill ok">Fits</span>`);
      else if (inf.fitSecs.length) pills.push(`<span class="pill ok">Fits in section${inf.fitSecs.length === 1 ? '' : 's'} ${inf.fitSecs.map(esc).join(', ')}</span>`);
      else pills.push(`<span class="pill bad">${inf.clashWith.length ? 'Clashes with ' + inf.clashWith.map(esc).join(', ') : 'No section fits'}</span>`);
    }
  }
  if (checking){
    if (inf.taken) pills.push(`<span class="pill">Already taken</span>`);
    else if (c.preAst) pills.push(inf.preOk ? `<span class="pill ok">Prereqs met</span>` : `<span class="pill warn">${esc(inf.preNote)}</span>`);
  }
  if (c.perm) pills.push(`<span class="pill">Needs permission</span>`);
  const open = ui.open.has(c.n);
  const acts = st === 'on' ? `<button class="btn sm" type="button" data-act="remove" data-n="${c.n}">Remove</button>`
    : st === 'maybe' ? `<button class="btn sm primary" type="button" data-act="add" data-n="${c.n}">Add</button><button class="btn sm" type="button" data-act="remove" data-n="${c.n}">Remove</button>`
    : `<button class="btn sm ${st === 'clash' ? '' : 'primary'}" type="button" data-act="add" data-n="${c.n}">Add</button><button class="btn sm" type="button" data-act="maybe" data-n="${c.n}">Maybe</button>`;
  return `<li class="row is-${st} ${cls || ''}" data-n="${c.n}">
    <div class="row-main" data-act="toggle" data-n="${c.n}">
      <div class="row-id"><span class="num">${fmt(c.n)}</span><span class="un">${esc(c.u)} units</span></div>
      <div class="row-body">
        <button class="title-btn" type="button" aria-expanded="${open}" data-act="toggle" data-n="${c.n}">${esc(c.t)}</button>
        <div class="times">${esc(courseTimes(c))}</div>
        ${pills.length ? `<div class="pills">${pills.join('')}</div>` : ''}
      </div>
      <div class="row-actions">${acts}</div>
    </div>${open ? detailHtml(c, inf) : ''}</li>`;
}
function detailHtml(c, inf){
  const secs = c.s.map(s => {
    let f = '';
    if (inf.status !== 'on' && s.timed && !R.empty){
      f = inf.fitSecs.includes(s.id) ? `<span class="mark ok">fits</span>` : `<span class="mark bad">${(() => { const n = clashNames(s); return n.length ? 'clashes with ' + n.map(esc).join(', ') : 'does not fit'; })()}</span>`;
    }
    return `<tr><th scope="row">${esc(s.id)}</th><td class="t">${s.mini ? `<span class="mini">Mini ${s.mini}</span>` : ''}${esc(secTimes(s))}${s.mode ? ` <span class="mode">· ${esc(s.mode)}</span>` : ''}</td><td class="f">${f}</td></tr>`;
  }).join('');
  const rowsDl = [];
  if (c.preAst) rowsDl.push(`<dt>Prerequisites</dt><dd class="pre">${preHtml(c.preAst, takenSet, checking)}${checking ? '' : ` <span class="mode">· add the courses you have taken to check these</span>`}</dd>`);
  else rowsDl.push(`<dt>Prerequisites</dt><dd>None listed</dd>`);
  if (c.coList.length) rowsDl.push(`<dt>Corequisites</dt><dd class="pre">${c.coList.map(n => `<span class="pc ${checking ? (takenSet.has(n) || R.on.some(e => e.course.n === n) ? 'has' : 'lacks') : ''}">${fmt(n)}</span>`).join(' <i>or</i> ')} <span class="mode">· take alongside, or already passed</span></dd>`);
  if (c.x && c.x.length) rowsDl.push(`<dt>Same class as</dt><dd>${c.x.map(fmt).join(', ')}</dd>`);
  rowsDl.push(`<dt>Department</dt><dd>${esc(c.d)}</dd>`);
  if (c.perm) rowsDl.push(`<dt>Registration</dt><dd>Special permission required</dd>`);
  return `<div class="detail"><table><tbody>${secs}</tbody></table><dl class="dl">${rowsDl.join('')}</dl>
    <div><a href="https://enr-apps.as.cmu.edu/open/SOC/SOCServlet/courseDetails?COURSE=${c.n}&amp;SEMESTER=${state.sem}" target="_blank" rel="noopener">Description and reservations on the official Schedule of Classes</a></div></div>`;
}
const queryNums = q => [...new Set([...q.matchAll(/(?<!\d)(\d{2})-?(\d{3})(?!\d|-\d)/g)].map(m => m[1] + m[2]))];
function renderCatalog(opts = {}){
  const inPool = c => (ui.tba || c.timed) && (!ui.dept || c.d === ui.dept) && (!(state.canTakeOnly && checking) || info.get(c.n).canTake);
  const pool = cat.courses.filter(inPool);
  const cands = pool.filter(c => info.get(c.n).status !== 'on');
  const fits = cands.filter(c => info.get(c.n).fits), clashes = cands.filter(c => !info.get(c.n).fits);

  // headline
  $('#countBig').textContent = R.empty ? cands.length : fits.length;
  $('#countLabel').textContent = R.empty ? (cands.length === 1 ? 'course to pick from' : 'courses to pick from') : (fits.length === 1 ? 'course still fits' : 'courses still fit');
  $('#countSub').textContent = R.empty ? 'Add a course and this list narrows to what still fits around it.'
    : `of ${cands.length} · ${clashes.length ? plural(clashes.length, 'course') + (clashes.length === 1 ? ' clashes' : ' clash') + ' with your schedule' : 'nothing clashes yet'}`;
  $('#vtFit').textContent = R.empty ? cands.length : fits.length;
  $('#meterFill').style.width = (cands.length ? fits.length / cands.length * 100 : 0) + '%';

  // what changed since the last schedule edit
  const fitSet = new Set(cat.courses.filter(c => { const i = info.get(c.n); return i.status !== 'on' && i.fits && c.timed; }).map(c => c.n));
  const onSet = new Set(R.on.map(e => e.course.n));
  const dEl = $('#delta');
  if (opts.label && prevFit){
    let out = 0, back = 0;
    for (const n of prevFit) if (!fitSet.has(n) && !onSet.has(n)) out++;
    for (const n of fitSet) if (!prevFit.has(n) && !prevOn.has(n)) back++;
    const parts = [];
    if (out) parts.push(`ruled out ${plural(out, 'course')}`);
    if (back) parts.push(`${out ? 'and ' : ''}made room for ${plural(back, 'course')}`);
    dEl.textContent = opts.label + ' ' + (parts.length ? parts.join(' ') : 'did not rule anything out') + '.';
    dEl.className = 'delta' + (out ? '' : ' good'); dEl.hidden = false;
    clearTimeout(deltaTimer); deltaTimer = setTimeout(() => { dEl.hidden = true; }, 9000);
  } else if (!opts.keepDelta) dEl.hidden = true;
  prevFit = fitSet; prevOn = onSet;

  // tabs
  const tabs = [['fits', R.empty ? 'All courses' : 'Still fits', R.empty ? cands.length : fits.length], ['clash', 'Clashes', clashes.length], ['all', 'Everything', pool.length]];
  if (R.empty && ui.tab === 'clash') ui.tab = 'fits';
  $('#tabs').innerHTML = tabs.filter(t => !(R.empty && t[0] !== 'fits')).map(t => `<button type="button" role="tab" id="tab-${t[0]}" aria-selected="${ui.tab === t[0]}" data-tab="${t[0]}">${t[1]} <b>${t[2]}</b></button>`).join('');
  $('#tabs').hidden = R.empty;
  $('#canTakeWrap').hidden = !checking;
  $('#canTake').checked = state.canTakeOnly;

  // list
  const q = ui.q.trim(), nums = queryNums(q), bulk = $('#bulk');
  let list, searching = false, note = '';
  bulk.hidden = true;
  if (nums.length >= 2){
    searching = true;
    list = nums.map(n => cat.byNum.get(n)).filter(Boolean);
    const addable = list.filter(c => !plan.items.some(it => it.n === c.n));
    const missing = nums.filter(n => !cat.byNum.has(n));
    bulk.hidden = false;
    bulk.innerHTML = `<span>${list.length} of ${nums.length} pasted numbers are offered in ${esc(DATA[state.sem].label)}${missing.length ? `. Not offered: ${missing.map(fmt).join(', ')}` : ''}.</span>`
      + (addable.length ? `<span><button class="btn sm primary" type="button" data-act="bulkadd" data-ns="${addable.map(c => c.n).join(',')}">Add ${addable.length === 1 ? 'it' : 'all ' + addable.length}</button> <button class="btn sm" type="button" data-act="bulkmaybe" data-ns="${addable.map(c => c.n).join(',')}">Add as maybes</button></span>` : '');
  } else if (q){
    searching = true;
    const words = q.toLowerCase().split(/\s+/);
    list = cat.courses.filter(c => words.every(w => c.search.includes(w)));
    note = `Search looks through every ${esc(DATA[state.sem].label)} course, including ones that clash.`;
  } else list = ui.tab === 'fits' ? (R.empty ? cands : fits) : ui.tab === 'clash' ? clashes : pool;

  const visible = new Set(list.map(c => c.n));
  let leaving = new Set(), entering = new Set();
  const animating = opts.animate && !searching && ui.tab === 'fits' && prevVisible && !R.empty;
  if (animating){
    for (const n of prevVisible) if (!visible.has(n) && cat.byNum.has(n) && inPool(cat.byNum.get(n)) && !onSet.has(n)) leaving.add(n);
    for (const n of visible) if (!prevVisible.has(n)) entering.add(n);
    if (leaving.size > 60) leaving = new Set();
  }
  const shown = leaving.size ? cat.courses.filter(c => visible.has(c.n) || leaving.has(c.n)) : list;
  let html = '', lastDept = null;
  if (note) html += `<li class="note" style="padding:2px 2px 8px">${note}</li>`;
  for (const c of shown){
    if (!searching && c.d !== lastDept){ lastDept = c.d; html += `<li class="group">${esc(c.d)}</li>`; }
    html += rowHtml(c, leaving.has(c.n) ? 'leaving' : entering.has(c.n) ? 'entering' : '');
  }
  if (!shown.length){
    html = `<li class="empty">${searching ? `No ${esc(DATA[state.sem].label)} course matches “${esc(q)}”.`
      : ui.tab === 'clash' ? 'Nothing clashes with your schedule.'
      : state.canTakeOnly && checking ? 'No course passes the “can take” filter here. Try turning it off.'
      : 'Nothing else fits around this schedule. Remove a course or look at what clashes.'}</li>`;
  }
  const rows = $('#rows');
  rows.innerHTML = html;
  rows.querySelectorAll('.row.leaving').forEach(el => {
    const done = () => { const g = el.previousElementSibling, nx = el.nextElementSibling; el.remove(); if (g && g.classList.contains('group') && (!nx || nx.classList.contains('group'))) g.remove(); };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) done(); else { el.addEventListener('animationend', done, {once:true}); setTimeout(() => { if (el.isConnected) done(); }, 1200); }
  });
  prevVisible = searching ? prevVisible : visible;
}
function renderTaken(){
  const box = $('#takenBox');
  if (ui.takenOpen){
    box.innerHTML = `<label for="takenText" class="note">Paste anything that contains course numbers: an academic audit, a transcript, or a plain list. Include what you are taking now. Only the numbers are kept.</label>
      <textarea class="field" id="takenText" spellcheck="false" placeholder="15-112, 21-120, 76-101 …">${esc(state.taken.map(fmt).join(', '))}</textarea>
      <div class="taken-actions"><button class="btn sm primary" type="button" data-act="takensave">Save list</button>
      <span class="btn sm filebtn">Read from a text file<input type="file" id="takenFile" accept=".txt,.csv,.tsv,.md,.html,.htm,.json,text/*" aria-label="Read course numbers from a text file"></span>
      <button class="btn sm quiet" type="button" data-act="takencancel">Cancel</button>
      ${state.taken.length ? `<button class="btn sm quiet" type="button" data-act="takenclear">Turn off prerequisite check</button>` : ''}</div>`;
  } else if (state.taken.length){
    box.innerHTML = `<div class="taken-row"><p><strong>Prerequisite check is on.</strong> Comparing against ${plural(state.taken.length, 'course')} you have taken.</p><button class="btn sm" type="button" data-act="takenopen">Edit list</button></div>`;
  } else {
    box.innerHTML = `<div class="taken-row"><p><strong>Prerequisites are optional.</strong> Add the courses you have taken and each course shows whether you can register for it.</p><button class="btn sm" type="button" data-act="takenopen">Add courses I have taken</button></div>`;
  }
}
function syncControls(){
  $('#tba').checked = ui.tba; $('#q').value = ui.q;
  renderTaken();
}

/* ---------- actions ---------- */
function commit(label){ state.updatedAt = Date.now(); saveLocal(); render({animate:true, label}); setSaveNote(); }
function nextColor(){ const used = new Set(plan.items.map(i => i.c)); for (let i = 0; i < NCOLORS; i++) if (!used.has(i)) return i; return plan.items.length % NCOLORS; }
function addCourse(n, on){
  if (!cat.byNum.has(n)) return false;
  const it = plan.items.find(i => i.n === n);
  if (it){ if (it.on === on) return false; it.on = on; } else plan.items.push({n, sec:'', on, c:nextColor()});
  return true;
}
let toastTimer = 0;
function toast(msg, undo){
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>` + (undo ? `<button type="button" id="toastUndo">Undo</button>` : '');
  t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, undo ? 8000 : 3500);
  if (undo) $('#toastUndo').addEventListener('click', () => { t.hidden = true; undo(); }, {once:true});
}
const snapshot = () => JSON.stringify(state.plans);
const restore = snap => () => { state.plans = JSON.parse(snap); commit(); };
function scheduleText(){
  const lines = [`CMU-Q ${DATA[state.sem].label}, ${plan.name} (${unitsText(R.on)})`];
  for (const en of R.on) lines.push(`${fmt(en.course.n)} ${en.course.t} | Sec ${en.sec.id} | ${secTimes(en.sec)}${en.sec.mini ? ' | Mini ' + en.sec.mini : ''} | ${en.course.u} units`);
  if (R.maybe.length) lines.push('Maybes: ' + R.maybe.map(en => fmt(en.course.n)).join(', '));
  return lines.join('\n');
}
function act(a, el){
  const n = el.dataset.n, c = n && cat.byNum.get(n);
  switch (a){
    case 'toggle': ui.open.has(n) ? ui.open.delete(n) : ui.open.add(n); renderCatalog({keepDelta:true}); break;
    case 'add': case 'promote': if (addCourse(n, true)) commit(`Adding ${fmt(n)}`); break;
    case 'maybe': if (addCourse(n, false)) commit(); break;
    case 'demote': if (addCourse(n, false)) commit(`Moving ${fmt(n)} to maybes`); break;
    case 'remove': { const it = plan.items.find(i => i.n === n); if (!it) break; const wasOn = it.on; plan.items = plan.items.filter(i => i.n !== n); commit(wasOn ? `Removing ${fmt(n)}` : undefined); break; }
    case 'sec': { const it = plan.items.find(i => i.n === n); if (it){ it.sec = el.value; commit(it.on ? `Changing the ${fmt(n)} section` : undefined); } break; }
    case 'rmblock': { const b = plan.blocks.find(x => x.id === el.dataset.id); plan.blocks = plan.blocks.filter(x => x.id !== el.dataset.id); commit(b ? `Unblocking ${b.name}` : undefined); break; }
    case 'usecombo': case 'bulkadd': { let k = 0; for (const x of el.dataset.ns.split(',')) if (addCourse(x, true)) k++; if (a === 'bulkadd'){ ui.q = ''; $('#q').value = ''; } if (k) commit(`Adding ${plural(k, 'course')}`); break; }
    case 'bulkmaybe': { let k = 0; for (const x of el.dataset.ns.split(',')) if (addCourse(x, false)) k++; ui.q = ''; $('#q').value = ''; if (k) commit(); else render(); break; }
    case 'plan': state.plans[state.sem].active = +el.dataset.i; prevFit = prevOn = prevVisible = null; commit(); break;
    case 'copyplan': { const pl = state.plans[state.sem]; const names = new Set(pl.list.map(p => p.name)); const name = 'Plan ' + ([...'ABCDEF'].find(l => !names.has('Plan ' + l)) || pl.list.length + 1); const cp = JSON.parse(JSON.stringify(plan)); cp.name = name; pl.list.push(cp); pl.active = pl.list.length - 1; commit(); toast(`${name} starts as a copy of ${plan.name}. Change it freely.`); break; }
    case 'delplan': { const snap = snapshot(), pl = state.plans[state.sem], name = plan.name; pl.list.splice(pl.active, 1); pl.active = Math.max(0, pl.active - 1); prevFit = prevOn = prevVisible = null; commit(); toast(`Deleted ${name}`, restore(snap)); break; }
    case 'takenopen': ui.takenOpen = true; renderTaken(); $('#takenText').focus(); break;
    case 'takencancel': ui.takenOpen = false; renderTaken(); break;
    case 'takenclear': state.taken = []; state.canTakeOnly = false; ui.takenOpen = false; renderTaken(); commit(); break;
    case 'takensave': { const found = queryNums($('#takenText').value); state.taken = found.slice(0, 400); if (!found.length) state.canTakeOnly = false; ui.takenOpen = false; renderTaken(); commit(); toast(found.length ? `Saved ${plural(found.length, 'course')}. Prerequisite check is on.` : 'No course numbers found, so the check stays off.'); break; }
  }
}

/* ---------- wiring ---------- */
document.addEventListener('click', e => {
  const sem = e.target.closest('[data-sem]');
  if (sem){ if (sem.dataset.sem !== state.sem){ state.sem = sem.dataset.sem; ui.open.clear(); ui.preview = null; prevFit = prevOn = prevVisible = null; commit(); } return; }
  const vw = e.target.closest('#viewTabs button[data-view]');
  if (vw){ $('#cols').dataset.view = vw.dataset.view; document.querySelectorAll('#viewTabs button').forEach(b => b.setAttribute('aria-pressed', b === vw)); window.scrollTo(0, 0); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab){ ui.tab = tab.dataset.tab; renderCatalog({keepDelta:true}); return; }
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'SELECT') return;
  if (el.dataset.act === 'toggle' && e.target.closest('.row-actions')) return;
  act(el.dataset.act, el);
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.matches('select[data-act="sec"]')) act('sec', t);
  else if (t.id === 'dept'){ ui.dept = t.value; renderCatalog(); }
  else if (t.id === 'tba'){ ui.tba = t.checked; renderCatalog(); }
  else if (t.id === 'canTake'){ state.canTakeOnly = t.checked; state.updatedAt = Date.now(); saveLocal(); renderCatalog(); }
  else if (t.id === 'takenFile' && t.files && t.files[0]){
    const f = t.files[0];
    if (f.size > 4e6){ toast('That file is too large to read here. Paste the text instead.'); return; }
    const rd = new FileReader();
    rd.onload = () => { const ta = $('#takenText'); if (!ta) return; const nums = queryNums(String(rd.result)); ta.value = [...new Set([...queryNums(ta.value), ...nums])].map(fmt).join(', '); toast(nums.length ? `Found ${plural(nums.length, 'course number')} in ${f.name}. Review, then save.` : `No course numbers found in ${f.name}.`); };
    rd.onerror = () => toast('Could not read that file. Paste the text instead.');
    rd.readAsText(f);
  }
});
$('#q').addEventListener('input', e => { ui.q = e.target.value; renderCatalog(); });
$('#q').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const q = ui.q.trim(), nums = queryNums(q);
  if (!q || nums.length >= 2) return;
  const words = q.toLowerCase().split(/\s+/);
  const hits = cat.courses.filter(c => words.every(w => c.search.includes(w)));
  const hit = nums.length === 1 && cat.byNum.get(nums[0]) || (hits.length === 1 ? hits[0] : null);
  if (hit && addCourse(hit.n, true)){ ui.q = ''; e.target.value = ''; commit(`Adding ${fmt(hit.n)}`); }
});
const rowsEl = $('#rows');
rowsEl.addEventListener('mouseover', e => { const r = e.target.closest('.row'); const n = r ? r.dataset.n : null; if (n !== ui.preview){ ui.preview = n; renderWeek(); } });
rowsEl.addEventListener('mouseleave', () => { if (ui.preview){ ui.preview = null; renderWeek(); } });
rowsEl.addEventListener('focusin', e => { const r = e.target.closest('.row'); if (r && r.dataset.n !== ui.preview){ ui.preview = r.dataset.n; renderWeek(); } });
$('#bDays').innerHTML = [...DAYS].map((d, i) => `<label title="${DAY_NAMES[i]}"><input type="checkbox" id="bDay${d}" value="${d}" aria-label="${DAY_NAMES[i]}"><span>${d}</span></label>`).join('');
$('#blockForm').addEventListener('submit', e => {
  e.preventDefault();
  const days = [...DAYS].filter(d => $('#bDay' + d).checked).join('');
  const toMin = v => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? +m[1] * 60 + +m[2] : NaN; };
  const s = toMin($('#bStart').value), en = toMin($('#bEnd').value), err = $('#bErr');
  const msg = !days ? 'Pick at least one day.' : !(en > s) ? 'The end time has to be after the start time.' : plan.blocks.length >= 20 ? 'This plan already has 20 blocked times.' : '';
  err.hidden = !msg; err.textContent = msg;
  if (msg) return;
  const name = $('#bName').value.trim() || 'Busy';
  plan.blocks.push({id:Math.random().toString(36).slice(2, 8), name, d:days, s, e:en});
  $('#bName').value = ''; [...DAYS].forEach(d => { $('#bDay' + d).checked = false; });
  commit(`Blocking ${name}`);
});
$('#clearBtn').addEventListener('click', () => { const snap = snapshot(); plan.items = []; plan.blocks = []; prevFit = prevOn = prevVisible = null; commit(); toast(`Cleared ${plan.name}`, restore(snap)); });
$('#copyBtn').addEventListener('click', async () => {
  const text = scheduleText();
  try { await navigator.clipboard.writeText(text); toast('Schedule copied.'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.className = 'field'; ta.id = 'copyFallback'; ta.readOnly = true; ta.value = text; ta.style.cssText = 'width:100%;min-height:110px;font-size:12px';
    const old = $('#copyFallback'); if (old) old.remove();
    $('.side-foot').after(ta); ta.focus(); ta.select(); toast('Copy is blocked here. The text is selected below, so copy it by hand.');
  }
});

syncControls(); render(); setSaveNote();
window.addEventListener('storage', e => { if (e.key === STORE_KEY && e.newValue){ try { state = normalize(JSON.parse(e.newValue)); prevFit = prevOn = prevVisible = null; syncControls(); render(); } catch (err) {} } });
})();
