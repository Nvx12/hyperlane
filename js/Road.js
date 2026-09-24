import { ROAD, CAMERA } from './config.js';
import { DIFFICULTY } from './balance.js';
import { lerpRange } from './utils.js';
import { hash01 } from './Environment.js';

const SEG = ROAD.SEGMENT_LENGTH;
const ANY = -1; // no parity filter
const SLIT = -2; // every 4th segment
const TUNNEL_H = 6.5;
const HILL_H = 26; // height of the ridge a tunnel portal is cut into
const LAMP_EVERY = 8;
const MAX_TUNNELS = 3;

function beginLayer(ctx, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
}

// Segment-based pseudo-3D road. Curves accumulate per segment (OutRun style), so bends
// sweep toward the player. Colors come from the Environment palette; every layer is a single
// batched path, so the whole road costs ~20 fills regardless of draw distance.
export class Road {
  constructor(bank, environment) {
    this.bank = bank;
    this.env = environment;
    this.segCount = Math.ceil(ROAD.DRAW_DISTANCE / SEG) + 1;
    const n = this.segCount + 1;
    this.offsets = new Float32Array(n);
    this.sx = new Float32Array(n);
    this.sy = new Float32Array(n);
    this.sc = new Float32Array(n);
    this.tunnelFlag = new Uint8Array(n);
    this.tunnels = []; // { start, end } absolute segment indices
    this.distance = 0;
    this.baseIndex = 0;
    this.phase = 0;
    this.curveAmp = DIFFICULTY.ROAD_CURVE[0];
    this.playerCurve = 0;
    this.skyOffset = 0;
    this.fog = null;
    this.fogHeight = 0;
    this.fogTop = 0;
    this.fogKey = -1;
    this.fogDensity = 0;
    this.fadeStart = ROAD.DRAW_DISTANCE * 0.72;
    this.pad = 0;
    this.focal = 1;
    this.cx = 0;
    this.camX = 0;
    this.horizonY = 0;
    this.cameraInTunnel = false;
    this.first = 0;
  }

  reset() {
    this.distance = 0;
    this.skyOffset = 0;
    this.tunnels.length = 0;
    this.cameraInTunnel = false;
  }

  // Deterministic curvature per segment index: overlapping sines with a dead zone for straights.
  curveAt(index) {
    const a = Math.sin(index * 0.0131) * 0.62 + Math.sin(index * 0.0047 + 2.1) * 0.5 + Math.sin(index * 0.029 + 0.7) * 0.16;
    if (a > 0.32) return (a - 0.32) * this.curveAmp;
    if (a < -0.32) return (a + 0.32) * this.curveAmp;
    return 0;
  }

  update(dt, speed, difficulty) {
    this.curveAmp = lerpRange(DIFFICULTY.ROAD_CURVE, difficulty);
    this.distance += speed * dt;
    this.playerCurve = this.curveAt(Math.floor((this.distance + CAMERA.PLAYER_DEPTH) / SEG));
    this.skyOffset += this.playerCurve * speed * dt * ROAD.SKY_PARALLAX;
    // Forget tunnels the camera has left behind.
    const camSeg = Math.floor(this.distance / SEG);
    for (let i = this.tunnels.length - 1; i >= 0; i--) if (this.tunnels[i].end < camSeg - 2) this.tunnels.splice(i, 1);
  }

  // Schedules a tunnel starting `ahead` meters in front of the camera.
  addTunnel(ahead, length) {
    if (this.tunnels.length >= MAX_TUNNELS) return false;
    const start = Math.floor((this.distance + ahead) / SEG);
    this.tunnels.push({ start, end: start + Math.ceil(length / SEG) });
    return true;
  }

  isTunnelSegment(abs) {
    const t = this.tunnels;
    for (let i = 0; i < t.length; i++) if (abs >= t[i].start && abs < t[i].end) return true;
    return false;
  }

