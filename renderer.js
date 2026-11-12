const $ = s => document.querySelector(s);
const linesEl = $('#lines'), lyr = $('#lyrics');

/* ---------- audio engine: 2 decks -> EQ -> mono/stereo -> limiter -> volume ---------- */
const AC = new AudioContext();
const FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const DEF = { eq: new Array(10).fill(0), pre: 0, mono: false, xf: 0, lim: true, nav: true, rpc: false, rpcId: '', oc: true };
const decks = [0, 1].map(() => {
  const el = new Audio(); el.crossOrigin = 'anonymous'; el.preload = 'auto';
  const g = AC.createGain(); AC.createMediaElementSource(el).connect(g); return { el, g, t: 0 };
});
const preamp = AC.createGain();
const bands = FREQS.map((f, i) => { const b = AC.createBiquadFilter(); b.type = i === 9 ? 'highshelf' : 'peaking'; b.frequency.value = f; b.Q.value = 1.1; return b; });
const mix = AC.createGain(); mix.channelCount = 2; mix.channelCountMode = 'explicit'; mix.channelInterpretation = 'speakers';
const limiter = AC.createDynamicsCompressor();
Object.entries({ threshold: -4, knee: 0, ratio: 20, attack: 0.003, release: 0.12 }).forEach(([k, v]) => { limiter[k].value = v; });
const master = AC.createGain();
decks.forEach(d => d.g.connect(preamp)); preamp.connect(bands[0]);
bands.forEach((b, i) => { if (i) bands[i - 1].connect(b); });
bands[9].connect(mix); master.connect(AC.destination);
let audio = decks[0].el, cd = 0, xf = 0, xfPending = false, upNext = -1;
addEventListener('pointerdown', () => AC.resume());

const setVol = v => { master.gain.value = v * v; };
function applyFX() {
  const S = db.settings;
  bands.forEach((b, i) => { b.gain.value = S.eq[i]; });
  preamp.gain.value = 10 ** (S.pre / 20);
  mix.channelCount = S.mono ? 1 : 2;
  mix.disconnect(); limiter.disconnect(); limiter.connect(master);
  mix.connect(S.lim ? limiter : master);
  xf = S.xf;
}
function ramp(d, up, sec) { // equal-power fade
  const c = new Float32Array(64);
  for (let k = 0; k < 64; k++) { const x = k / 63 * Math.PI / 2; c[k] = up ? Math.sin(x) : Math.cos(x); }
  const g = d.g.gain, t = AC.currentTime; g.cancelScheduledValues(t); g.setValueCurveAtTime(c, t, sec);
}
function startOn(url, auto) {
  const old = decks[cd], fade = auto && xf > 0 && old.el.src && !old.el.paused && old.el.currentTime > 1;
  if (fade) cd = 1 - cd; else decks[1 - cd].el.pause();
  const nd = decks[cd]; clearTimeout(nd.t);
  nd.g.gain.cancelScheduledValues(AC.currentTime); nd.g.gain.value = fade ? 0 : 1;
  audio = nd.el; xfPending = false; nd.el.src = url; nd.el.play();
  if (fade) {
    const s = Math.max(1, Math.min(xf, (old.el.duration - old.el.currentTime) || xf));
    ramp(nd, true, s); ramp(old, false, s);
    old.t = setTimeout(() => old.el.pause(), s * 1000 + 100);
  }
}
const fmt = s => isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '0:00';
const AUDIO = /\.(mp3|flac|wav|ogg|opus|m4a|aac|wma)$/i;
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 21l-1.4-1.3C5.4 15 2 12 2 8.5 2 5.4 4.4 3 7.5 3c1.7 0 3.4.8 4.5 2.1C13.1 3.8 14.8 3 16.5 3 19.6 3 22 5.4 22 8.5c0 3.5-3.4 6.5-8.6 11.2L12 21z"/></svg>';
const MORE = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>';
let db = { liked: [], playlists: [], recent: [] }, queue = [], idx = -1, view = 'home', results = null, status = '';
let lyric = { synced: false, lines: [] }, active = -1, shuffle = false, seeking = false, holdScroll = 0;
document.body.dataset.platform = op.platform; setVol(0.8);

/* ---------- library ---------- */
// identity of a song: YouTube id, else file path, else title+artist (never undefined, so two songs can't look like the same one)
const key = t => t.videoId ? 'yt:' + t.videoId : (t.path || 'x:' + t.title + '|' + t.artist);
const slim = t => ({ source: t.source, path: t.path, videoId: t.videoId, title: t.title, artist: t.artist, album: t.album, duration: t.duration, cover: t.cover || null, rpcCover: t.rpcCover, nc: t.nc });
const save = () => op.save({ settings: db.settings, recent: db.recent.map(slim), liked: db.liked.map(slim), playlists: db.playlists.map(p => ({ ...p, tracks: p.tracks.map(slim) })) });
const liked = t => !!t && db.liked.some(x => key(x) === key(t));
const cur = () => queue[idx];

