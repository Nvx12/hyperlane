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

// Held state for driving, plus edge-triggered callbacks for menu actions.
export class InputManager {
  constructor() {
    this.keys = { left: false, right: false, throttle: false, brake: false, boost: false };
    this.touch = { left: false, right: false, brake: false, boost: false };
    this.touchMode = false; // touch players get automatic throttle
    this.onPause = null;
    this.onConfirm = null;
    this.onMute = null;
    this.onToggleFps = null;
    this.onGarage = null;
    this.onFirstInteraction = null;

    window.addEventListener('keydown', e => this.handleKeyDown(e));
    window.addEventListener('keyup', e => this.handleKeyUp(e));
    window.addEventListener('blur', () => this.reset());
    window.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') this.touchMode = true;
      if (this.onFirstInteraction) this.onFirstInteraction();
    }, { passive: true });
  }

  handleKeyDown(e) {
    const action = KEY_ACTIONS[e.code];
    if (action) {
      this.keys[action] = true;
      e.preventDefault();
    }
    this.touchMode = false;
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
  }

  get steer() {
    return (this.keys.right || this.touch.right ? 1 : 0) - (this.keys.left || this.touch.left ? 1 : 0);
  }

  get throttle() {
    return this.keys.throttle || this.touchMode;
  }

  get brake() {
    return this.keys.brake || this.touch.brake;
  }

  get boost() {
    return this.keys.boost || this.touch.boost;
  }
}