  // Projects every segment edge once per frame; sprites reuse these values via offsetAt().
  prepare(cam) {
    const n = this.segCount;
    this.baseIndex = Math.floor(this.distance / SEG);
    this.phase = this.distance - this.baseIndex * SEG;
    const near = CAMERA.NEAR_CLIP;
    this.focal = cam.focal;
    this.cx = cam.cx;
    this.camX = cam.x;
    this.horizonY = cam.horizonY;
    let x = 0;
    let dx = -this.curveAt(this.baseIndex) * (this.phase / SEG);
    const hasTunnels = this.tunnels.length > 0;
    for (let i = 0; i <= n; i++) {
      const z = i * SEG - this.phase;
      this.offsets[i] = x;
      dx += this.curveAt(this.baseIndex + i);
      x += dx;
      const s = cam.focal / (z < near ? near : z);
      this.sc[i] = s;
      this.sy[i] = cam.horizonY + CAMERA.HEIGHT * s;
      this.sx[i] = cam.cx + (this.offsets[i] - cam.x) * s;
      this.tunnelFlag[i] = hasTunnels && this.isTunnelSegment(this.baseIndex + i) ? 1 : 0;
    }
    this.cameraInTunnel = this.tunnelFlag[1] === 1;
    let first = 0;
    while (first < n - 1 && this.sy[first + 1] >= cam.height + 40) first++;
    this.first = first;
  }

  // Lateral road-center offset (meters) at camera depth z.
  offsetAt(z) {
    const f = (z + this.phase) / SEG;
    if (f <= 0) return this.offsets[0];
    const i = f | 0;
    if (i >= this.segCount) return this.offsets[this.segCount];
    return this.offsets[i] + (this.offsets[i + 1] - this.offsets[i]) * (f - i);
  }

  resize(ctx, cam) {
    this.pad = Math.ceil(cam.width * 0.2);
    this.fogKey = -1;
  }

  // Rebuilds the horizon fog gradient only when color or density actually change
  // (compared as one packed number, so the per-frame check allocates nothing).
  setFog(ctx, cam, fogRgb, density) {
    const key = (((fogRgb[0] | 0) * 256 + (fogRgb[1] | 0)) * 256 + (fogRgb[2] | 0)) * 64 + Math.round(density * 20) + cam.height * 1e9;
    this.fogDensity = density;
    this.fadeStart = ROAD.DRAW_DISTANCE * (0.72 - 0.42 * density);
    if (key === this.fogKey) return;
    this.fogKey = key;
    const c = `${fogRgb[0] | 0},${fogRgb[1] | 0},${fogRgb[2] | 0}`;
    this.fogHeight = (cam.height - cam.horizonY) * (0.2 + 0.55 * density);
    const top = cam.horizonY - 34 - 60 * density;
    const g = ctx.createLinearGradient(0, top, 0, cam.horizonY + this.fogHeight);
    const peak = (cam.horizonY - top) / (cam.horizonY + this.fogHeight - top);
    g.addColorStop(0, `rgba(${c},0)`);
    g.addColorStop(peak, `rgba(${c},${0.95})`);
    g.addColorStop(Math.min(0.99, peak + (1 - peak) * 0.5), `rgba(${c},${0.35 + 0.4 * density})`);
    g.addColorStop(1, `rgba(${c},0)`);
    this.fog = g;
    this.fogTop = top;
  }

  // ---------------------------------------------------------------- geometry builders

  segmentPasses(abs, filter, shift) {
    if (filter === ANY) return true;
    if (filter === SLIT) return (abs & 3) === 0;
    return (abs >> shift & 1) === filter;
  }

  // Horizontal strip (road markings, ceilings) at `height` meters, one quad per segment.
  addStrip(ctx, from, to, lateral, half, filter, shift, height = 0, tunnel = -1) {
    const { sx, sy, sc, baseIndex, tunnelFlag } = this;
    for (let i = from; i < to; i++) {
      if (tunnel >= 0 && tunnelFlag[i] !== tunnel) continue;
      if (!this.segmentPasses(baseIndex + i, filter, shift)) continue;
      if (sy[i] <= sy[i + 1]) continue;
      const s1 = sc[i];
      const s2 = sc[i + 1];
      const y1 = sy[i] - height * s1;
      const y2 = sy[i + 1] - height * s2;
      const x1 = sx[i] + lateral * s1;
      const x2 = sx[i + 1] + lateral * s2;
      const w1 = half * s1;
      const w2 = half * s2;
      ctx.moveTo(x1 - w1, y1);
      ctx.lineTo(x1 + w1, y1);
      ctx.lineTo(x2 + w2, y2);
      ctx.lineTo(x2 - w2, y2);
      ctx.closePath();
    }
  }