function toggleLike(t) {
  if (liked(t)) db.liked = db.liked.filter(x => key(x) !== key(t)); else db.liked.unshift(slim(t));
  save(); heartSync(); if (view !== 'lyrics' && view !== 'home') renderPanel();
}
function heartSync() { $('#heart').classList.toggle('on', liked(cur())); }
$('#heart').onclick = () => cur() && toggleLike(cur());

/* ---------- views ---------- */
function renderNav() {
  document.querySelectorAll('#nav button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  const box = $('#pls'); box.innerHTML = '';
  db.playlists.forEach(p => {
    const b = document.createElement('button'); b.dataset.v = 'pl:' + p.id; b.textContent = p.name;
    b.classList.toggle('on', view === b.dataset.v); box.append(b);
  });
}
$('#nav').addEventListener('click', e => { const b = e.target.closest('button[data-v]'); if (b) setView(b.dataset.v); });

function setView(v) {
  view = v; status = '';
  $('#home').hidden = v !== 'home'; $('#lyrics').hidden = v !== 'lyrics'; $('#settings').hidden = v !== 'settings'; $('#panel').hidden = v === 'lyrics' || v === 'home' || v === 'settings';
  renderNav(); if (v === 'home') renderHome(); else if (v !== 'lyrics' && v !== 'settings') renderPanel(); if (v === 'search') $('#q').focus();
}

function btn(cls, html, fn) {
  const b = document.createElement('button'); b.className = cls; b.innerHTML = html;
  b.onclick = e => { e.stopPropagation(); fn(e); }; return b;
}

function renderPanel() {
  const pl = view.startsWith('pl:') ? db.playlists.find(p => 'pl:' + p.id === view) : null;
  let tracks = [], title = '', empty = '';
  if (view === 'search') { title = 'Search'; tracks = results || []; empty = results === null ? 'Search YouTube Music for songs.' : 'No results.'; }
  else if (view === 'liked') { title = 'Liked songs'; tracks = db.liked; empty = 'Tap the heart on a song to save it here.'; }
  else if (view === 'queue') { title = 'Queue'; tracks = queue; empty = 'The queue is empty.'; }
  else if (pl) { title = pl.name; tracks = pl.tracks; empty = 'Empty playlist. Use the menu on a song to add it.'; }
  $('#ptitle').textContent = title; $('#q').hidden = view !== 'search'; $('#delpl').hidden = !pl;
  const box = $('#rows'); box.innerHTML = '';
  if (status || !tracks.length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = status || empty; box.append(p); return; }
  tracks.forEach((t, i) => {
    const r = document.createElement('div'); r.className = 'row' + (cur() && key(cur()) === key(t) ? ' cur' : '');
    let art; if (t.cover) { art = new Image(); art.src = t.cover; } else art = document.createElement('i');
    const d = document.createElement('div'), n = document.createElement('b'), a = document.createElement('small');
    n.textContent = t.title; a.textContent = t.artist; d.append(n, a);
    const du = document.createElement('span'); du.className = 'd'; du.textContent = t.duration ? fmt(t.duration) : '';
    r.append(art, d, du, btn('hb' + (liked(t) ? ' on' : ''), HEART, () => toggleLike(t)), btn('hb', MORE, e => openMenu(e, t, pl)));
    r.onclick = () => view === 'queue' ? play(i) : (queue = tracks.slice(), play(i));
    box.append(r);
  });
}

function openMenu(e, t, pl) {
  const m = $('#menu'); m.innerHTML = '';
  const add = (label, fn) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => { fn(); m.hidden = true; }; m.append(b); };
  add('Add to queue', () => { queue.push(t); if (view === 'queue') renderPanel(); });
  db.playlists.forEach(p => add('Add to ' + p.name, () => { if (!p.tracks.some(x => key(x) === key(t))) p.tracks.push(slim(t)); save(); }));
  if (pl) add('Remove from this playlist', () => { pl.tracks = pl.tracks.filter(x => key(x) !== key(t)); save(); renderPanel(); });
  m.hidden = false;
  m.style.left = Math.min(e.clientX, innerWidth - 230) + 'px';
  m.style.top = Math.min(e.clientY, innerHeight - m.offsetHeight - 10) + 'px';
}
document.addEventListener('click', e => { if (!e.target.closest('#menu')) $('#menu').hidden = true; });

