// Procedural sprite generation. Everything is rendered once into offscreen canvases (at startup,
// or when the player changes car/paint) so the game loop only ever calls drawImage.
import { PLAYER, PALETTE, BEAM, CAMERA } from './config.js';
import { VEHICLE_TYPES } from './balance.js';
import { createCanvas, shadeColor } from './utils.js';

const PAD = 34; // room for baked glow around vehicle sprites

// Rear-view body shapes. Fractions are of the sprite height (from the ground) / width.
export const CAR_STYLES = {
  // traffic
  sedan: { bodyTop: 0.56, cabinBottom: 0.9, cabinTop: 0.64, lightY: 0.44, lightH: 0.08, lightW: 0.24 },
  sports: { bodyTop: 0.6, cabinBottom: 0.84, cabinTop: 0.56, lightY: 0.45, lightH: 0.06, lightW: 0.3, led: true, spoiler: 1, exhaust: 2 },
  suv: { bodyTop: 0.52, cabinBottom: 0.94, cabinTop: 0.84, lightY: 0.4, lightH: 0.2, lightW: 0.1, vertical: true },
  legend: { bodyTop: 0.66, cabinBottom: 0.76, cabinTop: 0.44, lightY: 0.48, lightH: 0.05, lightW: 0.36, led: true, wing: true, exhaust: 1, accent: '#ffe7a0' },
  // player cars
  hatch: { bodyTop: 0.58, cabinBottom: 0.92, cabinTop: 0.78, lightY: 0.5, lightH: 0.14, lightW: 0.14, vertical: true, roofSpoiler: true, exhaust: 1 },
  coupe: { bodyTop: 0.6, cabinBottom: 0.86, cabinTop: 0.6, lightY: 0.46, lightH: 0.075, lightW: 0.28, spoiler: 0.5, exhaust: 2 },
  muscle: { bodyTop: 0.57, cabinBottom: 0.84, cabinTop: 0.62, lightY: 0.44, lightH: 0.09, lightW: 0.32, stripes: true, exhaust: 2, bigExhaust: true, spoiler: 0.35 },
  super: { bodyTop: 0.63, cabinBottom: 0.8, cabinTop: 0.5, lightY: 0.46, lightH: 0.055, lightW: 0.34, led: true, spoiler: 1, exhaust: 4, vents: true },
  hyper: { bodyTop: 0.66, cabinBottom: 0.74, cabinTop: 0.42, lightY: 0.48, lightH: 0.05, lightW: 0.36, led: true, wing: true, exhaust: 1, vents: true },
  racer: { bodyTop: 0.5, cabinBottom: 0.6, cabinTop: 0.4, lightY: 0.36, lightH: 0.06, lightW: 0.2, wing: true, exhaust: 2, exposedWheels: true },
  phantom: { bodyTop: 0.66, cabinBottom: 0.72, cabinTop: 0.4, lightY: 0.48, lightH: 0.05, lightW: 0.38, led: true, wing: true, exhaust: 1, vents: true, accent: '#b36bff' },
};

function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function trapezoid(ctx, cx, yBottom, wBottom, yTop, wTop, r) {
  ctx.beginPath();
  ctx.moveTo(cx - wBottom / 2, yBottom);
  ctx.lineTo(cx - wTop / 2, yTop + r);
  ctx.quadraticCurveTo(cx - wTop / 2, yTop, cx - wTop / 2 + r, yTop);
  ctx.lineTo(cx + wTop / 2 - r, yTop);
  ctx.quadraticCurveTo(cx + wTop / 2, yTop, cx + wTop / 2, yTop + r);
  ctx.lineTo(cx + wBottom / 2, yBottom);
  ctx.closePath();
}