  // Vertical quad between two heights (meters) at a lateral position.
  addWall(ctx, from, to, lateral, h0, h1, filter, shift, tunnel = -1) {
    const { sx, sy, sc, baseIndex, tunnelFlag } = this;
    for (let i = from; i < to; i++) {
      if (tunnel >= 0 && tunnelFlag[i] !== tunnel) continue;
      if (!this.segmentPasses(baseIndex + i, filter, shift)) continue;
      if (sy[i] <= sy[i + 1]) continue;
      const s1 = sc[i];
      const s2 = sc[i + 1];
      const xa = sx[i] + lateral * s1;
      const xb = sx[i + 1] + lateral * s2;
      ctx.moveTo(xa, sy[i] - h0 * s1);
      ctx.lineTo(xa, sy[i] - h1 * s1);
      ctx.lineTo(xb, sy[i + 1] - h1 * s2);
      ctx.lineTo(xb, sy[i + 1] - h0 * s2);
      ctx.closePath();
    }
  }

  // Short objects that occupy part of a segment (lane reflectors, guardrail posts).
  addShort(ctx, from, to, lateral, half, h0, h1, offset, length, every) {
    const near = CAMERA.NEAR_CLIP + 0.5;
    for (let i = from; i < to; i++) {
      if (this.tunnelFlag[i]) continue;
      if (((this.baseIndex + i) % every) !== 0) continue;
      const z0 = i * SEG - this.phase + offset;
      const z1 = z0 + length;
      if (z0 < near) continue;
      const s0 = this.focal / z0;
      const s1 = this.focal / z1;
      const x0 = this.cx + (lateral + this.offsetAt(z0) - this.camX) * s0;
      const x1 = this.cx + (lateral + this.offsetAt(z1) - this.camX) * s1;
      const y0 = this.horizonY + CAMERA.HEIGHT * s0;
      const y1 = this.horizonY + CAMERA.HEIGHT * s1;
      if (h1 === 0) {
        ctx.moveTo(x0 - half * s0, y0);
        ctx.lineTo(x0 + half * s0, y0);
        ctx.lineTo(x1 + half * s1, y1);
        ctx.lineTo(x1 - half * s1, y1);
      } else {
        ctx.moveTo(x0 - half * s0, y0 - h0 * s0);
        ctx.lineTo(x0 + half * s0, y0 - h0 * s0);
        ctx.lineTo(x0 + half * s0, y0 - h1 * s0);
        ctx.lineTo(x0 - half * s0, y0 - h1 * s0);
      }
      ctx.closePath();
    }
  }

  // ---------------------------------------------------------------- rendering

  // Tunnels need correct occlusion: everything beyond the first visible tunnel boundary is
  // drawn first, then the portal (for an entrance), then the near part.
  render(ctx, cam) {
    const first = this.first;
    const n = this.segCount;
    let split = -1;
    let entrance = false;
    for (let i = Math.max(first + 1, 1); i < n; i++) {
      if (this.tunnelFlag[i] !== this.tunnelFlag[i - 1]) {
        split = i;
        entrance = this.tunnelFlag[i] === 1;
        break;
      }
    }
    if (split > 0) {
      this.renderRange(ctx, cam, split, n);
      if (entrance) this.renderPortal(ctx, cam, split);
      this.renderRange(ctx, cam, first, split);
    } else {
      this.renderRange(ctx, cam, first, n);
    }
  }