/* playlists */
$('#newpl').onclick = () => { const i = $('#plin'); i.hidden = !i.hidden; if (!i.hidden) i.focus(); };
$('#plin').onkeydown = e => {
  if (e.key !== 'Enter' || !e.target.value.trim()) return;
  const p = { id: Date.now().toString(36), name: e.target.value.trim(), tracks: [] };
  db.playlists.push(p); e.target.value = ''; e.target.hidden = true; save(); setView('pl:' + p.id);
};
$('#delpl').onclick = () => {
  if (!confirm('Delete this playlist?')) return;
  db.playlists = db.playlists.filter(p => 'pl:' + p.id !== view); save(); setView('liked');
};

/* YouTube search */
let st;
$('#q').oninput = () => { clearTimeout(st); st = setTimeout(search, 500); };
$('#q').onkeydown = e => { if (e.key === 'Enter') { clearTimeout(st); search(); } };
async function search() {
  const q = $('#q').value.trim(); if (!q) return;
  status = 'Searching YouTube Music...'; renderPanel();
  const r = await op.ytSearch(q);
  if (Array.isArray(r)) { results = r; status = ''; } else { results = []; status = 'Search failed: ' + r.error; }
  if (view === 'search') renderPanel();
}

/* ---------- playback ---------- */
async function add(paths) {
  const had = queue.length;
  for (const p of paths.filter(p => AUDIO.test(p))) queue.push(await op.meta(p));
  if (view === 'queue') renderPanel();
  if (idx < 0 && queue.length > had) play(had);
  (async () => { for (const t of queue.slice(had)) await ensureCover(t); if (view === 'queue') renderPanel(); })();
}

function paint(t) {
  $('#title').textContent = t.title; $('#artist').textContent = t.artist; document.title = `${t.title} - ${t.artist}`;
  const img = $('#cover'); img.hidden = !t.cover; img.src = t.cover || '';
}

let playTok = 0; // only the most recent click is allowed to finish; older, slower loads are dropped
async function play(i, auto) {
  const t = queue[i]; if (!t) return;
  const my = ++playTok;
  idx = i; if (!(auto && xf > 0)) audio.pause(); AC.resume(); // manual change = instant cut paint(t); heartSync(); if (view !== 'lyrics' && view !== 'home') renderPanel();
  let url = t.url;
  if (t.source === 'yt') {
    toast('Loading song...', 0); const r = await op.ytUrl(t.videoId);
    if (my !== playTok) return;
    if (typeof r !== 'string') return xfPending = false, toast("Couldn't load this song: " + ((r && r.error) || 'unknown error'), 9000);
    url = r; toast('');
  } else if (!t.url) { Object.assign(t, await op.meta(t.path)); url = t.url; }
  if (my !== playTok) return;
  paint(t); startOn(url, auto);
  tint(t.cover); loadLyrics(t, i); ensureCover(t);
  upNext = shuffle ? Math.floor(Math.random() * queue.length) : (idx + 1 < queue.length ? idx + 1 : -1);
  const nt = queue[upNext]; if (xf > 0 && nt && nt.source === 'yt') op.ytUrl(nt.videoId); // warm up the next song for crossfade
  db.recent = [slim(t), ...db.recent.filter(x => key(x) !== key(t))].slice(0, 12); save();
  op.np({ title: t.title, artist: t.artist, cover: t.cover || null });
  if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album || '', artwork: t.cover ? [{ src: t.cover }] : [] });
}

function tint(src) {
  const root = document.documentElement, def = () => root.style.setProperty('--a1', '#5b6577');
  if (!src) return def();
  const img = new Image(); img.crossOrigin = 'anonymous'; img.onerror = def;
  img.onload = () => {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data; let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const k = ((mx - mn) / (mx || 1)) ** 2 * (mx / 255) + 0.01;
        r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k;
      }
      root.style.setProperty('--a1', `rgb(${r / w | 0} ${g / w | 0} ${b / w | 0})`);
    } catch { def(); }
  };
  img.src = src;
}

