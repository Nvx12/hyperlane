// Gamepad support (standard mapping: Xbox / PlayStation / most modern pads).
// Polled once per frame from the game loop; allocation-free on the hot path.
//
//   Left stick / D-pad   steer (analog) · navigate menus
//   RT / R2              accelerate          LT / L2   brake
//   A / Cross            boost · confirm     B / Circle   back
//   Start / Options      pause

const BTN = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
const DEADZONE = 0.2;
const TRIGGER_ON = 0.25;
const NAV_THRESHOLD = 0.6;
const NAV_DELAY = 0.38; // first auto-repeat of a held direction
const NAV_REPEAT = 0.13;

const EDGE_BUTTONS = [BTN.A, BTN.B, BTN.START, BTN.SELECT];

function pressed(pad, i) {
  const b = pad.buttons[i];
  return Boolean(b && (b.pressed || b.value > 0.5));
}

function value(pad, i) {
  const b = pad.buttons[i];
  return b ? (typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0) : 0;
}

export class GamepadInput {
  constructor() {
    this.index = -1;
    this.connected = false;
    this.steer = 0;
    this.throttle = false;
    this.brake = false;
    this.boost = false;
    this.lastUsed = 0; // performance.now() of the last meaningful pad input
    this.onConnect = null; // (id) => void
    this.onDisconnect = null; // () => void
    this.onButton = null; // ('confirm' | 'back' | 'pause' | 'select') => void
    this.onNavigate = null; // ('up' | 'down' | 'left' | 'right') => void

    this.prev = new Uint8Array(16);
    this.navDir = '';
    this.navTimer = 0;
    this.supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function';
    if (!this.supported) return;

    window.addEventListener('gamepadconnected', e => {
      if (this.index < 0) this.attach(e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', e => {
      if (e.gamepad.index !== this.index) return;
      this.detach();
      // Another pad may still be plugged in.
      const next = this.findPad();
      if (next) this.attach(next, true);
    });
  }

  attach(pad, silent = false) {
    this.index = pad.index;
    this.connected = true;
    // Buttons held while connecting (e.g. the button that woke the pad) must not fire.
    for (let i = 0; i < this.prev.length; i++) this.prev[i] = pressed(pad, i) ? 1 : 0;
    if (!silent && this.onConnect) this.onConnect(pad.id);
  }

  detach() {
    this.index = -1;
    this.connected = false;
    this.clearHeld();
    if (this.onDisconnect) this.onDisconnect();
  }

  findPad() {
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  clearHeld() {
    this.steer = 0;
    this.throttle = false;
    this.brake = false;
    this.boost = false;
    this.navDir = '';
  }

  // Rumble on supporting browsers/pads. Silently ignored elsewhere.
  rumble(strength, ms) {
    if (!this.connected) return;
    const pad = navigator.getGamepads()[this.index];
    const act = pad && pad.vibrationActuator;
    if (!act || !act.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: strength, weakMagnitude: strength * 0.6 }).catch(() => {});
  }

  poll(dt) {
    if (!this.supported) return;
    if (this.index < 0) {
      // Chrome only fires gamepadconnected after a button press; some browsers never do.
      return;
    }
    const pad = navigator.getGamepads()[this.index];
    if (!pad || !pad.connected) return;

    // Analog steering with a rescaled deadzone; the D-pad overrides with full lock.
    const x = pad.axes.length > 0 ? pad.axes[0] : 0;
    const ax = Math.abs(x);
    let steer = ax < DEADZONE ? 0 : (Math.sign(x) * (ax - DEADZONE)) / (1 - DEADZONE);
    if (pressed(pad, BTN.LEFT)) steer = -1;
    else if (pressed(pad, BTN.RIGHT)) steer = 1;
    this.steer = steer;
    this.throttle = value(pad, BTN.RT) > TRIGGER_ON;
    this.brake = value(pad, BTN.LT) > TRIGGER_ON;
    this.boost = pressed(pad, BTN.A) || pressed(pad, BTN.RB);
    if (steer !== 0 || this.throttle || this.brake || this.boost) this.lastUsed = performance.now();

    // Edge-triggered buttons.
    for (let k = 0; k < EDGE_BUTTONS.length; k++) {
      const i = EDGE_BUTTONS[k];
      const now = pressed(pad, i) ? 1 : 0;
      if (now && !this.prev[i]) {
        this.lastUsed = performance.now();
        if (this.onButton) {
          this.onButton(i === BTN.A ? 'confirm' : i === BTN.B ? 'back' : i === BTN.START ? 'pause' : 'select');
        }
      }
      this.prev[i] = now;
    }

    // Menu navigation: D-pad or left stick, with keyboard-like auto-repeat.
    const y = pad.axes.length > 1 ? pad.axes[1] : 0;
    let dir = '';
    if (pressed(pad, BTN.UP) || y < -NAV_THRESHOLD) dir = 'up';
    else if (pressed(pad, BTN.DOWN) || y > NAV_THRESHOLD) dir = 'down';
    else if (pressed(pad, BTN.LEFT) || x < -NAV_THRESHOLD) dir = 'left';
    else if (pressed(pad, BTN.RIGHT) || x > NAV_THRESHOLD) dir = 'right';
    if (!dir) {
      this.navDir = '';
    } else if (dir !== this.navDir) {
      this.navDir = dir;
      this.navTimer = NAV_DELAY;
      this.lastUsed = performance.now();
      if (this.onNavigate) this.onNavigate(dir);
    } else {
      this.navTimer -= dt;
      if (this.navTimer <= 0) {
        this.navTimer = NAV_REPEAT;
        if (this.onNavigate) this.onNavigate(dir);
      }
    }
  }
}