  renderRange(ctx, cam, from, to) {
    const P = this.env.palette;
    const W = cam.width;
    const pad = this.pad;
    const { sy, baseIndex } = this;

    for (let pass = 0; pass < 2; pass++) {
      beginLayer(ctx, pass ? P.groundB : P.groundA);
      for (let i = from; i < to; i++) {
        if (((baseIndex + i) >> 1 & 1) !== pass) continue;
        const y1 = sy[i];
        const y2 = sy[i + 1];
        if (y1 <= y2) continue;
        ctx.rect(-pad, y2, W + pad * 2, y1 - y2 + 0.6);
      }
      ctx.fill();
    }

    const half = ROAD.HALF_WIDTH;
    const rw = ROAD.RUMBLE_WIDTH / 2;
    const edgeX = half - ROAD.EDGE_LINE_INSET;

    beginLayer(ctx, P.shoulder);
    this.addStrip(ctx, from, to, 0, ROAD.EDGE, ANY, 0);
    ctx.fill();
    for (let pass = 0; pass < 2; pass++) {
      beginLayer(ctx, pass ? P.rumbleB : P.rumbleA);
      this.addStrip(ctx, from, to, -(half + rw), rw, pass, 0);
      this.addStrip(ctx, from, to, half + rw, rw, pass, 0);
      ctx.fill();
      beginLayer(ctx, pass ? P.roadB : P.roadA);
      this.addStrip(ctx, from, to, 0, half, pass, 1);
      ctx.fill();
    }
    beginLayer(ctx, P.edgeGlow);
    this.addStrip(ctx, from, to, -edgeX, 0.32, ANY, 0);
    this.addStrip(ctx, from, to, edgeX, 0.32, ANY, 0);
    ctx.fill();
    beginLayer(ctx, P.edge);
    this.addStrip(ctx, from, to, -edgeX, 0.08, ANY, 0);
    this.addStrip(ctx, from, to, edgeX, 0.08, ANY, 0);
    ctx.fill();
    beginLayer(ctx, P.laneGlow);
    for (let l = 1; l < ROAD.LANES; l++) this.addStrip(ctx, from, to, -half + l * ROAD.LANE_WIDTH, 0.3, 0, 0);
    ctx.fill();
    beginLayer(ctx, P.lane);
    for (let l = 1; l < ROAD.LANES; l++) this.addStrip(ctx, from, to, -half + l * ROAD.LANE_WIDTH, 0.075, 0, 0);
    ctx.fill();
    // Lane reflectors in the dash gaps near the camera: small, bright, fast-moving speed cues.
    beginLayer(ctx, P.marker);
    const markerEnd = Math.min(to, ROAD.MARKER_RANGE);
    for (let l = 1; l < ROAD.LANES; l++) this.addShort(ctx, from, markerEnd, -half + l * ROAD.LANE_WIDTH, 0.11, 0, 0, SEG + 2.2, 0.45, 2);
    ctx.fill();

    this.renderBarriers(ctx, from, to, P);
    this.renderTunnelInterior(ctx, from, to, P);
    this.renderRoadside(ctx, cam, from, to);
  }

  renderBarriers(ctx, from, to, P) {
    const style = this.env.env.wall;
    const wallX = ROAD.EDGE + 0.05;
    const wh = style === 'neon' ? ROAD.WALL_HEIGHT : style === 'low' ? 0.55 : 0.8;
    if (style === 'guardrail') {
      beginLayer(ctx, P.wallA);
      this.addShort(ctx, from, to, -wallX, 0.07, 0, wh, 0, 0.2, 1);
      this.addShort(ctx, from, to, wallX, 0.07, 0, wh, 0, 0.2, 1);
      ctx.fill();
      beginLayer(ctx, P.wallTop);
      this.addWall(ctx, from, to, -wallX, wh - 0.3, wh - 0.05, ANY, 0, 0);
      this.addWall(ctx, from, to, wallX, wh - 0.3, wh - 0.05, ANY, 0, 0);
      ctx.fill();
      return;
    }
    for (let pass = 0; pass < 2; pass++) {
      beginLayer(ctx, pass ? P.wallB : P.wallA);
      this.addWall(ctx, from, to, -wallX, 0, wh, pass, 1, 0);
      this.addWall(ctx, from, to, wallX, 0, wh, pass, 1, 0);
      ctx.fill();
    }
    if (style === 'neon') {
      beginLayer(ctx, P.wallGlow);
      this.addWall(ctx, from, to, -wallX, wh - 0.3, wh + 0.18, ANY, 0, 0);
      this.addWall(ctx, from, to, wallX, wh - 0.3, wh + 0.18, ANY, 0, 0);
      ctx.fill();
    }
    beginLayer(ctx, P.wallTop);
    this.addWall(ctx, from, to, -wallX, wh - 0.09, wh, ANY, 0, 0);
    this.addWall(ctx, from, to, wallX, wh - 0.09, wh, ANY, 0, 0);
    ctx.fill();
    if (P.slit) {
      beginLayer(ctx, P.slit);
      this.addWall(ctx, from, to, -wallX, 0.32, 0.46, SLIT, 0, 0);
      this.addWall(ctx, from, to, wallX, 0.32, 0.46, SLIT, 0, 0);
      ctx.fill();
    }
  }

