import { GamepadInput } from './GamepadInput.js';
import { moveFocus, activateFocused } from './FocusNav.js';

const KEY_ACTIONS = {
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  ArrowUp: 'throttle',
  KeyW: 'throttle',
  ArrowDown: 'brake',
  KeyS: 'brake',
  Space: 'boost',
};

const isTextField = el => el instanceof HTMLElement
  && (el.isContentEditable || el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(el.type)));

// One set of driving actions (steer / throttle / brake / boost) fed by keyboard, touch and
// gamepad, plus edge-triggered callbacks for menu actions. The game only reads the getters.
export class InputManager {
  constructor() {
    this.keys = { left: false, right: false, throttle: false, brake: false, boost: false };
    this.touch = { left: false, right: false, brake: false, boost: false };
    this.touchMode = false; // touch players get automatic throttle
    this.method = 'keyboard'; // last used: keyboard | touch | gamepad (drives on-screen hints)
    this.onPause = null;
    this.onConfirm = null;
    this.onMute = null;
    this.onToggleFps = null;
    this.onGarage = null;
    this.onFirstInteraction = null;
    this.onMethodChange = null;
    this.onPadConnect = null;
    this.onPadDisconnect = null;
    this.isRacing = () => false;

    this.pad = new GamepadInput();
    this.pad.onConnect = id => {
      this.setMethod('gamepad');
      if (this.onPadConnect) this.onPadConnect(id);
    };
    this.pad.onDisconnect = () => {
      if (this.method === 'gamepad') this.setMethod('keyboard');
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
      } else {
        this.setMethod('keyboard');
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

  setMethod(method) {
    if (this.method === method) return;
    this.method = method;
    if (method !== 'touch' && method !== 'gamepad') this.touchMode = false;
    if (method === 'gamepad') this.touchMode = false;
    document.body.classList.toggle('pad-active', method === 'gamepad');
    if (this.onMethodChange) this.onMethodChange(method);
  }

  // Called once per frame by the game loop (also while paused, so the pad can resume).
  poll(dt) {
    if (!this.pad.connected) return;
    this.pad.poll(dt);
    if (this.method !== 'gamepad' && performance.now() - this.pad.lastUsed < 50) this.setMethod('gamepad');
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
    // Typing in a text field (racer name) must not steer, mute or open menus.
    if (isTextField(e.target)) {
      if (e.code === 'Escape') e.target.blur();
      return;
    }
    const action = KEY_ACTIONS[e.code];
    if (action) {
      this.keys[action] = true;
      e.preventDefault();
    }
    this.setMethod('keyboard');
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

  bindTouchControls(root) {
    if (!root) return;
    root.querySelectorAll('[data-touch]').forEach(btn => {
      const action = btn.dataset.touch;
      const release = () => {
        this.touch[action] = false;
        btn.classList.remove('pressed');
      };
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        this.touchMode = true;
        this.setMethod('touch');
        this.touch[action] = true;
        btn.classList.add('pressed');
        try {
          btn.setPointerCapture(e.pointerId);
        } catch {
          /* capture unsupported — pointerup still releases */
        }
      });
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('lostpointercapture', release);
      btn.addEventListener('contextmenu', e => e.preventDefault());
    });
  }

  reset() {
    for (const k in this.keys) this.keys[k] = false;
    for (const k in this.touch) this.touch[k] = false;
    this.pad.clearHeld();
  }

  rumble(strength, ms) {
    if (this.method === 'gamepad') this.pad.rumble(strength, ms);
  }

  get steer() {
    const digital = (this.keys.right || this.touch.right ? 1 : 0) - (this.keys.left || this.touch.left ? 1 : 0);
    return digital !== 0 ? digital : this.pad.steer;
  }

  get throttle() {
    return this.keys.throttle || this.touchMode || this.pad.throttle;
  }

  get brake() {
    return this.keys.brake || this.touch.brake || this.pad.brake;
  }

  get boost() {
    return this.keys.boost || this.touch.boost || this.pad.boost;
  }
}