function drawLamp(ctx, x, y, w, h, braking) {
  ctx.save();
  ctx.shadowColor = braking ? 'rgba(255,40,70,1)' : 'rgba(255,20,50,0.85)';
  ctx.shadowBlur = braking ? 30 : 16;
  ctx.fillStyle = braking ? '#ff3b55' : '#c8102e';
  roundRect(ctx, x, y, w, h, Math.min(w, h) * 0.3);
  ctx.fill();
  if (braking) ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = braking ? 'rgba(255,225,230,0.95)' : 'rgba(255,120,140,0.55)';
  roundRect(ctx, x + w * 0.1, y + h * 0.3, w * 0.8, h * 0.3, h * 0.15);
  ctx.fill();
  ctx.restore();
}

function drawShadow(ctx, cx, ground, W, H) {
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.beginPath();
  ctx.ellipse(cx, ground - H * 0.015, W * 0.56, Math.max(4, H * 0.08), 0, 0, Math.PI * 2);
  ctx.fill();
}

// opts: { rim: color of visible wheel rims, accent: neon accent line color }
function drawCar(ctx, left, ground, W, H, color, braking, st, opts) {
  const cx = left + W / 2;
  const right = left + W;
  drawShadow(ctx, cx, ground, W, H);

  // Tyres (exposed wheels sit outside a narrower body)
  const bodyInset = st.exposedWheels ? W * 0.12 : 0;
  const tyreW = st.exposedWheels ? W * 0.18 : W * 0.16;
  const tyreH = st.exposedWheels ? H * 0.42 : H * 0.3;
  ctx.fillStyle = '#050408';
  roundRect(ctx, left + W * (st.exposedWheels ? 0 : 0.04), ground - tyreH, tyreW, tyreH, W * 0.025);
  ctx.fill();
  roundRect(ctx, right - W * (st.exposedWheels ? 0 : 0.04) - tyreW, ground - tyreH, tyreW, tyreH, W * 0.025);
  ctx.fill();
  if (opts.rim) {
    ctx.fillStyle = opts.rim;
    const rimW = tyreW * 0.5;
    const rimH = Math.max(2, H * 0.035);
    ctx.fillRect(left + W * (st.exposedWheels ? 0 : 0.04) + (tyreW - rimW) / 2, ground - rimH * 1.6, rimW, rimH);
    ctx.fillRect(right - W * (st.exposedWheels ? 0 : 0.04) - tyreW + (tyreW - rimW) / 2, ground - rimH * 1.6, rimW, rimH);
  }

  const bl = left + bodyInset;
  const bw = W - bodyInset * 2;
  const bodyTopY = ground - H * st.bodyTop;
  const cabTop = ground - H;

  // Cabin and rear glass
  trapezoid(ctx, cx, bodyTopY + H * 0.04, W * st.cabinBottom, cabTop, W * st.cabinTop, H * 0.07);
  ctx.fillStyle = shadeColor(color, -0.25);
  ctx.fill();
  const glass = ctx.createLinearGradient(0, cabTop, 0, bodyTopY);
  glass.addColorStop(0, '#22305a');
  glass.addColorStop(0.55, '#0b1024');
  glass.addColorStop(1, '#05070f');
  trapezoid(ctx, cx, bodyTopY + H * 0.01, W * (st.cabinBottom - 0.1), cabTop + H * 0.06, W * Math.max(0.2, st.cabinTop - 0.08), H * 0.04);
  ctx.fillStyle = glass;
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = 'rgba(170,205,255,0.09)';
  ctx.beginPath();
  ctx.moveTo(cx - W * 0.08, cabTop);
  ctx.lineTo(cx + W * 0.06, cabTop);
  ctx.lineTo(cx - W * 0.14, bodyTopY);
  ctx.lineTo(cx - W * 0.3, bodyTopY);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = shadeColor(color, 0.3);
  roundRect(ctx, cx - (W * st.cabinTop) / 2 + H * 0.06, cabTop, W * st.cabinTop - H * 0.12, H * 0.03, H * 0.015);
  ctx.fill();
  if (st.roofSpoiler) {
    ctx.fillStyle = shadeColor(color, -0.4);
    roundRect(ctx, cx - (W * st.cabinTop) / 2 - W * 0.02, cabTop - H * 0.02, W * st.cabinTop + W * 0.04, H * 0.05, H * 0.02);
    ctx.fill();
  }

  // Body / trunk
  const bodyBottom = ground - H * 0.08;
  const body = ctx.createLinearGradient(0, bodyTopY, 0, bodyBottom);
  body.addColorStop(0, shadeColor(color, 0.3));
  body.addColorStop(0.18, color);
  body.addColorStop(1, shadeColor(color, -0.5));
  roundRect(ctx, bl, bodyTopY, bw, bodyBottom - bodyTopY, H * 0.09);
  ctx.fillStyle = body;
  ctx.fill();

  ctx.lineWidth = Math.max(1, H * 0.012);
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.moveTo(bl + bw * 0.08, bodyTopY + H * 0.1);
  ctx.lineTo(bl + bw * 0.92, bodyTopY + H * 0.1);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.beginPath();
  ctx.moveTo(bl + bw * 0.06, bodyTopY + H * 0.015);
  ctx.lineTo(bl + bw * 0.94, bodyTopY + H * 0.015);
  ctx.stroke();

  if (st.stripes) {
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(cx - W * 0.09, bodyTopY + H * 0.01, W * 0.05, H * 0.22);
    ctx.fillRect(cx + W * 0.04, bodyTopY + H * 0.01, W * 0.05, H * 0.22);
    ctx.fillRect(cx - W * 0.09, cabTop + H * 0.005, W * 0.05, H * 0.03);
    ctx.fillRect(cx + W * 0.04, cabTop + H * 0.005, W * 0.05, H * 0.03);
  }
  if (st.vents) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(bl + bw * 0.06, bodyTopY + H * (0.14 + i * 0.035), bw * 0.14, H * 0.018);
      ctx.fillRect(bl + bw * 0.8, bodyTopY + H * (0.14 + i * 0.035), bw * 0.14, H * 0.018);
    }
  }

  // Bumper, diffuser, exhausts, plate
  ctx.fillStyle = shadeColor(color, -0.65);
  roundRect(ctx, bl + bw * 0.015, ground - H * 0.21, bw * 0.97, H * 0.13, H * 0.04);
  ctx.fill();
  const exhausts = st.exhaust || 0;
  if (exhausts > 0) {
    const r = st.bigExhaust ? 0.075 : 0.055;
    const positions = exhausts === 1 ? [0] : exhausts === 2 ? [-0.3, 0.3] : [-0.34, -0.24, 0.24, 0.34];
    for (let i = 0; i < positions.length; i++) {
      const ex = cx + positions[i] * W;
      ctx.fillStyle = '#2a2a34';
      ctx.beginPath();
      ctx.ellipse(ex, ground - H * 0.13, W * r, H * 0.045, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.ellipse(ex, ground - H * 0.13, W * r * 0.64, H * 0.028, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  if (exhausts !== 1) {
    ctx.fillStyle = '#c9cde0';
    roundRect(ctx, cx - W * 0.11, ground - H * 0.34, W * 0.22, H * 0.09, H * 0.015);
    ctx.fill();
  }

  if (st.spoiler) {
    const lift = H * 0.1 * st.spoiler;
    ctx.fillStyle = shadeColor(color, -0.45);
    if (st.spoiler >= 1) {
      ctx.fillRect(cx - W * 0.32, bodyTopY - lift * 0.6, W * 0.03, lift * 0.7);
      ctx.fillRect(cx + W * 0.29, bodyTopY - lift * 0.6, W * 0.03, lift * 0.7);
    }
    roundRect(ctx, bl - W * 0.01, bodyTopY - lift, bw + W * 0.02, H * 0.05, H * 0.02);
    ctx.fill();
  }
  if (st.wing) {
    ctx.fillStyle = '#101018';
    ctx.fillRect(cx - W * 0.26, bodyTopY - H * 0.24, W * 0.03, H * 0.26);
    ctx.fillRect(cx + W * 0.23, bodyTopY - H * 0.24, W * 0.03, H * 0.26);
    roundRect(ctx, left - W * 0.02, bodyTopY - H * 0.3, W * 1.04, H * 0.07, H * 0.025);
    ctx.fill();
    ctx.fillStyle = shadeColor(color, -0.2);
    ctx.fillRect(left - W * 0.02, bodyTopY - H * 0.3, W * 0.05, H * 0.1);
    ctx.fillRect(right - W * 0.03, bodyTopY - H * 0.3, W * 0.05, H * 0.1);
  }

  // Tail lights
  const ly = ground - H * st.lightY;
  const lh = H * st.lightH;
  const lw = W * st.lightW;
  const inset = bodyInset + (st.vertical ? W * 0.03 : W * 0.04);
  const lx0 = left + inset;
  const rx1 = right - inset;
  const rx0 = rx1 - lw;
  drawLamp(ctx, lx0, ly - lh / 2, lw, lh, braking);
  drawLamp(ctx, rx0, ly - lh / 2, lw, lh, braking);
  if (st.led) {
    ctx.save();
    ctx.globalAlpha = braking ? 0.95 : 0.7;
    drawLamp(ctx, lx0 + lw, ly - lh * 0.2, rx0 - lx0 - lw, lh * 0.32, braking);
    ctx.restore();
  }
  if (braking) drawLamp(ctx, cx - W * 0.09, cabTop + H * 0.035, W * 0.18, H * 0.028, true);

  const accent = opts.accent || st.accent;
  if (accent) {
    ctx.save();
    ctx.shadowColor = accent;
    ctx.shadowBlur = 14;
    ctx.fillStyle = accent;
    ctx.fillRect(bl + bw * 0.1, ground - H * 0.095, bw * 0.8, Math.max(2, H * 0.016));
    ctx.restore();
  }

  return { y: ly, lx0, lx1: lx0 + lw, rx0, rx1 };
}

function drawTruck(ctx, left, ground, W, H, color, braking) {
  const cx = left + W / 2;
  const right = left + W;
  drawShadow(ctx, cx, ground, W, H * 0.4);

  ctx.fillStyle = '#050408';
  roundRect(ctx, left + W * 0.05, ground - H * 0.16, W * 0.26, H * 0.16, 4);
  ctx.fill();
  roundRect(ctx, right - W * 0.31, ground - H * 0.16, W * 0.26, H * 0.16, 4);
  ctx.fill();

  const boxTop = ground - H;
  const boxBottom = ground - H * 0.14;
  const box = ctx.createLinearGradient(0, boxTop, 0, boxBottom);
  box.addColorStop(0, shadeColor(color, 0.25));
  box.addColorStop(0.1, color);
  box.addColorStop(1, shadeColor(color, -0.55));
  roundRect(ctx, left, boxTop, W, boxBottom - boxTop, W * 0.02);
  ctx.fillStyle = box;
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.3)';
  ctx.lineWidth = Math.max(1, W * 0.008);
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    const x = left + (W * i) / 6;
    ctx.moveTo(x, boxTop + H * 0.03);
    ctx.lineTo(x, boxBottom - H * 0.03);
  }
  ctx.stroke();
  ctx.lineWidth = Math.max(2, W * 0.016);
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath();
  ctx.moveTo(cx, boxTop + H * 0.02);
  ctx.lineTo(cx, boxBottom);
  ctx.stroke();

  ctx.fillStyle = 'rgba(200,205,225,0.5)';
  const rodW = Math.max(2, W * 0.012);
  const rods = [0.14, 0.38, 0.62, 0.86];
  for (let i = 0; i < rods.length; i++) ctx.fillRect(left + W * rods[i] - rodW / 2, boxTop + H * 0.06, rodW, boxBottom - boxTop - H * 0.1);

  const tapeY = boxBottom - H * 0.035;
  const segW = W / 12;
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.7)' : 'rgba(255,40,60,0.8)';
    ctx.fillRect(left + i * segW, tapeY, segW, H * 0.018);
  }

  ctx.save();
  ctx.shadowColor = 'rgba(255,170,40,1)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffb347';
  for (let i = 0; i < 5; i++) ctx.fillRect(left + W * (0.12 + i * 0.19) - W * 0.025, boxTop + H * 0.015, W * 0.05, H * 0.018);
  ctx.restore();

  ctx.fillStyle = '#20202a';
  ctx.fillRect(left + W * 0.04, ground - H * 0.12, W * 0.92, H * 0.035);

  const lh = H * 0.045;
  const lw = W * 0.12;
  const ly = boxBottom - H * 0.08;
  drawLamp(ctx, left + W * 0.03, ly - lh / 2, lw, lh, braking);
  drawLamp(ctx, right - W * 0.03 - lw, ly - lh / 2, lw, lh, braking);
  return { y: ly, lx0: left + W * 0.03, lx1: left + W * 0.03 + lw, rx0: right - W * 0.03 - lw, rx1: right - W * 0.03 };
}

