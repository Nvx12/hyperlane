// Touch controls built for thumbs (Pointer Events, multi-touch):
//
//   LEFT THUMB   steering zone — hold the left or right half; sliding across the middle switches
//                direction without lifting. With two fingers in the zone the newest one wins.
//   RIGHT THUMB  BRAKE and BOOST buttons (large hit areas, independent of the steering finger).
//
// Every pointer is tracked by id with pointer capture, so STEER + BOOST and STEER + BRAKE work
// simultaneously and a finger that slides off a button still releases it. Nothing here listens
// to hover, and all handlers are passive except where the browser gesture must be cancelled.

export class TouchInput {
  constructor() {
    this.steer = 0; // -1 | 0 | 1 (digital; the InputManager ramps it)
    this.brake = false;
    this.boost = false;
    this.active = false; // a finger has touched the controls this session
    this.onPress = null; // (kind: 'left'|'right'|'brake'|'boost') => void — feedback hooks
    this.onActivity = null;
    this.steerPointers = new Map(); // pointerId -> -1 | 1, insertion order = press order
    this.buttonPointers = new Map(); // pointerId -> 'brake' | 'boost'
    this.zone = null;
    this.zoneRect = null;
  }

  bind(root) {
    if (!root) return;
    this.root = root;
    this.zone = root.querySelector('[data-steer-zone]');
    this.glyphs = {
      [-1]: root.querySelector('[data-steer-glyph="left"]'),
      1: root.querySelector('[data-steer-glyph="right"]'),
    };
    this.buttons = {};
    root.querySelectorAll('[data-touch]').forEach(btn => { this.buttons[btn.dataset.touch] = btn; });

    if (this.zone) {
      const z = this.zone;
      z.addEventListener('pointerdown', e => this.steerDown(e));
      z.addEventListener('pointermove', e => this.steerMove(e));
      z.addEventListener('pointerup', e => this.steerUp(e));
      z.addEventListener('pointercancel', e => this.steerUp(e));
      z.addEventListener('lostpointercapture', e => this.steerUp(e));
    }
    for (const [kind, btn] of Object.entries(this.buttons)) {
      btn.addEventListener('pointerdown', e => this.buttonDown(e, kind));
      const up = e => this.buttonUp(e);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    }
    // Long-press menus, text selection and the iOS magnifier must never appear mid-race.
    root.addEventListener('contextmenu', e => e.preventDefault());
    root.addEventListener('selectstart', e => e.preventDefault());
  }

  capture(e) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture unsupported: pointerup still releases */
    }
  }

  // ---------------------------------------------------------------- steering zone

  sideOf(e) {
    // Rect is cached per press (layout only changes on resize, never mid-touch).
    const r = this.zoneRect;
    return e.clientX < r.left + r.width / 2 ? -1 : 1;
  }

  steerDown(e) {
    e.preventDefault();
    this.capture(e);
    this.zoneRect = this.zone.getBoundingClientRect();
    const side = this.sideOf(e);
    this.steerPointers.delete(e.pointerId);
    this.steerPointers.set(e.pointerId, side);
    this.touched();
    this.updateSteer(true);
  }

  steerMove(e) {
    if (!this.steerPointers.has(e.pointerId)) return;
    const side = this.sideOf(e);
    if (side !== this.steerPointers.get(e.pointerId)) {
      this.steerPointers.set(e.pointerId, side);
      this.updateSteer(true);
    }
  }

  steerUp(e) {
    if (!this.steerPointers.delete(e.pointerId)) return;
    this.updateSteer(false);
  }

  updateSteer(pressed) {
    let side = 0;
    for (const s of this.steerPointers.values()) side = s; // newest finger wins
    if (side !== this.steer) {
      this.steer = side;
      this.glyphs[-1]?.classList.toggle('pressed', side === -1);
      this.glyphs[1]?.classList.toggle('pressed', side === 1);
      if (pressed && side !== 0 && this.onPress) this.onPress(side < 0 ? 'left' : 'right');
    }
  }

  // ---------------------------------------------------------------- buttons

  buttonDown(e, kind) {
    e.preventDefault();
    this.capture(e);
    this.buttonPointers.set(e.pointerId, kind);
    this.touched();
    this.syncButtons();
    if (this.onPress) this.onPress(kind);
  }

  buttonUp(e) {
    if (!this.buttonPointers.delete(e.pointerId)) return;
    this.syncButtons();
  }

  syncButtons() {
    let brake = false;
    let boost = false;
    for (const kind of this.buttonPointers.values()) {
      if (kind === 'brake') brake = true;
      else if (kind === 'boost') boost = true;
    }
    if (brake !== this.brake) this.buttons.brake?.classList.toggle('pressed', brake);
    if (boost !== this.boost) this.buttons.boost?.classList.toggle('pressed', boost);
    this.brake = brake;
    this.boost = boost;
  }

  touched() {
    this.active = true;
    if (this.onActivity) this.onActivity();
  }

  // Drops every held input (pause, blur, orientation change, app backgrounded).
  reset() {
    this.steerPointers.clear();
    this.buttonPointers.clear();
    this.updateSteer(false);
    this.syncButtons();
  }
}
