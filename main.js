const { app, BrowserWindow, ipcMain, dialog, screen, nativeImage, shell } = require('electron');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const { execFile } = require('child_process');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

const UA = 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)';
let main, widget, yt, port, lastNp = {};
// Keep Chromium's caches out of the roaming data folder (avoids "Unable to move the cache: Access is denied")
try { app.setPath('sessionData', path.join(app.getPath('temp'), 'OpenPlayer-session')); } catch {}
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
// Portable build: keep all data next to the .exe instead of in %APPDATA%
// (the portable exe uses the normal %APPDATA% data unless an "OpenPlayer-data" folder exists next to it; create that folder to keep everything portable)
if (process.env.PORTABLE_EXECUTABLE_DIR) { const d = path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'OpenPlayer-data'); if (fs.existsSync(d)) app.setPath('userData', d); }
// Only one OpenPlayer at a time: two copies fight over the same data folder (that causes the "Unable to move the cache" errors)
if (!app.requestSingleInstanceLock()) { console.log('OpenPlayer is already running.'); app.exit(0); }
app.on('second-instance', () => { if (main) { if (main.isMinimized()) main.restore(); main.focus(); } });
const streams = {};
const web = () => ({ preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true });

function createWindow() {
  const opts = { width: 1200, height: 760, minWidth: 980, minHeight: 600, frame: false, backgroundColor: '#00000000', webPreferences: web() };
  if (process.platform === 'darwin') Object.assign(opts, { vibrancy: 'under-window', visualEffectState: 'active', titleBarStyle: 'hidden', trafficLightPosition: { x: 20, y: 20 } });
  else if (process.platform === 'win32') Object.assign(opts, { backgroundMaterial: 'acrylic', titleBarStyle: 'hidden', titleBarOverlay: { color: '#00000000', symbolColor: '#ffffff', height: 56 } });
  else opts.transparent = true;
  main = new BrowserWindow(opts);
  main.loadFile('index.html');
  main.on('closed', () => app.quit());
}

/* ---------- desktop widget (square, always on top) ---------- */
function toggleWidget() {
  if (widget) return widget.close();
  const w = screen.getPrimaryDisplay().workArea;
  widget = new BrowserWindow({
    width: 300, height: 300, x: w.x + w.width - 324, y: w.y + w.height - 324,
    frame: false, transparent: true, resizable: true, minWidth: 180, minHeight: 180, hasShadow: false, alwaysOnTop: true, skipTaskbar: true, webPreferences: web(),
  });
  widget.setAlwaysOnTop(true, 'screen-saver');
  widget.loadFile('widget.html');
  widget.on('closed', () => { widget = null; });
}
ipcMain.on('widget', toggleWidget);
// Frameless transparent windows can't be dragged/resized by the OS on Windows, so the widget asks for it.
ipcMain.on('wmove', (_, d) => { if (!widget) return; const b = widget.getBounds(); widget.setBounds({ x: b.x + d.dx, y: b.y + d.dy, width: b.width, height: b.height }); });
ipcMain.on('wsize', (_, n) => { if (!widget) return; const b = widget.getBounds(), z = Math.max(180, Math.min(640, Math.round(n))); widget.setBounds({ x: b.x, y: b.y, width: z, height: z }); });
ipcMain.on('np', (_, s) => { lastNp = { ...lastNp, ...s }; if (widget) widget.webContents.send('np', s); });
ipcMain.on('ready', () => { if (widget) widget.webContents.send('np', lastNp); });
ipcMain.on('cmd', (_, c) => { if (main) main.webContents.send('cmd', c); });

/* ---------- local files ---------- */
ipcMain.handle('open', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'Audio', extensions: ['mp3', 'flac', 'wav', 'ogg', 'opus', 'm4a', 'aac', 'wma'] }] });
  return r.canceled ? [] : r.filePaths;
});