// Wet-asphalt light streaks below the tail lights.
function drawReflections(ctx, lights, ground, length, braking) {
  const strength = braking ? 0.5 : 0.3;
  const drawStreak = (x0, x1) => {
    const w = x1 - x0;
    const g = ctx.createLinearGradient(0, ground, 0, ground + length);
    g.addColorStop(0, `rgba(255,40,80,${strength})`);
    g.addColorStop(1, 'rgba(255,40,80,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x0 + w * 0.2, ground + 1, w * 0.6, length);
  };
  drawStreak(lights.lx0, lights.lx1);
  drawStreak(lights.rx0, lights.rx1);
}

export function createVehicleSprite(styleKey, dims, color, braking, ppm, opts = {}) {
  const W = dims.width * ppm;
  const H = dims.height * ppm;
  const reflect = H * 0.6;
  const top = PAD + (CAR_STYLES[styleKey] && CAR_STYLES[styleKey].wing ? H * 0.12 : 0);
  const canvas = createCanvas(W + PAD * 2, H + top + PAD + reflect);
  const ctx = canvas.getContext('2d');
  const left = PAD;
  const ground = top + H;
  const lights = styleKey === 'truck'
    ? drawTruck(ctx, left, ground, W, H, color, braking)
    : drawCar(ctx, left, ground, W, H, color, braking, CAR_STYLES[styleKey], opts);
  drawReflections(ctx, lights, ground, reflect, braking);
  return { canvas, anchorX: left + W / 2, anchorY: ground, ppm, lights };
}

// Player car sprites for a garage car + cosmetics.
export function createPlayerSprites(car, custom) {
  const dims = { width: car.width, height: car.height };
  const opts = { rim: custom.rim, accent: custom.accent };
  return {
    normal: createVehicleSprite(car.style, dims, custom.paint, false, PLAYER.SPRITE_PPM, opts),
    brake: createVehicleSprite(car.style, dims, custom.paint, true, PLAYER.SPRITE_PPM, opts),
  };
}

export function createGlowSprite(size, rgb, whiteCore = true) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  if (whiteCore) g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(whiteCore ? 0.14 : 0, `rgba(${rgb},0.95)`);
  g.addColorStop(0.38, `rgba(${rgb},0.32)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function createSoftSprite(size, inner, mid, outer) {
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, inner);
  g.addColorStop(0.5, mid);
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

function createDebrisSprite() {
  const c = createCanvas(16, 16);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#2b2838';
  ctx.beginPath();
  ctx.moveTo(2, 4);
  ctx.lineTo(13, 2);
  ctx.lineTo(14, 11);
  ctx.lineTo(5, 14);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(4, 4, 7, 2);
  return c;
}

function createPoolSprite(rgb) {
  const c = createCanvas(256, 128);
  const ctx = c.getContext('2d');
  ctx.scale(1, 0.5);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, `rgba(${rgb},0.5)`);
  g.addColorStop(0.5, `rgba(${rgb},0.16)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}

// Headlight wash tinted by the chosen headlight color.
export function createBeamSprite(rgb = '215, 235, 255') {
  const w = 256;
  const h = 256;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  // Perspective already magnifies the near end, so the baked trapezoid only needs the projected ratio.
  const front = CAMERA.PLAYER_DEPTH + 2.2;
  const nearRatio = Math.min(0.95, (BEAM.NEAR_WIDTH * ((BEAM.LENGTH + front) / front)) / BEAM.FAR_WIDTH);
  if ('filter' in ctx) ctx.filter = 'blur(10px)';
  const inset = (w * (1 - nearRatio)) / 2;
  ctx.beginPath();
  ctx.moveTo(inset + 14, h);
  ctx.lineTo(w - inset - 14, h);
  ctx.lineTo(w - 12, 12);
  ctx.lineTo(12, 12);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, h, 0, 0);
  g.addColorStop(0, `rgba(${rgb},0.5)`);
  g.addColorStop(0.45, `rgba(${rgb},0.16)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fill();
  return c;
}

function createFlameSprite() {
  const w = 48;
  const h = 160;
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(w / 2, h * 0.12, 2, w / 2, h * 0.3, h * 0.7);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(140,240,255,0.95)');
  g.addColorStop(0.45, 'rgba(70,120,255,0.5)');
  g.addColorStop(1, 'rgba(160,60,255,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(w / 2, h * 0.45, w * 0.45, h * 0.45, 0, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function createUnderglowSprite(rgb) {
  const c = createCanvas(256, 96);
  const ctx = c.getContext('2d');
  ctx.scale(1, 96 / 256);
  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, `rgba(${rgb},0.7)`);
  g.addColorStop(0.45, `rgba(${rgb},0.22)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);
  return c;
}

