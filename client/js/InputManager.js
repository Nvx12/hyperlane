import { GamepadInput } from './GamepadInput.js';
import { TouchInput } from './TouchInput.js';
import { TiltInput } from './TiltInput.js';
import { moveFocus, activateFocused } from './FocusNav.js';

// Keyboard remains for development and testing only: it works, but no screen ever mentions it.
const KEY_ACTIONS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'boost',
};

// Digital steering (touch / keyboard) is ramped instead of snapping to full lock: a quick tap is a
// gentle correction, a hold reaches full lock in ~0.17 s at sensitivity 1. Releases and direction
// flips pass through zero quickly so the car straightens without drifting.
const STEER_RAMP = 6; // per second at sensitivity 1
const STEER_RELEASE = 14;

const isTextField = el => el instanceof HTMLElement
  && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type)));

// One set of driving actions (steer / brake / boost; acceleration is automatic) fed by touch,
// optional tilt, and — for development or a connected controller — keyboard and gamepad.
// The game only reads the getters.
export class InputManager {
  constructor() {
    this.keys = { left: false, right: false, brake: false, boost: false };
    this.touch = new TouchInput();
    this.tilt = new TiltInput();
    this.steering = 'touch'; // settings: touch | tilt
    this.sensitivity = 1;
    this.steerValue = 0;
    this.touchMode = false; // a finger has been used this session
    this.method = 'touch'; // last used: touch | keyboard | gamepad (gamepad shows its own hints)
    this.onPause = null;
    this.onConfirm = null;
    this.onMute = null;
    this.onToggleFps = null;
    this.onGarage = null;
    this.onFirstInteraction = null;
    this.onMethodChange = null;
    this.onPadConnect = null;
    this.onPadDisconnect = null;
    this.onControlPress = null; // (kind) => void: haptics / audio feedback for touch presses
    this.isRacing = () => false;

    this.touch.onActivity = () => {
      this.touchMode = true;
      this.setMethod('touch');
    };
    this.touch.onPress = kind => {
      if (this.onControlPress) this.onControlPress(kind);
    };

    this.pad = new GamepadInput();
    this.pad.onConnect = id => {
      this.setMethod('gamepad');
      if (this.onPadConnect) this.onPadConnect(id);
    };
    this.pad.onDisconnect = () => {
      if (this.method === 'gamepad') this.setMethod('touch');
      if (this.onPadDisconnect) this.onPadDisconnect();
    };
    this.pad.onButton = btn => this.handlePadButton(btn);
    this.pad.onNavigate = dir => {
      this.setMethod('gamepad');
      if (!this.isRacing()) moveFocus(dir);
    };

    window.addEventListener('keydown', e => this.handleKeyDown(e));
    window.addEventListener('keyup', e => this.handleKeyUp(e));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') {
        this.touchMode = true;
        this.setMethod('touch');
      }
      if (this.onFirstInteraction) this.onFirstInteraction();
    }, { passive: true });
    // iOS Safari ignores user-scalable=no; block pinch and double-tap zoom on the game.
    const noZoom = e => e.preventDefault();
    document.addEventListener('gesturestart', noZoom);
    document.addEventListener('dblclick', e => {
      if (!e.target.closest('input, select, textarea')) e.preventDefault();
    });
  }

  bindTouchControls(root) {
    this.touch.bind(root);
  }

  // settings: { steering, sensitivity, tiltCenter }
  configure(settings) {
    this.sensitivity = settings.sensitivity;
    this.tilt.sensitivity = settings.sensitivity;
    this.tilt.center = settings.tiltCenter;
    this.steering = settings.steering;
    if (this.steering !== 'tilt' && this.tilt.active) this.tilt.stop();
    document.body.classList.toggle('tilt-steering', this.usingTilt);
  }

  get usingTilt() {
    return this.steering === 'tilt' && this.tilt.active;
  }

  // Starts the sensor (call from a user gesture). Resolves 'ok' or a reason to fall back to touch.
  async enableTilt() {
    const result = await this.tilt.start();
    document.body.classList.toggle('tilt-steering', this.usingTilt);
    return result;
  }

  setMethod(method) {
    if (this.method === method) return;
    this.method = method;
    document.body.classList.toggle('pad-active', method === 'gamepad');
    if (this.onMethodChange) this.onMethodChange(method);
  }

  // Called once per frame by the game loop (also while paused, so the pad can resume).
  poll(dt) {
    if (this.pad.connected) {
      this.pad.poll(dt);
      if (this.method !== 'gamepad' && performance.now() - this.pad.lastUsed < 50) this.setMethod('gamepad');
    }
    this.tilt.update(dt);

    // Analog sources are used as-is; digital ones are ramped.
    if (this.pad.connected && this.pad.steer !== 0) {
      this.steerValue = this.pad.steer;
      return;
    }
    const digital = this.touch.steer !== 0 ? this.touch.steer : (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
    if (digital === 0 && this.usingTilt) {
      this.steerValue = this.tilt.steer;
      return;
    }
    const s = this.sensitivity;
    const target = digital * Math.min(1, 0.8 + 0.2 * s);
    const v = this.steerValue;
    const growing = target !== 0 && Math.sign(target) === Math.sign(v || target) && Math.abs(target) > Math.abs(v);
    const rate = (growing ? STEER_RAMP * s : STEER_RELEASE) * dt;
    this.steerValue = v < target ? Math.min(target, v + rate) : Math.max(target, v - rate);
  }

  handlePadButton(btn) {
    this.setMethod('gamepad');
    if (this.onFirstInteraction) this.onFirstInteraction();
    const racing = this.isRacing();
    switch (btn) {
      case 'pause':
        if (this.onPause) this.onPause();
        break;
      case 'back':
        if (!racing && this.onPause) this.onPause();
        break;
      case 'confirm':
        // During a race A is boost (read as held state); elsewhere it presses the focused control.
        if (!racing && !activateFocused() && this.onConfirm) this.onConfirm();
        break;
      default:
        break;
    }
  }

  handleKeyDown(e) {
    // Typing in a text field (racer name) must not steer or trigger shortcuts.
    if (isTextField(e.target)) {
      if (e.code === 'Escape') e.target.blur();
      return;
    }
    const action = KEY_ACTIONS[e.code];
    if (action) {
      this.keys[action] = true;
      e.preventDefault();
    }
    if (this.onFirstInteraction) this.onFirstInteraction();
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyP':
      case 'Escape':
        if (this.onPause) this.onPause();
        break;
      case 'Enter':
      case 'NumpadEnter':
        // A focused button already handles Enter as a click.
        if (!(document.activeElement instanceof HTMLButtonElement) && this.onConfirm) this.onConfirm();
        break;
      case 'KeyM':
        if (this.onMute) this.onMute();
        break;
      case 'KeyG':
        if (this.onGarage) this.onGarage();
        break;
      case 'KeyF':
        if (this.onToggleFps) this.onToggleFps();
        break;
      default:
        break;
    }
  }

  handleKeyUp(e) {
    const action = KEY_ACTIONS[e.code];
    if (action) this.keys[action] = false;
  }

  reset() {
    for (const k in this.keys) this.keys[k] = false;
    this.touch.reset();
    this.pad.clearHeld();
    this.steerValue = 0;
  }

  rumble(strength, ms) {
    if (this.method === 'gamepad') this.pad.rumble(strength, ms);
  }

  get steer() {
    return this.steerValue;
  }

  // Acceleration is automatic: the player's job is steering, braking, boosting and risk.
  get throttle() {
    return true;
  }

  get brake() {
    return this.keys.brake || this.touch.brake || this.pad.brake;
  }

  get boost() {
    return this.keys.boost || this.touch.boost || this.pad.boost;
  }
}
