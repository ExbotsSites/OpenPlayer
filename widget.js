const $ = s => document.querySelector(s);
const s = {};
op.onNp(d => {
  Object.assign(s, d);
  $('#t').textContent = s.title || 'Nothing playing';
  $('#a').textContent = s.artist || 'OpenPlayer';
  const im = $('#c');
  if (s.cover) { if (im.dataset.s !== s.cover) { im.src = s.cover; im.dataset.s = s.cover; } im.hidden = false; }
  else { im.hidden = true; im.dataset.s = ''; }
  document.body.classList.toggle('playing', !!s.playing);
  document.body.classList.toggle('liked', !!s.liked);
  $('#bar').style.width = (s.p || 0) * 100 + '%';
});
$('#prev').onclick = () => op.cmd('prev');
$('#next').onclick = () => op.cmd('next');
$('#play').onclick = () => op.cmd('play');
$('#like').onclick = () => op.cmd('like');
$('#close').onclick = () => op.widget();

// drag the widget by grabbing anywhere that isn't a button
const w = $('.w'); let last = null;
w.addEventListener('pointerdown', e => { if (e.target.closest('button, .grip')) return; last = [e.screenX, e.screenY]; w.setPointerCapture(e.pointerId); });
w.addEventListener('pointermove', e => { if (!last) return; op.wmove({ dx: e.screenX - last[0], dy: e.screenY - last[1] }); last = [e.screenX, e.screenY]; });
w.addEventListener('pointerup', () => { last = null; });

// resize from the bottom-right grip, always square
const g = $('#grip'); let rs = null;
g.addEventListener('pointerdown', e => { rs = { x: e.screenX, y: e.screenY, n: innerWidth }; g.setPointerCapture(e.pointerId); e.stopPropagation(); });
g.addEventListener('pointermove', e => { if (rs) op.wsize(rs.n + Math.max(e.screenX - rs.x, e.screenY - rs.y)); });
g.addEventListener('pointerup', () => { rs = null; });
op.ready();
