const FONT_FAMILY = 'Orbitron, "Segoe UI", system-ui, sans-serif';
const fontCache = new Map();
const fontFor = size => {
  let font = fontCache.get(size);
  if (!font) {
    font = `900 ${size}px ${FONT_FAMILY}`;
    fontCache.set(size, font);
  }
  return font;
};

// Pooled canvas text for score pops and callouts ("NEAR MISS +250", "BOOST!").
export class FloatingTextPool {
  constructor(max) {
    this.items = Array.from({ length: max }, () => ({
      active: false, text: '', x: 0, y: 0, rise: 0, life: 0, maxLife: 1, color: '#fff', font: '',
    }));
  }

  clear() {
    for (let i = 0; i < this.items.length; i++) this.items[i].active = false;
  }

  spawn(text, x, y, color, size = 24, life = 1.1, rise = 70) {
    let slot = null;
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) {
        slot = it;
        break;
      }
      if (slot === null || it.life < slot.life) slot = it; // recycle the oldest
    }
    slot.active = true;
    slot.text = text;
    slot.x = x;
    slot.y = y;
    slot.rise = rise;
    slot.life = life;
    slot.maxLife = life;
    slot.color = color;
    slot.font = fontFor(Math.round(size));
  }

  update(dt) {
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      it.life -= dt;
      it.y -= (it.rise / it.maxLife) * dt;
      if (it.life <= 0) it.active = false;
    }
  }

  render(ctx) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      if (!it.active) continue;
      const t = 1 - it.life / it.maxLife;
      const scale = t < 0.12 ? 0.55 + (t / 0.12) * 0.65 : t < 0.24 ? 1.2 - ((t - 0.12) / 0.12) * 0.2 : 1;
      ctx.save();
      ctx.globalAlpha = it.life < 0.35 ? it.life / 0.35 : 1;
      ctx.translate(it.x, it.y);
      ctx.scale(scale, scale);
      ctx.font = it.font;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(8,4,20,0.85)';
      ctx.strokeText(it.text, 0, 0);
      ctx.shadowColor = it.color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = it.color;
      ctx.fillText(it.text, 0, 0);
      ctx.restore();
    }
  }
}
