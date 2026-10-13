/* Deep Sea Hunter: small emoji-first PWA prototype. */
const CREATURES = [
  { id: 'clownfish', emoji: '🐠', name: 'クマノミ', points: 10 },
  { id: 'tropical', emoji: '🐟', name: '熱帯魚', points: 10 },
  { id: 'dolphin', emoji: '🐬', name: 'イルカ', points: 25 },
  { id: 'whale', emoji: '🐳', name: 'クジラ', points: 30 },
  { id: 'squid', emoji: '🦑', name: 'イカ', points: 20 },
  { id: 'octopus', emoji: '🐙', name: 'タコ', points: 20 },
  { id: 'blowfish', emoji: '🐡', name: 'フグ', points: 15 },
  { id: 'shell', emoji: '🐚', name: '貝', points: 5 }
];
const SAVE_KEY = 'deep-sea-hunter-save-v1';
let save = loadSave();
let creatures = [];
let spear = null;
let dragging = false;
let dragOrigin = null;
let dragPoint = null;
let playing = false;
let shotCooldown = 0;
let message = '魚に向かって引っ張り、指を離そう！';
let bubbles = [];

function loadSave() {
  try {
    const value = JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
    return { score: Number(value.score) || 0, caught: Number(value.caught) || 0, discovered: value.discovered && typeof value.discovered === 'object' ? value.discovered : {} };
  } catch (_) { return { score: 0, caught: 0, discovered: {} }; }
}
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (_) { message = '保存できません。端末の空き容量を確認してね'; } updateStats(); }
function updateStats() {
  document.querySelector('#score').textContent = save.score;
  document.querySelector('#caught').textContent = save.caught;
  document.querySelector('#discovered').textContent = `${Object.keys(save.discovered).length} / ${CREATURES.length}`;
}
function showBook() {
  const book = document.querySelector('#book');
  book.hidden = false;
  document.querySelector('#bookGrid').innerHTML = CREATURES.map(c => {
    const record = save.discovered[c.id];
    return `<article class="creature ${record ? '' : 'locked'}"><div class="emoji">${record ? c.emoji : '❔'}</div><div><strong>${record ? c.name : '未発見'}</strong><small>${record ? `捕獲 ${record.count}回` : 'まだ会っていない'}</small></div></article>`;
  }).join('');
  book.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

new p5(p => {
  p.setup = () => {
    const canvas = p.createCanvas(600, 750);
    canvas.parent('game');
    canvas.elt.setAttribute('aria-label', '深海ゲーム。魚を狙って引っ張り、指を離すとモリを撃ちます');
    p.textFont('system-ui, sans-serif');
    p.pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
    for (let i = 0; i < 24; i++) bubbles.push({ x: p.random(20, 580), y: p.random(0, 750), r: p.random(2, 7), speed: p.random(.25, .8) });
    spawnCreatures();
    updateStats();
  };
  p.windowResized = () => {
    const el = document.querySelector('#game');
    if (el && el.clientWidth) p.resizeCanvas(600, 750);
  };
  p.draw = () => {
    drawOcean();
    if (playing) {
      for (const c of creatures) {
        if (!c.caught) {
          c.x += c.vx;
          if (c.x < 55 || c.x > 545) c.vx *= -1;
          c.y += Math.sin(p.frameCount * .025 + c.phase) * .12;
        }
      }
    }
    drawCreatures();
    drawSlingshot();
    if (spear) {
      spear.x += spear.vx; spear.y += spear.vy;
      spear.vy += .08;
      p.push(); p.translate(spear.x, spear.y); p.rotate(Math.atan2(spear.vy, spear.vx));
      p.stroke('#f3fbff'); p.strokeWeight(4); p.line(-24, 0, 14, 0); p.line(14, 0, 4, -7); p.line(14, 0, 4, 7); p.pop();
      const target = creatures.find(c => !c.caught && p.dist(spear.x, spear.y, c.x, c.y) < 32);
      if (target) catchCreature(target);
      if (spear && (spear.x < -30 || spear.x > 630 || spear.y < -30 || spear.y > 780)) spear = null;
    }
    if (!playing) {
      p.noStroke(); p.fill(1, 20, 35, 155); p.rect(0, 0, 600, 750);
      p.textAlign(p.CENTER, p.CENTER); p.textSize(64); p.text('🌊', 300, 275);
      p.fill('#e9fbff'); p.textSize(28); p.text('深海ハンティング', 300, 345);
      p.fill('#b7dce9'); p.textSize(17); p.text('「あそぶ」を押してスタート', 300, 385);
    }
    if (dragging && dragPoint && dragOrigin) {
      p.stroke('#5be3dc'); p.strokeWeight(5); p.line(dragOrigin.x, dragOrigin.y, dragPoint.x, dragPoint.y);
      p.noStroke(); p.fill('#5be3dc'); p.circle(dragPoint.x, dragPoint.y, 15);
      p.fill('#eafaff'); p.textAlign(p.CENTER); p.textSize(17); p.text('離して発射！', 300, 675);
    }
  };
  function drawOcean() {
    for (let y = 0; y < 750; y += 3) {
      const t = y / 750;
      p.stroke(p.lerpColor(p.color('#116080'), p.color('#03152e'), t)); p.line(0, y, 600, y);
    }
    p.noStroke();
    for (const b of bubbles) {
      p.fill(180, 235, 255, 70); p.circle(b.x, b.y, b.r * 2);
      b.y -= b.speed; if (b.y < -10) { b.y = 760; b.x = p.random(20, 580); }
    }
    p.fill(5, 35, 48, 90); p.ellipse(120, 725, 250, 100); p.ellipse(500, 740, 300, 130);
  }
  function drawCreatures() {
    p.textAlign(p.CENTER, p.CENTER);
    for (const c of creatures) {
      if (c.caught) continue;
      p.textSize(c.size); p.text(c.emoji, c.x, c.y);
    }
  }
  function drawSlingshot() {
    p.stroke('#a7d8df'); p.strokeWeight(5); p.line(270, 720, 282, 682); p.line(330, 720, 318, 682);
    if (dragging && dragPoint && dragOrigin) { p.stroke('#ffd66b'); p.strokeWeight(3); p.line(282, 690, dragPoint.x, dragPoint.y); p.line(318, 690, dragPoint.x, dragPoint.y); }
    else { p.stroke('#ffd66b'); p.strokeWeight(3); p.line(282, 690, 300, 700); p.line(318, 690, 300, 700); }
  }
  function pointerPos(event) {
    const rect = p.canvas.getBoundingClientRect();
    const source = event.touches ? event.touches[0] : event;
    return { x: (source.clientX - rect.left) * 600 / rect.width, y: (source.clientY - rect.top) * 750 / rect.height };
  }
  p.mousePressed = () => { beginDrag({ x: p.mouseX, y: p.mouseY }); return false; };
  p.mouseDragged = () => { moveDrag({ x: p.mouseX, y: p.mouseY }); return false; };
  p.mouseReleased = () => { endDrag({ x: p.mouseX, y: p.mouseY }); return false; };
  p.touchStarted = event => { const pos = pointerPos(event); beginDrag(pos); return false; };
  p.touchMoved = event => { const pos = pointerPos(event); moveDrag(pos); return false; };
  p.touchEnded = () => { if (dragging) endDrag(dragPoint || dragOrigin); return false; };
  function beginDrag(pos) {
    if (!playing || spear || shotCooldown > p.millis() || pos.y < 520) return;
    dragging = true; dragOrigin = { x: 300, y: 700 }; dragPoint = pos;
  }
  function moveDrag(pos) { if (dragging) dragPoint = pos; }
  function endDrag(pos) {
    if (!dragging) return;
    dragging = false; dragPoint = pos || dragPoint;
    const dx = dragOrigin.x - dragPoint.x, dy = dragOrigin.y - dragPoint.y;
    const power = Math.min(20, Math.hypot(dx, dy) / 5);
    if (power > 2) { spear = { x: 300, y: 700, vx: dx / Math.max(1, Math.hypot(dx, dy)) * power * 2.3, vy: dy / Math.max(1, Math.hypot(dx, dy)) * power * 2.3 }; shotCooldown = p.millis() + 350; message = '発射！'; }
    dragOrigin = null; dragPoint = null;
    document.querySelector('#hint').textContent = message;
  }
  function catchCreature(c) {
    c.caught = true; spear = null;
    save.score += c.points; save.caught += 1;
    if (!save.discovered[c.id]) save.discovered[c.id] = { count: 0, firstSeen: new Date().toISOString() };
    save.discovered[c.id].count += 1;
    persist(); message = `${c.emoji} ${c.name}を捕獲！ +${c.points}点`;
    document.querySelector('#hint').textContent = message;
    if (creatures.every(item => item.caught)) spawnCreatures();
  }
  function spawnCreatures() {
    creatures = Array.from({ length: 6 }, () => {
      const c = p.random(CREATURES);
      return { ...c, x: p.random(65, 535), y: p.random(90, 470), vx: p.random([-1, 1]) * p.random(.25, .8), phase: p.random(6), size: p.random(34, 51), caught: false };
    });
  }
  window.deepSeaStart = () => { playing = true; spawnCreatures(); message = '魚に向かって引っ張り、指を離そう！'; document.querySelector('#hint').textContent = message; };
  window.deepSeaReset = () => { save = { score: 0, caught: 0, discovered: {} }; persist(); spawnCreatures(); playing = false; spear = null; message = '記録をリセットしました'; document.querySelector('#hint').textContent = message; };
});

document.querySelector('#playBtn').addEventListener('click', () => window.deepSeaStart && window.deepSeaStart());
document.querySelector('#bookBtn').addEventListener('click', showBook);
document.querySelector('#closeBook').addEventListener('click', () => { document.querySelector('#book').hidden = true; });
document.querySelector('#resetBtn').addEventListener('click', () => { if (confirm('スコアと図鑑をすべて消しますか？')) window.deepSeaReset && window.deepSeaReset(); });
let installPrompt;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; document.querySelector('#installBtn').hidden = false; });
document.querySelector('#installBtn').addEventListener('click', async () => { if (!installPrompt) return; installPrompt.prompt(); await installPrompt.userChoice; installPrompt = null; document.querySelector('#installBtn').hidden = true; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));