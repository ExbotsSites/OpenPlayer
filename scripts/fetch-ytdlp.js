// Downloads the latest yt-dlp.exe into ./bin so electron-builder can bundle it. Runs automatically before `npm run dist`.
const fs = require('fs'), path = require('path');
(async () => {
  const dir = path.join(__dirname, '..', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'yt-dlp.exe');
  const r = await fetch('https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe');
  if (!r.ok) throw new Error('yt-dlp download failed: HTTP ' + r.status);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log('yt-dlp.exe ready (' + (fs.statSync(file).size / 1e6).toFixed(1) + ' MB)');
})().catch(e => { console.error(e); process.exit(1); });