/* ---------- lyrics ---------- */
function parseLRC(txt) {
  const out = []; let synced = false;
  for (const raw of txt.split(/\r?\n/)) {
    const re = /\[(\d+):(\d+(?:\.\d+)?)\]/g, times = []; let m;
    while ((m = re.exec(raw))) times.push(+m[1] * 60 + +m[2]);
    const text = raw.replace(/\[[^\]]*\]/g, '').trim();
    if (times.length) { synced = true; times.forEach(t => out.push({ t, text })); } else if (text) out.push({ t: null, text });
  }
  if (synced) out.sort((a, b) => a.t - b.t);
  return { synced, lines: out };
}
function note(msg) {
  linesEl.classList.remove('plain'); linesEl.innerHTML = '';
  const p = document.createElement('p'); p.className = 'note'; p.textContent = msg; linesEl.append(p);
  lyric = { synced: false, lines: [] };
}
async function loadLyrics(t, i) {
  note('Looking for lyrics...');
  let txt = t.lrc;
  if (!txt) txt = t.lrc = await op.lyrics({ title: t.title, artist: t.artist, album: t.album, duration: t.duration });
  if (i !== idx) return;
  if (!txt) {
    note('No lyrics found for this song. ');
    const b = document.createElement('button'); b.className = 'sbtn'; b.textContent = 'Try again';
    b.onclick = () => loadLyrics(t, i); linesEl.querySelector('.note').append(b); return;
  }
  lyric = parseLRC(txt); active = -1; linesEl.innerHTML = '';
  linesEl.classList.toggle('plain', !lyric.synced);
  lyric.lines.forEach(l => {
    const d = document.createElement('div'); d.className = 'line'; d.textContent = l.text || '\u266A';
    if (lyric.synced) d.onclick = () => { audio.currentTime = l.t; audio.play(); };
    linesEl.append(d);
  });
  lyr.scrollTop = 0; sync(true);
}
function sync(force) {
  if (!lyric.synced) return;
  const t = audio.currentTime + 0.15; let a = -1;
  for (let i = 0; i < lyric.lines.length; i++) { if (lyric.lines[i].t <= t) a = i; else break; }
  if (a === active && !force) return;
  active = a;
  [...linesEl.children].forEach((el, i) => { el.style.setProperty('--d', Math.abs(i - Math.max(a, 0))); el.classList.toggle('active', i === a); });
  const el = linesEl.children[a];
  if (el && Date.now() > holdScroll && view === 'lyrics') lyr.scrollTo({ top: el.offsetTop - lyr.clientHeight * 0.36 + el.offsetHeight / 2, behavior: 'smooth' });
}
lyr.addEventListener('wheel', () => { holdScroll = Date.now() + 2500; });

/* ---------- transport ---------- */
const toggle = () => audio.paused ? audio.play() : audio.pause();
const next = auto => queue.length && play(shuffle ? (upNext >= 0 ? upNext : Math.floor(Math.random() * queue.length)) : (idx + 1) % queue.length, auto === true);
const prev = () => audio.currentTime > 3 ? (audio.currentTime = 0) : queue.length && play((idx - 1 + queue.length) % queue.length);
$('#play').onclick = toggle; $('#next').onclick = () => next(); $('#prev').onclick = prev;
$('#shuffle').onclick = e => { shuffle = !shuffle; e.currentTarget.classList.toggle('on', shuffle); };
$('#repeat').onclick = e => { const on = !audio.loop; decks.forEach(d => { d.el.loop = on; }); e.currentTarget.classList.toggle('on', on); };
$('#vol').oninput = e => { setVol(+e.target.value); e.target.style.setProperty('--p', e.target.value * 100 + '%'); };
$('#vol').style.setProperty('--p', '80%');
decks.forEach(d => {
  d.el.onplay = () => { if (d.el === audio) document.body.classList.add('playing'); };
  d.el.onpause = () => { if (d.el === audio) document.body.classList.remove('playing'); };
  d.el.onended = () => { if (d.el === audio && !xfPending && (idx < queue.length - 1 || shuffle)) next(); };
  d.el.onerror = () => { if (d.el === audio && d.el.src) toast("Couldn't play this audio (" + ((d.el.error && d.el.error.message) || 'decode error') + ')', 7000); };
});

const seek = $('#seek');
seek.oninput = () => { seeking = true; if (audio.duration) audio.currentTime = seek.value / 1000 * audio.duration; };
seek.onchange = () => { seeking = false; };
(function loop() {
  const d = audio.duration || (cur() && cur().duration) || 0;
  if (xf > 0 && !xfPending && !audio.loop && !audio.paused && d > xf + 2 && d - audio.currentTime <= xf && (idx < queue.length - 1 || shuffle)) { xfPending = true; next(true); }
  if (!seeking && d) seek.value = audio.currentTime / d * 1000;
  seek.style.setProperty('--p', seek.value / 10 + '%');
  $('#cur').textContent = fmt(audio.currentTime); $('#dur').textContent = fmt(d);
  sync(); requestAnimationFrame(loop);
})();

/* widget sync + remote control */
setInterval(() => op.np({ playing: !audio.paused, p: audio.duration ? audio.currentTime / audio.duration : 0, liked: liked(cur()) }), 500);
op.onCmd(c => ({ play: toggle, next, prev, like: () => cur() && toggleLike(cur()) })[c]?.());