function createPickupSprite(type) {
  const size = 128;
  const m = size / 2;
  const c = createCanvas(size, size);
  const ctx = c.getContext('2d');
  const rgb = type === 'boost' ? PALETTE.CYAN_RGB : type === 'repair' ? PALETTE.GREEN_RGB : '255, 211, 90';
  const glow = ctx.createRadialGradient(m, m, 0, m, m, m);
  glow.addColorStop(0, `rgba(${rgb},0.5)`);
  glow.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, size, size);

  ctx.translate(m, m);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 6 + (i * Math.PI) / 3;
    const r = size * 0.3;
    if (i === 0) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(8,12,30,0.92)';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = `rgb(${rgb})`;
  ctx.shadowColor = `rgb(${rgb})`;
  ctx.shadowBlur = 16;
  ctx.stroke();

  ctx.fillStyle = `rgb(${rgb})`;
  ctx.beginPath();
  if (type === 'boost') {
    ctx.moveTo(-5, -24);
    ctx.lineTo(11, -24);
    ctx.lineTo(3, -5);
    ctx.lineTo(14, -5);
    ctx.lineTo(-8, 26);
    ctx.lineTo(-2, 4);
    ctx.lineTo(-13, 4);
    ctx.closePath();
  } else if (type === 'repair') {
    ctx.rect(-6, -20, 12, 40);
    ctx.rect(-20, -6, 40, 12);
  } else {
    // credit chip: a diamond
    ctx.moveTo(0, -24);
    ctx.lineTo(18, 0);
    ctx.lineTo(0, 24);
    ctx.lineTo(-18, 0);
    ctx.closePath();
  }
  ctx.fill();
  return c;
}