  renderTunnelInterior(ctx, from, to, P) {
    if (this.tunnels.length === 0) return;
    const wallX = ROAD.EDGE + 0.05;
    for (let pass = 0; pass < 2; pass++) {
      beginLayer(ctx, pass ? P.wallB : P.tunnel);
      this.addWall(ctx, from, to, -wallX, 0, TUNNEL_H, pass, 1, 1);
      this.addWall(ctx, from, to, wallX, 0, TUNNEL_H, pass, 1, 1);
      if (pass === 0) this.addStrip(ctx, from, to, 0, wallX, ANY, 0, TUNNEL_H, 1);
      ctx.fill();
    }
    // Ceiling light strips and wall light bands rushing past.
    beginLayer(ctx, P.tunnelLight);
    this.addStrip(ctx, from, to, -2.2, 0.25, 0, 0, TUNNEL_H - 0.02, 1);
    this.addStrip(ctx, from, to, 2.2, 0.25, 0, 0, TUNNEL_H - 0.02, 1);
    this.addWall(ctx, from, to, -wallX, 2.1, 2.3, 0, 0, 1);
    this.addWall(ctx, from, to, wallX, 2.1, 2.3, 0, 0, 1);
    ctx.fill();
  }

  // A ridge/structure with an opening the road disappears into.
  renderPortal(ctx, cam, i) {
    const s = this.sc[i];
    const x = this.sx[i];
    const y = this.sy[i];
    const halfW = (ROAD.EDGE + 0.05) * s;
    const W = cam.width;
    const pad = this.pad;
    ctx.fillStyle = this.env.palette.tunnel;
    ctx.beginPath();
    ctx.rect(-pad, y - HILL_H * s, W + pad * 2, HILL_H * s + 1);
    ctx.rect(x - halfW, y - TUNNEL_H * s, halfW * 2, TUNNEL_H * s + 1);
    ctx.fill('evenodd');
    ctx.fillStyle = this.env.palette.tunnelLight;
    ctx.fillRect(x - halfW - 0.4 * s, y - TUNNEL_H * s - 0.5 * s, halfW * 2 + 0.8 * s, Math.max(1, 0.3 * s));
  }