/* ---------- input ---------- */
addEventListener('dragover', e => e.preventDefault());
addEventListener('drop', e => { e.preventDefault(); add([...e.dataTransfer.files].map(f => op.pathFor(f))); });
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
  if (e.code === 'Space') { e.preventDefault(); toggle(); }
  if (e.code === 'ArrowRight') audio.currentTime += 5;
  if (e.code === 'ArrowLeft') audio.currentTime -= 5;
});
addEventListener('pointermove', e => document.querySelectorAll('.glass').forEach(g => {
  const r = g.getBoundingClientRect(); g.style.setProperty('--mx', e.clientX - r.left + 'px'); g.style.setProperty('--my', e.clientY - r.top + 'px');
}));
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', () => audio.play());
  navigator.mediaSession.setActionHandler('pause', () => audio.pause());
  navigator.mediaSession.setActionHandler('nexttrack', next);
  navigator.mediaSession.setActionHandler('previoustrack', prev);
}

async function boot(sess) { session = sess; db = await op.load(); db.liked ||= []; db.playlists ||= []; db.recent ||= [];
  { const seen = new Set(); db.liked = db.liked.filter(x => { const k = x && x.title ? key(x) : null; return k && !seen.has(k) && seen.add(k); }); } // drop broken/duplicate entries
  db.settings = { ...DEF, ...(db.settings || {}) }; db.settings.eq = [...db.settings.eq];
  // a profile that is still empty gets the pre-login library (once)
  if (!db.liked.length && !db.playlists.length && !db.recent.length && !db.settings.restored) {
    const old = await op.legacyLibrary();
    if (old) {
      db.liked = old.liked || []; db.playlists = old.playlists || []; db.recent = old.recent || [];
      const nm = db.settings.name; db.settings = { ...DEF, ...(old.settings || {}) }; if (nm) db.settings.name = nm; db.settings.eq = [...db.settings.eq];
    }
    db.settings.restored = true; save();
  }
  applyFX(); buildSound(); op.rpcCfg({ on: db.settings.rpc, id: db.settings.rpcId || cfgId }); setNav(db.settings.nav !== false); setView('home'); backfillCovers(); paintPfp(); }

let toastT;
function toast(msg, ms = 3000) {
  const el = $('#toast'); clearTimeout(toastT);
  el.hidden = !msg; el.textContent = msg || '';
  if (msg && ms) toastT = setTimeout(() => { el.hidden = true; }, ms);
}