function createConeSprite() {
  const c = createCanvas(48, 64);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(4, 58, 40, 6);
  ctx.fillStyle = '#ff7a1a';
  ctx.beginPath();
  ctx.moveTo(24, 2);
  ctx.lineTo(40, 58);
  ctx.lineTo(8, 58);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f4f4f4';
  ctx.beginPath();
  ctx.moveTo(19, 20);
  ctx.lineTo(29, 20);
  ctx.lineTo(32, 32);
  ctx.lineTo(16, 32);
  ctx.closePath();
  ctx.fill();
  return c;
}

function createArrowSignSprite() {
  const c = createCanvas(160, 120);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#222';
  ctx.fillRect(74, 60, 12, 60);
  ctx.fillStyle = '#111';
  roundRect(ctx, 4, 10, 152, 58, 6);
  ctx.fill();
  ctx.save();
  ctx.shadowColor = '#ffb020';
  ctx.shadowBlur = 12;
  ctx.fillStyle = '#ffb020';
  for (let i = 0; i < 3; i++) {
    const x = 28 + i * 40;
    ctx.beginPath();
    ctx.moveTo(x, 24);
    ctx.lineTo(x + 20, 39);
    ctx.lineTo(x, 54);
    ctx.lineTo(x + 8, 39);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  return c;
}

function createGateSprite() {
  const c = createCanvas(200, 110);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1a1a24';
  ctx.fillRect(10, 40, 12, 70);
  ctx.fillRect(178, 40, 12, 70);
  for (let row = 0; row < 2; row++) {
    const y = 34 + row * 34;
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = (i + row) % 2 ? '#f4f4f4' : '#e8203a';
      ctx.fillRect(4 + i * 24, y, 24, 18);
    }
  }
  ctx.fillStyle = '#1b2a6b';
  ctx.fillRect(60, 8, 80, 22);
  ctx.fillStyle = '#e8ecff';
  ctx.font = '700 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('POLICE', 100, 20);
  return c;
}