  // Street lamps, palms, cacti, pines, billboards and reflector posts — far to near, per segment,
  // so props always overlap in the right order.
  renderRoadside(ctx, cam, from, to) {
    const props = this.env.env.props;
    const hasLamps = props.includes('lamps');
    const camH = CAMERA.HEIGHT;
    const fadeStart = this.fadeStart;
    const range = ROAD.DRAW_DISTANCE - fadeStart;
    const lampAlpha = this.env.lampAlpha;
    const poleX = ROAD.EDGE + ROAD.POLE_OFFSET;
    const lampX = poleX - ROAD.POLE_ARM;
    const lo = Math.max(from, 1);

    if (hasLamps && lampAlpha > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = to - 1; i >= lo; i--) {
        const abs = this.baseIndex + i;
        if (abs % LAMP_EVERY !== 0 || this.tunnelFlag[i]) continue;
        const z = i * SEG - this.phase;
        if (z < 3) continue;
        const s = this.sc[i];
        const y = this.sy[i];
        const off = this.offsets[i];
        const pw = 11 * s;
        const ph = Math.min(pw * 0.6, (camH * 9 * s) / z);
        const fade = z > fadeStart ? Math.max(0, 1 - (z - fadeStart) / range) : 1;
        ctx.globalAlpha = 0.6 * fade * lampAlpha * (1 + this.env.wet * 0.6);
        const pool = this.bank.pool[(abs / LAMP_EVERY) & 1];
        for (let side = -1; side <= 1; side += 2) {
          const lx = cam.cx + (side * lampX + off - cam.x) * s;
          ctx.drawImage(pool, lx - pw / 2, y - ph / 2, pw, ph);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
    }

    const envProps = this.env.props;
    for (let i = to - 1; i >= lo; i--) {
      if (this.tunnelFlag[i]) continue;
      const abs = this.baseIndex + i;
      const z = i * SEG - this.phase;
      if (z < 3) continue;
      const s = this.sc[i];
      const y = this.sy[i];
      const off = this.offsets[i];
      ctx.globalAlpha = z > fadeStart ? Math.max(0, 1 - (z - fadeStart) / range) : 1;
      for (let p = 0; p < props.length; p++) {
        switch (props[p]) {
          case 'lamps':
            if (abs % LAMP_EVERY === 0) this.drawLampPole(ctx, cam, s, y, off, poleX, lampX);
            break;
          case 'billboards':
            if (abs % 60 === 23) {
              const side = (abs / 60) & 1 ? 1 : -1;
              this.drawSprite(ctx, cam, envProps.billboards[(abs / 60 | 0) % envProps.billboards.length], s, y, off, side * (ROAD.EDGE + 7), 11, 7.6);
            }
            break;
          case 'palms':
            if (abs % 5 === 2) for (let side = -1; side <= 1; side += 2) {
              const h = hash01(abs * 2 + side);
              if (h < 0.25) continue;
              this.drawSprite(ctx, cam, envProps.palm, s, y, off, side * (ROAD.EDGE + 2.8 + h * 4), 5.5, 8.5);
            }
            break;
          case 'cacti':
            if (abs % 7 === 3) {
              const h = hash01(abs);
              const side = h < 0.5 ? -1 : 1;
              this.drawSprite(ctx, cam, envProps.cactus, s, y, off, side * (ROAD.EDGE + 3 + h * 14), 2.3, 4.2);
            }
            break;
          case 'pines':
            if (abs % 2 === 1) for (let side = -1; side <= 1; side += 2) {
              const h = hash01(abs * 3 + side);
              if (h < 0.3) continue;
              this.drawSprite(ctx, cam, envProps.pine, s, y, off, side * (ROAD.EDGE + 2.5 + h * 9), 4.2, 9.5);
            }
            break;
          case 'posts':
            if (abs % 4 === 0) for (let side = -1; side <= 1; side += 2) {
              this.drawSprite(ctx, cam, envProps.post, s, y, off, side * (ROAD.EDGE + 0.6), 0.28, 1.12);
            }
            break;
          default:
            break;
        }
      }
    }
    ctx.globalAlpha = 1;

    if (hasLamps && lampAlpha > 0.05) {
      ctx.globalCompositeOperation = 'lighter';
      for (let i = to - 1; i >= lo; i--) {
        const abs = this.baseIndex + i;
        if (abs % LAMP_EVERY !== 0 || this.tunnelFlag[i]) continue;
        const z = i * SEG - this.phase;
        if (z < 3) continue;
        const s = this.sc[i];
        const top = this.sy[i] - ROAD.POLE_HEIGHT * s;
        const lamp = this.bank.lamp[(abs / LAMP_EVERY) & 1];
        const r = Math.min(2.4 * s, cam.height * 0.25);
        ctx.globalAlpha = (z > fadeStart ? Math.max(0, 1 - (z - fadeStart) / range) : 1) * lampAlpha;
        for (let side = -1; side <= 1; side += 2) {
          const ax = cam.cx + (side * lampX + this.offsets[i] - cam.x) * s;
          ctx.drawImage(lamp, ax - r, top - r * 0.9, r * 2, r * 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  drawLampPole(ctx, cam, s, y, off, poleX, lampX) {
    const top = y - ROAD.POLE_HEIGHT * s;
    ctx.strokeStyle = '#221a3a';
    ctx.lineWidth = Math.max(1, 0.22 * s);
    ctx.beginPath();
    for (let side = -1; side <= 1; side += 2) {
      const bx = cam.cx + (side * poleX + off - cam.x) * s;
      const ax = cam.cx + (side * lampX + off - cam.x) * s;
      ctx.moveTo(bx, y);
      ctx.lineTo(bx, top);
      ctx.lineTo(ax, top - 0.25 * s);
    }
    ctx.stroke();
  }

  drawSprite(ctx, cam, img, s, y, off, lateral, widthM, heightM) {
    const w = widthM * s;
    const h = heightM * s;
    const x = cam.cx + (lateral + off - cam.x) * s;
    if (x + w < -this.pad || x - w > cam.width + this.pad) return;
    ctx.drawImage(img, x - w / 2, y - h, w, h);
  }

  renderFog(ctx, cam) {
    if (!this.fog) return;
    ctx.fillStyle = this.fog;
    ctx.fillRect(-this.pad, this.fogTop, cam.width + this.pad * 2, cam.horizonY + this.fogHeight - this.fogTop);
  }
}