ipcMain.handle('meta', async (_, file) => {
  const base = path.basename(file).replace(/\.[^.]+$/, '');
  const out = { source: 'local', path: file, url: localUrl(file), title: base, artist: 'Unknown artist', album: '', duration: 0, cover: null, lrc: null };
  try {
    const mm = await import('music-metadata');
    const m = await mm.parseFile(file), c = m.common;
    out.title = c.title || base; out.artist = c.artist || out.artist; out.album = c.album || ''; out.duration = m.format.duration || 0;
    const pic = c.picture && c.picture[0];
    if (pic) {
      // shrink to a small JPEG so it can be saved with the library (and shown after a restart)
      try {
        const img = nativeImage.createFromBuffer(Buffer.from(pic.data)), sz = img.getSize();
        if (img.isEmpty()) throw new Error('empty');
        const k = Math.min(1, 400 / Math.max(sz.width, sz.height));
        out.cover = 'data:image/jpeg;base64,' + img.resize({ width: Math.max(1, Math.round(sz.width * k)), height: Math.max(1, Math.round(sz.height * k)), quality: 'good' }).toJPEG(82).toString('base64');
      } catch { out.cover = `data:${pic.format};base64,${Buffer.from(pic.data).toString('base64')}`; }
    }
    const l = c.lyrics && c.lyrics[0];
    if (l) out.lrc = typeof l === 'string' ? l : l.text || null;
  } catch {}
  const side = file.replace(/\.[^.]+$/, '.lrc');
  if (fs.existsSync(side)) out.lrc = fs.readFileSync(side, 'utf8');
  return out;
});

/* ---------- lyrics (LRCLIB) ---------- */
// LRCLIB's exact-match endpoint fails when YouTube's title/artist/album differ even slightly, so: clean the names,
// try several lookups, pick the closest match by title + artist + duration, and remember what was found.
const lyFile = () => path.join(app.getPath('userData'), 'lyrics-cache.json');
let lyMem = null;
const lyLoad = () => { if (!lyMem) { try { lyMem = JSON.parse(fs.readFileSync(lyFile(), 'utf8')); } catch { lyMem = {}; } } return lyMem; };
const cleanTitle = s => String(s || '')
  .replace(/[\(\[\{][^)\]\}]*(official|video|audio|lyric|lyrics|clip|remaster|hd|hq|4k|visuali[sz]er|explicit|prod)[^)\]\}]*[\)\]\}]/gi, '')
  .replace(/[\(\[](feat|ft|featuring)\b[^)\]]*[\)\]]/gi, '')
  .replace(/\s*[-|]\s*(official|topic|lyrics?|video|audio).*$/i, '')
  .replace(/\s+(feat\.?|ft\.?|featuring)\s+.*$/i, '')
  .replace(/\s{2,}/g, ' ').trim();