/* ---------- home ---------- */
function greet() { const h = new Date().getHours(); return h < 5 ? 'Still up?' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; }
function mk(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
function artEl(src) { if (src) { const a = new Image(); a.src = src; return a; } return mk('i'); }
function rail(box, title, tracks) {
  if (!tracks.length) return;
  box.append(mk('h3', 'rowt', title));
  const r = mk('div', 'rail');
  tracks.forEach((t, i) => {
    const el = mk('div', 'tile'); el.append(artEl(t.cover), mk('b', '', t.title), mk('small', '', t.artist));
    el.onclick = () => { queue = tracks.slice(); play(i); };
    r.append(el);
  });
  box.append(r);
}
function renderHome() {
  const box = $('#home'), top = box.scrollTop; box.innerHTML = '';
  box.append(mk('h2', 'hello', greet() + (userName() ? ', ' + userName() : '')));
  const hq = mk('input'); hq.id = 'hq'; hq.placeholder = 'What do you want to play?';
  hq.onkeydown = e => { if (e.key === 'Enter' && hq.value.trim()) { $('#q').value = hq.value.trim(); setView('search'); search(); } };
  box.append(hq);
  const g = mk('div', 'quick');
  const items = [{ n: 'Liked songs', v: 'liked', t: db.liked, heart: true }, ...db.playlists.map(p => ({ n: p.name, v: 'pl:' + p.id, t: p.tracks })), { n: 'Queue', v: 'queue', t: queue }];
  items.slice(0, 8).forEach(s => {
    const b = mk('button', 'q'), a = artEl(s.heart ? null : s.t[0] && s.t[0].cover); if (s.heart) a.innerHTML = HEART;
    const d = mk('div'); d.append(mk('b', '', s.n), mk('small', '', s.t.length + (s.t.length === 1 ? ' song' : ' songs')));
    b.append(a, d); b.onclick = () => setView(s.v); g.append(b);
  });
  box.append(g);
  rail(box, 'Jump back in', db.recent); rail(box, 'From your liked songs', db.liked.slice(0, 12));
  if (!db.recent.length && !db.liked.length) {
    const h = mk('div', 'hero glass'); h.append(mk('b', '', 'Your music starts here'), mk('small', '', 'Search YouTube Music above, or drop audio files onto the window.')); box.append(h);
  }
  box.scrollTop = top;
}

/* ---------- sound panel + sidebar toggle ---------- */
const PRESETS = {
  'Flat': [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Tame bass': [-8, -7, -5, -2, 0, 0, 0, 0, 0, 0],
  'Bass boost': [6, 5, 3, 1, 0, 0, 0, 0, 0, 0],
  'Vocal': [-3, -2, -1, 1, 3, 3, 2, 0, -1, -2],
  'Treble': [0, 0, 0, 0, 0, 1, 3, 5, 6, 6],
  'Loudness': [5, 3, 0, -1, -2, -2, 0, 3, 5, 4],
};
function buildSound() {
  const S = db.settings, el = $('#settings'), cols = [];
  el.innerHTML = `<h2 class="stitle">Settings</h2>
    <div class="sh">Sound</div>
    <div class="seg"><button data-o="0">Stereo</button><button data-o="1">Mono</button></div>
    <label class="srow"><span>Crossfade</span><input id="xf" type="range" min="0" max="12" step="1"><em id="xfv"></em></label>
    <label class="srow"><span>Limiter</span><input id="lim" type="checkbox"><em>stops clipping</em></label>
    <div class="eqh"><select id="pre"></select><button id="eqr">Reset</button></div>
    <div class="eq" id="eq"></div>
    <div class="sh sh2">Discord</div>
    <label class="srow"><span>Show activity</span><input id="dr" type="checkbox"><em id="drs"></em></label>
    <label class="srow"><span>Client ID</span><input id="did" placeholder="Application ID" autocomplete="off"></label>
    <label class="srow"><span>Online covers</span><input id="oc" type="checkbox"><em>songs without art</em></label>
    <div class="sh sh2">Widget</div>
    <div class="srow"><span>Desktop widget</span><button class="sbtn" id="wt">Open or close</button></div>
    <div class="sh sh2">Library</div>
    <div class="srow"><span>Local music</span><button class="sbtn" id="af">Add files...</button></div>
    <div class="srow"><span>Song cache</span><button class="sbtn" id="cc">Clear</button><em id="csz"></em></div>
    <div class="srow"><span>Old library</span><button class="sbtn" id="rl">Restore from before login</button></div>
    <div class="sh sh2">Import from Spotify</div>
    <div class="srow"><span>Playlist link</span><input id="sl" placeholder="https://open.spotify.com/playlist/..." autocomplete="off"><button class="sbtn" id="si">Import</button></div>
    <div class="srow"><span>Or CSV</span><button class="sbtn" id="sc">Choose CSV files...</button></div>
    <p class="sst" id="sst"></p>`;
  ['Custom', ...Object.keys(PRESETS)].forEach(n => { const o = document.createElement('option'); o.value = o.textContent = n; $('#pre').append(o); });
  const paint = () => {
    cols.forEach((c, k) => { const v = k ? S.eq[k - 1] : S.pre; c.v.value = v; c.e.textContent = (v > 0 ? '+' : '') + v; });
    $('#dr').checked = S.rpc; $('#oc').checked = S.oc !== false; $('#did').value = S.rpcId; $('#drs').textContent = /^\d{15,22}$/.test(S.rpcId || cfgId) ? '' : 'needs ID'; $('#xf').value = S.xf; $('#xfv').textContent = S.xf ? S.xf + ' s' : 'Off'; $('#lim').checked = S.lim;
    el.querySelectorAll('.seg button').forEach(b => b.classList.toggle('on', (b.dataset.o === '1') === S.mono));
    $('#pre').value = Object.keys(PRESETS).find(n => PRESETS[n].every((x, i) => x === S.eq[i])) || 'Custom';
  };
  const change = () => { applyFX(); paint(); };
  ['Pre', ...FREQS.map(f => f >= 1000 ? f / 1000 + 'k' : String(f))].forEach((lab, k) => {
    const c = document.createElement('div'); c.className = 'band';
    const v = document.createElement('input'); v.type = 'range'; v.min = -12; v.max = k ? 12 : 6; v.step = 0.5;
    const e = document.createElement('em'), s = document.createElement('small'); s.textContent = lab;
    v.oninput = () => { if (k) S.eq[k - 1] = +v.value; else S.pre = +v.value; change(); };
    v.onchange = save; c.append(e, v, s); $('#eq').append(c); cols.push({ v, e });
  });
  $('#xf').oninput = e => { S.xf = +e.target.value; change(); }; $('#xf').onchange = save;
  $('#lim').onchange = e => { S.lim = e.target.checked; change(); save(); };
  $('#pre').onchange = e => { if (PRESETS[e.target.value]) { S.eq = PRESETS[e.target.value].slice(); change(); save(); } };
  $('#eqr').onclick = () => { S.eq = new Array(10).fill(0); S.pre = 0; change(); save(); };
  el.querySelectorAll('.seg button').forEach(b => { b.onclick = () => { S.mono = b.dataset.o === '1'; change(); save(); }; });
  const cfgRpc = () => { op.rpcCfg({ on: S.rpc, id: S.rpcId || cfgId }); paint(); };
  $('#dr').onchange = e => { S.rpc = e.target.checked; cfgRpc(); save(); };
  $('#did').onchange = e => { S.rpcId = e.target.value.trim(); cfgRpc(); save(); };
  $('#oc').onchange = e => { S.oc = e.target.checked; save(); };
  $('#wt').onclick = () => op.widget();
  $('#af').onclick = async () => add(await op.open());
  const cacheSize = async () => { $('#csz').textContent = Math.round(await op.cacheInfo() / 1048576) + ' MB'; };
  cacheSize(); $('#cc').onclick = async () => { await op.cacheClear(); cacheSize(); };
  $('#rl').onclick = async () => {
    const st = $('#sst'), old = await op.legacyLibrary();
    if (!old) { st.textContent = 'No older library found on this PC.'; return; }
    const have = new Set(db.liked.map(key)); let n = 0, pl = 0;
    (old.liked || []).forEach(t => { if (t && t.title && !have.has(key(t))) { db.liked.push(t); have.add(key(t)); n++; } });
    (old.playlists || []).forEach(p => { if (p && !db.playlists.some(x => x.id === p.id || x.name === p.name)) { db.playlists.push(p); pl++; } });
    const rec = new Set(db.recent.map(key));
    (old.recent || []).forEach(t => { if (t && t.title && !rec.has(key(t))) db.recent.push(t); });
    save(); renderNav(); st.textContent = `Restored ${n} liked songs and ${pl} playlists.`;
  };
  $('#si').onclick = () => importSpotify({ link: $('#sl').value.trim() });
  $('#sc').onclick = async () => { const f = await op.pickCsv(); if (f.length) importSpotify({ csvs: f }); };
  paint();
}
function setNav(on) { document.body.classList.toggle('nav-off', !on); db.settings.nav = on; }
$('#navbtn').onclick = () => { setNav(document.body.classList.contains('nav-off')); save(); };

/* ---------- Discord presence updates (debounced; paused = cleared) ---------- */
let rpcT;
function rpcSend() {
  clearTimeout(rpcT);
  rpcT = setTimeout(async () => {
    const t = cur();
    if (!t || audio.paused) return op.rpcAct(null);
    let cover = /^https:/.test(t.cover || '') ? t.cover : null;
    if (!cover && db.settings.rpc) { // local file: Discord needs a public image URL, so look the cover up once and remember it
      if (t.rpcCover === undefined) {
        t.rpcCover = (await op.coverLookup({ title: t.title, artist: t.artist })) || '';
        [...db.recent, ...db.liked, ...db.playlists.flatMap(p => p.tracks)].forEach(x => { if (key(x) === key(t)) x.rpcCover = t.rpcCover; });
        save();
      }
      cover = t.rpcCover || null;
    }
    if (cur() !== t || audio.paused) return; // changed while looking it up
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (t.duration || 0);
    op.rpcAct({ title: t.title, artist: t.artist, album: t.album || '', cover, dur, pos: audio.currentTime });
  }, 800);
}
decks.forEach(d => ['playing', 'pause', 'seeked', 'ended'].forEach(ev => d.el.addEventListener(ev, () => { if (d.el === audio) rpcSend(); })));

/* ---------- covers: keep embedded art, fetch missing art once, cache it with the library ---------- */
function repaint() { if (view === 'home') renderHome(); else if (view !== 'lyrics') renderPanel(); }
function syncCopies(t) {
  [...db.recent, ...db.liked, ...db.playlists.flatMap(p => p.tracks), ...queue].forEach(x => {
    if (key(x) !== key(t)) return;
    if (t.cover) x.cover = t.cover;
    if (t.rpcCover !== undefined) x.rpcCover = t.rpcCover;
    if (t.nc) x.nc = t.nc;
  });
  save();
}
async function ensureCover(t) {
  if (t.source !== 'local' || t.cover || t.nc || t._f || db.settings.oc === false) return;
  t._f = 1;
  try {
    const r = await op.coverFetch({ title: t.title, artist: t.artist });
    if (r === false) t.nc = 1; // looked it up, nothing matches: don't ask again
    if (r) { t.cover = r.data; t.rpcCover = r.url; }
    if (r !== null) syncCopies(t);
    if (r && cur() && key(cur()) === key(t)) { paint(cur()); tint(t.cover); op.np({ cover: t.cover }); }
  } finally { t._f = 0; }
}
async function backfillCovers() {
  const missing = () => [...db.recent, ...db.liked, ...db.playlists.flatMap(p => p.tracks)].filter(t => t.source === 'local' && t.path && !t.cover);
  const got = new Map();
  for (const t of missing()) { // 1) art embedded in the file
    if (!got.has(t.path)) got.set(t.path, (await op.meta(t.path)).cover || null);
    if (got.get(t.path)) t.cover = got.get(t.path);
  }
  save(); repaint();
  if (db.settings.oc === false) return;
  let n = 0; const seen = new Set();
  for (const t of missing()) { // 2) otherwise fetch it online (max 40 per launch, spaced out)
    if (t.nc || seen.has(key(t)) || n >= 40) continue;
    seen.add(key(t)); n++;
    await ensureCover(t); await new Promise(s => setTimeout(s, 700));
    if (n % 8 === 0) repaint();
  }
  repaint();
}

/* ---------- account (Discord login), pfp menu, Spotify import ---------- */
let session = null, cfgId = '';
function userName() { return (db.settings && db.settings.name) || (session && !session.guest ? session.name : '') || ''; }
function paintPfp() {
  const img = $('#pfpimg'), n = userName() || (session && session.name) || 'G';
  $('#pfpl').textContent = n[0].toUpperCase();
  if (session && session.avatar) { img.src = session.avatar; img.hidden = false; } else img.hidden = true;
}
$('#pfp').onclick = () => { const p = $('#acct'); if (p.hidden) { buildAcct(); p.hidden = false; } else p.hidden = true; };
document.addEventListener('click', e => { if (!e.target.closest('#acct, #pfp')) $('#acct').hidden = true; });
function buildAcct() {
  const p = $('#acct');
  p.innerHTML = `<div class="ah"><img id="aimg" alt=""><div><label for="aname">Display name</label><input id="aname" maxlength="32" autocomplete="off"><small id="aun"></small></div></div>
    <button id="aset">Settings</button><button id="aout"></button>`;
  $('#aname').value = userName();
  $('#aun').textContent = session.guest ? 'Guest, no account' : '@' + session.username + ' on Discord';
  if (session.avatar) $('#aimg').src = session.avatar; else $('#aimg').hidden = true;
  const saveName = () => { db.settings.name = $('#aname').value.trim().slice(0, 32); save(); paintPfp(); if (view === 'home') renderHome(); };
  $('#aname').onchange = saveName;
  $('#aname').onkeydown = e => { if (e.key === 'Enter') { saveName(); e.target.blur(); } };
  $('#aset').onclick = () => { p.hidden = true; setView('settings'); };
  $('#aout').textContent = session.guest ? 'Log in with Discord' : 'Log out';
  $('#aout').onclick = async () => { await op.logout(); location.reload(); };
}
function showLogin(s) {
  $('#login').hidden = false;
  $('#lgerr').textContent = s.clientId ? '' : 'Add your Discord Application ID to config.js to enable login.';
  $('#lgd').onclick = async () => {
    $('#lgd').disabled = true; $('#lgerr').textContent = 'Waiting for Discord in your browser...';
    const r = await op.login();
    if (r.error) { $('#lgerr').textContent = r.error; $('#lgd').disabled = false; } else location.reload();
  };
  $('#lgg').onclick = async () => { await op.guest(); location.reload(); };
}

function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  if (!rows.length) return [];
  const h = rows.shift().map(x => x.trim().toLowerCase().replace(/^\ufeff/, ''));
  const ti = h.findIndex(x => x === 'track name' || x === 'name' || x === 'title'), ai = h.findIndex(x => x.startsWith('artist'));
  if (ti < 0) return [];
  return rows.filter(r => r[ti]).map(r => ({ title: r[ti].trim(), artist: ai >= 0 ? (r[ai] || '').split(/[;,]/)[0].trim() : '' }));
}
async function importSpotify(src) {
  const st = $('#sst'); st.textContent = 'Reading playlist...';
  const jobs = [];
  if (src.csvs) src.csvs.forEach(f => jobs.push({ name: f.name.replace(/\.csv$/i, ''), list: parseCSV(f.text) }));
  else { const r = await op.spotifyFetch(src.link); if (r.error) { st.textContent = r.error; return; } jobs.push({ name: r.name, list: r.tracks }); }
  for (const j of jobs) {
    if (!j.list.length) { st.textContent = `No songs found in "${j.name}".`; continue; }
    const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: j.name || 'Spotify import', tracks: [] };
    db.playlists.push(p); renderNav();
    let miss = 0;
    for (let i = 0; i < j.list.length; i++) {
      st.textContent = `"${p.name}": matching ${i + 1}/${j.list.length} on YouTube Music...`;
      const m = await op.ytMatch(j.list[i]);
      if (m) p.tracks.push(slim(m)); else miss++;
      if (i % 10 === 9) save();
    }
    save(); renderNav();
    st.textContent = `Done: ${p.tracks.length} of ${j.list.length} songs added to "${p.name}"` + (miss ? ` (${miss} not found)` : '') + '.';
  }
}

(async () => {
  const s = await op.session(); cfgId = s.clientId || '';
  if (!s.session) return showLogin(s);
  boot(s.session);
})();