export function createVignette(w, h, rgb) {
  const cw = Math.max(2, Math.round(w / 3));
  const ch = Math.max(2, Math.round(h / 3));
  const c = createCanvas(cw, ch);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.25, cw / 2, ch / 2, Math.hypot(cw, ch) / 2);
  g.addColorStop(0, `rgba(${rgb},0)`);
  g.addColorStop(0.6, `rgba(${rgb},0.14)`);
  g.addColorStop(1, `rgba(${rgb},0.75)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, cw, ch);
  return c;
}

export function createSpriteBank() {
  const vehicles = {};
  for (const key of Object.keys(VEHICLE_TYPES)) {
    const spec = VEHICLE_TYPES[key];
    vehicles[key] = spec.colors.map(color => ({
      normal: createVehicleSprite(key, spec, color, false, spec.ppm),
      brake: createVehicleSprite(key, spec, color, true, spec.ppm),
    }));
  }
  const policeDims = { width: 1.95, height: 1.4 };
  return {
    vehicles,
    player: null, // assigned by the game from the selected garage car
    police: createVehicleSprite('coupe', policeDims, '#e9ecf5', false, 110, { accent: '#2a4bff' }),
    glow: {
      spark: createGlowSprite(32, '255, 190, 90'),
      boost: createGlowSprite(48, PALETTE.CYAN_RGB),
      smoke: createSoftSprite(64, 'rgba(185,180,205,0.9)', 'rgba(150,145,175,0.45)', 'rgba(120,115,150,0)'),
      dust: createSoftSprite(64, 'rgba(220,180,130,0.8)', 'rgba(200,160,110,0.35)', 'rgba(180,140,100,0)'),
      wind: createSoftSprite(32, 'rgba(220,240,255,0.9)', 'rgba(200,230,255,0.3)', 'rgba(200,230,255,0)'),
      debris: createDebrisSprite(),
      amber: createGlowSprite(64, '255, 170, 40'),
      gold: createGlowSprite(96, '255, 211, 90'),
      red: createGlowSprite(64, '255, 40, 60'),
      blue: createGlowSprite(64, '50, 90, 255'),
    },
    lamp: [createGlowSprite(128, PALETTE.PINK_RGB), createGlowSprite(128, PALETTE.CYAN_RGB)],
    pool: [createPoolSprite(PALETTE.PINK_RGB), createPoolSprite(PALETTE.CYAN_RGB)],
    pickup: {
      boost: createPickupSprite('boost'),
      repair: createPickupSprite('repair'),
      credits: createPickupSprite('credits'),
      boostGlow: createGlowSprite(64, PALETTE.CYAN_RGB, false),
      repairGlow: createGlowSprite(64, PALETTE.GREEN_RGB, false),
      creditsGlow: createGlowSprite(64, '255, 211, 90', false),
    },
    props: {
      cone: createConeSprite(),
      arrowSign: createArrowSignSprite(),
      gate: createGateSprite(),
    },
    beam: createBeamSprite(),
    flame: createFlameSprite(),
    underglow: createUnderglowSprite(PALETTE.CYAN_RGB),
  };
}