async function lrc(endpoint, params) { // object/array = answer, null = no match, undefined = network trouble
  for (let k = 0; k < 2; k++) {
    try {
      const u = new URL('https://lrclib.net/api/' + endpoint); u.search = new URLSearchParams(params);
      const r = await fetch(u, { headers: { 'User-Agent': 'OpenPlayer/0.3' }, signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return null;
      if (r.ok) return await r.json();
    } catch {}
    await new Promise(s => setTimeout(s, 500));
  }
  return undefined;
}
function pickLyrics(list, t, title, artists) {
  const tt = nrm(title), ta = artists.map(nrm).filter(Boolean);
  if (!tt) return null;
  let best = null, bs = 0;
  for (const x of Array.isArray(list) ? list : [list]) {
    if (!x || x.instrumental || !(x.syncedLyrics || x.plainLyrics)) continue;
    const nt = nrm(x.trackName), na = nrm(x.artistName);
    if (!(nt === tt || nt.includes(tt) || tt.includes(nt))) continue;
    const artistOk = !ta.length || ta.some(a => na.includes(a) || a.includes(na));
    const dd = t.duration && x.duration ? Math.abs(x.duration - t.duration) : null;
    if (!artistOk && !(dd !== null && dd <= 3)) continue;
    const s = 1 + (nt === tt ? 2 : 0) + (artistOk ? 2 : 0) + (x.syncedLyrics ? 3 : 0) + (dd === null ? 0 : dd <= 2 ? 3 : dd <= 6 ? 1 : -3);
    if (s > bs) { bs = s; best = x; }
  }
  return best ? (best.syncedLyrics || best.plainLyrics) : null;
}
ipcMain.handle('lyrics', async (_, t) => {
  const cache = lyLoad(), key = nrm(`${t.artist} ${t.title}`);
  if (cache[key]) return cache[key];
  const title = cleanTitle(t.title);
  const artists = String(t.artist || '').split(/,|&|;| x |\bfeat\.? /i).map(s => s.trim()).filter(Boolean);
  const first = artists[0] || '', dur = Math.round(t.duration || 0);
  const tries = [
    ['get', { track_name: title, artist_name: first, album_name: t.album || '', duration: String(dur) }],
    ['search', { track_name: title, artist_name: first }],
    ['search', { q: `${first} ${title}`.trim() }],
    ['search', { q: title }],
  ];
  for (const [endpoint, params] of tries) {
    if (endpoint === 'get' && !dur) continue;
    const res = await lrc(endpoint, params);
    const txt = res ? pickLyrics(res, t, title, artists) : null;
    if (txt) { cache[key] = txt; try { fs.writeFileSync(lyFile(), JSON.stringify(cache)); } catch {} return txt; }
  }
  return null;
});

/* ---------- library (liked + playlists) ---------- */
const dbFile = () => path.join(app.getPath('userData'), session && !session.guest ? `library-${session.id}.json` : 'library.json');
ipcMain.handle('db:load', () => { try { return JSON.parse(fs.readFileSync(dbFile(), 'utf8')); } catch { return { liked: [], playlists: [] }; } });
ipcMain.handle('db:save', (_, d) => { fs.writeFileSync(dbFile(), JSON.stringify(d)); });

/* ---------- YouTube Music (unofficial, via youtubei.js) ---------- */
async function getYT() {
  if (!yt) { const lib = await import('youtubei.js'); try { lib.Log.setLevel(lib.Log.Level.NONE); } catch {} yt = await lib.Innertube.create(); }
  return yt;
}
const big = u => (u ? u.replace(/=w\d+-h\d+[^?]*$/, '=w600-h600') : null);

async function ytSongs(q) {
  const y = await getYT();
  const r = await y.music.search(q, { type: 'song' });
  const items = (r.songs && r.songs.contents) || (r.contents || []).flatMap(s => s.contents || []);
  return items.filter(i => i.id).map(i => ({
    source: 'yt', videoId: i.id, title: i.title || 'Untitled',
    artist: (i.artists || []).map(a => a.name).join(', ') || (i.author && i.author.name) || '',
    album: (i.album && i.album.name) || '', duration: (i.duration && i.duration.seconds) || 0,
    cover: big(i.thumbnail && i.thumbnail.contents && i.thumbnail.contents[0] && i.thumbnail.contents[0].url),
  }));
}
ipcMain.handle('yt:search', async (_, q) => { try { return await ytSongs(q); } catch (e) { return { error: String((e && e.message) || e) }; } });
const nrm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
ipcMain.handle('yt:match', async (_, t) => {
  try { const l = await ytSongs(`${t.artist} ${t.title}`.trim()); return l.find(x => nrm(x.title) === nrm(t.title)) || l[0] || null; } catch { return null; }
});

// Playback: yt-dlp first (most reliable, install separately), youtubei.js download as fallback.
// The audio is fully downloaded first, then served locally with Range support so seeking works.
const cache = new Map(), files = new Map();
const localUrl = f => { const k = 'l_' + Buffer.from(f).toString('base64url'); files.set(k, f); return `http://127.0.0.1:${port}/${k}`; };
const tmp = path.join(os.tmpdir(), 'openplayer-cache');
fs.mkdirSync(tmp, { recursive: true });

// yt-dlp lives in the user's data folder (writable, so it can update itself). First run copies the bundled one there.
function ytdlpBin() {
  const exe = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
  const own = path.join(app.getPath('userData'), 'bin', exe);
  const bundled = [path.join(process.resourcesPath || '', 'bin', exe), path.join(__dirname, 'bin', exe), path.join(__dirname, exe)].find(f => fs.existsSync(f));
  try {
    if (bundled && (!fs.existsSync(own) || fs.statSync(bundled).mtimeMs > fs.statSync(own).mtimeMs)) { fs.mkdirSync(path.dirname(own), { recursive: true }); fs.copyFileSync(bundled, own); }
  } catch { return bundled || 'yt-dlp'; }
  return fs.existsSync(own) ? own : (bundled || 'yt-dlp');
}

// A finished download keeps its final name; unfinished ones are *.part, so anything else is complete and reusable.
function cachedFile(id) {
  try { const hit = fs.readdirSync(tmp).filter(f => f.startsWith(id + '.') && !/\.(part|ytdl|temp)$/.test(f)).map(f => path.join(tmp, f))[0];
    if (hit) { const n = new Date(); fs.utimesSync(hit, n, n); } // mark as recently used
    return hit;
  } catch { return undefined; }
}
function runYtdlp(id, extra) {
  // drop leftovers from a failed run, otherwise yt-dlp tries to resume them and YouTube answers "416 Range not satisfiable"
  try { for (const f of fs.readdirSync(tmp)) if (f.startsWith(id + '.')) fs.unlinkSync(path.join(tmp, f)); } catch {}
  return new Promise((resolve, reject) => {
    const bin = ytdlpBin();
    const args = [...extra, '-f', 'bestaudio[ext=m4a]/bestaudio', '--no-playlist', '--no-continue', '--force-overwrites', '-o', path.join(tmp, id + '.%(ext)s'), '--print', 'after_move:filepath', 'https://music.youtube.com/watch?v=' + id];
    execFile(bin, args, { windowsHide: true, timeout: 120000, maxBuffer: 1 << 20, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, (err, stdout, stderr) => {
      if (err) {
        const msg = err.code === 'ENOENT' ? 'yt-dlp is not installed' : ((stderr || err.message).split('\n').filter(Boolean).pop() || 'yt-dlp failed');
        return reject(new Error(msg));
      }
      const f = stdout.trim().split('\n').pop();
      f && fs.existsSync(f) ? resolve(f) : reject(new Error('yt-dlp produced no file'));
    });
  });
}
async function viaYtdlp(id) {
  const hit = cachedFile(id); if (hit) return hit;
  // YouTube needs a JavaScript runtime. Players don't have Node installed, so reuse Electron's own (ELECTRON_RUN_AS_NODE, set above).
  const attempts = [['--js-runtimes', 'node:' + process.execPath], ['--js-runtimes', 'node'], []];
  let last;
  for (const extra of attempts) {
    try { return await runYtdlp(id, extra); }
    catch (e) { last = e; if (!/runtime|js-runtimes|no such option|unrecognized|javascript|deno/i.test(e.message)) break; }
  }
  throw last;
}

async function viaLib(id) {
  const y = await getYT();
  let last;
  for (const client of ['IOS', 'ANDROID', 'TV', undefined]) {
    try {
      const opts = { type: 'audio', quality: 'best', format: 'mp4' };
      if (client) opts.client = client;
      const stream = await y.download(id, opts);
      const chunks = [];
      for await (const c of stream) chunks.push(c);
      const buf = Buffer.concat(chunks);
      if (buf.length > 20000) { cache.set(id, buf); if (cache.size > 12) cache.delete(cache.keys().next().value); return; }
      last = new Error('empty audio stream');
    } catch (e) { last = e; }
  }
  throw last || new Error('no stream available');
}

// Song cache: downloaded YouTube audio lives in %TEMP%\openplayer-cache. Keep it under a size cap (oldest-used files go first).
const CACHE_MAX = 500 * 1024 * 1024;
function cacheFiles() {
  try { return fs.readdirSync(tmp).map(f => { const p = path.join(tmp, f), s = fs.statSync(p); return { p, size: s.size, t: s.mtimeMs }; }); } catch { return []; }
}
function pruneCache(max = CACHE_MAX, keep) {
  const list = cacheFiles().sort((a, b) => a.t - b.t);
  let total = list.reduce((n, f) => n + f.size, 0);
  for (const f of list) { if (total <= max) break; if (f.p === keep) continue; try { fs.unlinkSync(f.p); total -= f.size; } catch {} }
}
ipcMain.handle('cache:info', () => cacheFiles().reduce((n, f) => n + f.size, 0));
ipcMain.handle('cache:clear', () => { cacheFiles().forEach(f => { try { fs.unlinkSync(f.p); } catch {} }); return true; });

async function fetchAudio(id) {
  if (cache.has(id) || (files.has(id) && fs.existsSync(files.get(id)))) return;
  let e1;
  try { const f = await viaYtdlp(id); files.set(id, f); pruneCache(CACHE_MAX, f); return; } catch (e) { e1 = e; }
  try { await viaLib(id); } catch (e2) { throw new Error(`${e1.message}. Fallback also failed: ${e2.message}`); }
}

ipcMain.handle('yt:url', async (_, id) => {
  try { await fetchAudio(id); return `http://127.0.0.1:${port}/${id}`; }
  catch (e) { return { error: String((e && e.message) || e) }; }
});

const TYPES = { '.webm': 'audio/webm', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.flac': 'audio/flac', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.aac': 'audio/aac', '.wma': 'audio/x-ms-wma' };
http.createServer((req, res) => {
  const id = req.url.slice(1), f = files.get(id), b = cache.get(id);
  if (!(f && fs.existsSync(f)) && !b) { res.writeHead(404); return res.end(); }
  const total = f && !b ? fs.statSync(f).size : b.length, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  let s = 0, e = total - 1;
  if (m) {
    if (m[1]) { s = +m[1]; if (m[2]) e = Math.min(+m[2], total - 1); }
    else if (m[2]) s = Math.max(0, total - +m[2]);
  }
  const h = { 'Content-Type': (f && !b && TYPES[path.extname(f).toLowerCase()]) || 'audio/mp4', 'Access-Control-Allow-Origin': '*', 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 };
  if (m) h['Content-Range'] = `bytes ${s}-${e}/${total}`;
  res.writeHead(m ? 206 : 200, h);
  if (b) res.end(b.subarray(s, e + 1)); else fs.createReadStream(f, { start: s, end: e }).pipe(res);
}).listen(0, '127.0.0.1', function () { port = this.address().port; });

/* ---------- public cover lookup for Discord (local files have no web URL) ---------- */
async function findCoverUrl(t) { // string = found, false = no match, null = couldn't reach the service
  const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const ta = norm(t.artist), tt = norm(t.title);
  if (!tt) return false;
  const term = `${t.artist && t.artist !== 'Unknown artist' ? t.artist + ' ' : ''}${t.title}`;
  let reached = false;
  for (const country of ['US', 'RU', 'RO', 'IT']) {
    try {
      const u = new URL('https://itunes.apple.com/search');
      u.search = new URLSearchParams({ term, entity: 'song', limit: '8', country });
      const r = await fetch(u, { headers: { 'User-Agent': 'OpenPlayer/0.3' } });
      if (!r.ok) continue;
      reached = true;
      const j = await r.json();
      const hit = (j.results || []).find(x => {
        const nt = norm(x.trackName), na = norm(x.artistName);
        return (nt === tt || nt.includes(tt) || tt.includes(nt)) && (!ta || ta === 'unknown artist' || na.includes(ta) || ta.includes(na));
      });
      if (hit && hit.artworkUrl100) return hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.');
    } catch {}
  }
  return reached ? false : null;
}
ipcMain.handle('cover:lookup', async (_, t) => (await findCoverUrl(t)) || null);
// Downloads the cover once and returns a small JPEG data URL, so it is saved with the library (cached for good).
ipcMain.handle('cover:fetch', async (_, t) => {
  const url = await findCoverUrl(t);
  if (!url) return url;
  try {
    const r = await fetch(url);
    const img = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
    if (img.isEmpty()) return null;
    const sz = img.getSize(), k = Math.min(1, 400 / Math.max(sz.width, sz.height));
    return { url, data: 'data:image/jpeg;base64,' + img.resize({ width: Math.max(1, Math.round(sz.width * k)), height: Math.max(1, Math.round(sz.height * k)), quality: 'good' }).toJPEG(82).toString('base64') };
  } catch { return null; }
});

/* ---------- Discord Rich Presence ("Listening to" with cover + progress bar) ---------- */
let rpc = null, rpcReady = false, rpcOn = false, rpcId = '', lastAct = null, rpcTimer = null;
async function rpcStop() {
  clearTimeout(rpcTimer);
  const c = rpc; rpc = null; rpcReady = false;
  if (c) { try { await c.user?.clearActivity(); } catch {} try { await c.destroy(); } catch {} }
}
async function rpcConnect() {
  clearTimeout(rpcTimer);
  if (rpc || !rpcOn || !/^\d{15,22}$/.test(rpcId)) return;
  try {
    const { Client } = await import('@xhayper/discord-rpc');
    const c = new Client({ clientId: rpcId });
    rpc = c;
    c.on('ready', () => { rpcReady = true; pushAct(); });
    c.on('disconnected', () => { if (rpc === c) { rpc = null; rpcReady = false; rpcTimer = setTimeout(rpcConnect, 15000); } });
    await c.login();
  } catch { rpc = null; rpcReady = false; if (rpcOn) rpcTimer = setTimeout(rpcConnect, 15000); } // Discord not open yet: retry
}
function pushAct() {
  if (!rpc || !rpcReady || !rpc.user) return;
  const a = lastAct;
  if (!a) return void rpc.user.clearActivity().catch(() => {});
  const pad = s => ((s && s.length > 1) ? s : (s || '') + '  ').slice(0, 128);
  const act = { type: 2, details: pad(a.title), state: pad(a.artist || 'Unknown artist'), largeImageKey: a.cover || 'logo', largeImageText: pad(a.album || a.title), instance: false };
  const start = a.t - Math.round(a.pos * 1000);
  act.startTimestamp = start;
  if (a.dur > 0) act.endTimestamp = start + Math.round(a.dur * 1000); // this is what draws the progress bar
  rpc.user.setActivity(act).catch(() => {});
}
ipcMain.on('rpc:cfg', (_, c) => {
  const id = String((c && c.id) || '').trim(), on = !!(c && c.on);
  if (id === rpcId && on === rpcOn) return;
  rpcId = id; rpcOn = on;
  rpcStop().then(rpcConnect);
});
ipcMain.on('rpc:act', (_, a) => { lastAct = a && a.title ? { ...a, t: Date.now() } : null; pushAct(); });
app.on('before-quit', () => { rpcStop(); });

/* ---------- Spotify playlist import (public link, or CSV exported with Exportify) ---------- */
ipcMain.handle('spotify:fetch', async (_, link) => {
  const m = /playlist\/([A-Za-z0-9]+)/.exec(String(link || ''));
  if (!m) return { error: 'Paste a link like https://open.spotify.com/playlist/...' };
  try {
    const r = await fetch(`https://open.spotify.com/embed/playlist/${m[1]}`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } });
    if (!r.ok) return { error: `Spotify answered ${r.status}. Is the playlist public?` };
    const html = await r.text();
    const j = JSON.parse(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s.exec(html)[1]);
    const e = j.props.pageProps.state.data.entity;
    const tracks = (e.trackList || []).map(t => ({ title: t.title, artist: String(t.subtitle || '').replace(/\u00a0/g, ' ').split(',')[0].trim() })).filter(t => t.title);
    return { name: e.name || e.title, tracks };
  } catch { return { error: "Couldn't read that playlist. It must be public, and Spotify may have changed its page. Try the CSV import instead." }; }
});
ipcMain.handle('csv:pick', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'], filters: [{ name: 'CSV', extensions: ['csv'] }] });
  return r.canceled ? [] : r.filePaths.map(f => ({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') }));
});

/* ---------- Discord login (OAuth2, identity only; the token is used once and never stored) ---------- */
const cfg = (() => { try { return require('./config.js'); } catch { return {}; } })();
const REDIRECT = 'http://127.0.0.1:53682/callback';
let session = null;
const sessFile = () => path.join(app.getPath('userData'), 'session.json');
const loadSession = () => { try { session = JSON.parse(fs.readFileSync(sessFile(), 'utf8')); } catch { session = null; } };
function clientId() {
  if (/^\d{15,22}$/.test(cfg.DISCORD_CLIENT_ID || '')) return cfg.DISCORD_CLIENT_ID;
  // no rebuild needed: a config.json next to the exe / in the data folder works too, e.g. {"DISCORD_CLIENT_ID":"123..."}
  for (const d of [app.getPath('userData'), process.env.PORTABLE_EXECUTABLE_DIR, path.dirname(process.execPath)]) {
    try { const j = JSON.parse(fs.readFileSync(path.join(d, 'config.json'), 'utf8')); if (/^\d{15,22}$/.test(j.DISCORD_CLIENT_ID || '')) return j.DISCORD_CLIENT_ID; } catch {}
  }
  for (const d of [app.getPath('userData'), path.join(app.getPath('appData'), 'openplayer')]) {
    try { const s = JSON.parse(fs.readFileSync(path.join(d, 'library.json'), 'utf8')).settings; if (/^\d{15,22}$/.test(s.rpcId)) return s.rpcId; } catch {}
  }
  return '';
}
// Pre-login library files (library.json) that still contain something
function legacyLibraries() {
  const dirs = [app.getPath('userData'), path.join(app.getPath('appData'), 'openplayer'), path.join(app.getPath('appData'), 'OpenPlayer')];
  return dirs.map(d => path.join(d, 'library.json')).filter(f => {
    try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); return (j.liked || []).length || (j.playlists || []).length || (j.recent || []).length; } catch { return false; }
  });
}
ipcMain.handle('library:legacy', () => { const f = legacyLibraries()[0]; try { return f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; } catch { return null; } });
ipcMain.handle('auth:session', () => ({ session, clientId: clientId() }));
ipcMain.handle('auth:guest', () => { session = { id: 'guest', username: 'Guest', name: 'Guest', guest: true }; fs.writeFileSync(sessFile(), JSON.stringify(session)); return true; });
ipcMain.handle('auth:logout', () => { session = null; try { fs.unlinkSync(sessFile()); } catch {} return true; });
ipcMain.handle('auth:login', () => new Promise(resolve => {
  const cid = clientId();
  if (!cid) return resolve({ error: 'Add your Discord Application ID to config.js first.' });
  let done = false, srv;
  const end = r => { if (done) return; done = true; clearTimeout(timer); try { srv.close(); srv.closeAllConnections && srv.closeAllConnections(); } catch {} resolve(r); };
  const timer = setTimeout(() => end({ error: 'Login timed out. Try again.' }), 180000);
  srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname === '/callback') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(`<!doctype html><meta charset="utf-8"><title>OpenPlayer</title><body style="font-family:system-ui;background:#111;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><p id="m">Signing in...</p><script>
var q=new URLSearchParams(location.hash.slice(1)||location.search.slice(1));
fetch('/token?t='+encodeURIComponent(q.get('access_token')||'')).then(function(){document.getElementById('m').textContent=q.get('access_token')?'Signed in. You can close this tab and go back to OpenPlayer.':'Login was cancelled. You can close this tab.';});
</script>`);
    }
    if (u.pathname === '/token') {
      res.writeHead(200); res.end('ok');
      const t = u.searchParams.get('t');
      if (!t) return end({ error: 'Login was cancelled.' });
      try {
        const r = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: 'Bearer ' + t } });
        if (!r.ok) throw new Error('Discord answered ' + r.status);
        const d = await r.json();
        const avatar = d.avatar ? `https://cdn.discordapp.com/avatars/${d.id}/${d.avatar}.png?size=128` : `https://cdn.discordapp.com/embed/avatars/${Number((BigInt(d.id) >> 22n) % 6n)}.png`;
        const dir = app.getPath('userData'), f = path.join(dir, `library-${d.id}.json`), legacy = path.join(dir, 'library.json');
        // first account on this PC inherits the library you had before accounts existed
        const isEmpty = x => { try { const j = JSON.parse(fs.readFileSync(x, 'utf8')); return !((j.liked || []).length || (j.playlists || []).length || (j.recent || []).length); } catch { return true; } };
        if (isEmpty(f)) { const old = legacyLibraries()[0]; if (old) fs.copyFileSync(old, f); }
        session = { id: d.id, username: d.username, name: d.global_name || d.username, avatar };
        fs.writeFileSync(sessFile(), JSON.stringify(session));
        return end({ ok: true });
      } catch (e) { return end({ error: String((e && e.message) || e) }); }
    }
    res.writeHead(404); res.end();
  });
  srv.on('error', e => end({ error: e.code === 'EADDRINUSE' ? 'Port 53682 is busy. Close other login windows and try again.' : String(e.message) }));
  srv.listen(53682, '127.0.0.1', () => shell.openExternal(`https://discord.com/oauth2/authorize?client_id=${cid}&response_type=token&redirect_uri=${encodeURIComponent(REDIRECT)}&scope=identify`));
}));

app.whenReady().then(() => {
  loadSession(); createWindow(); pruneCache();
  // keep yt-dlp current (YouTube changes constantly)
  setTimeout(() => execFile(ytdlpBin(), ['-U'], { windowsHide: true, timeout: 120000 }, () => {}), 5000);
});
app.on('window-all-closed', () => app.quit());
