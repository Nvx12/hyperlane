import { Pwa } from './pwa.js';
import { fullscreen } from './fullscreen.js';

// App-level chrome around the game: installability, updates, fullscreen and connectivity.
// None of it touches gameplay; the game only tells the shell when it's a safe moment.
export class AppShell {
  constructor(game) {
    this.game = game;
    this.banner = document.getElementById('update-banner');
    this.installBtn = document.getElementById('install-btn');
    this.netChip = document.getElementById('net-status');
    this.listeners = new Set();
    this.pwa = new Pwa({
      onUpdateReady: () => this.refreshUpdateBanner(),
      onInstallAvailable: available => {
        this.installBtn.hidden = !available;
      },
      onInstalled: () => {
        this.game.ui.toast('Installed', 'Night Vector is on your device', 'unlock');
        this.emit('installed');
      },
    });
    fullscreen.onChange(() => this.syncFullscreen());
    window.addEventListener('online', () => this.syncNetwork());
    window.addEventListener('offline', () => this.syncNetwork());
  }

  // Turning a phone upright mid-race covers the road (see .rotate-overlay), so pause first.
  // Called from the game's resize handling, which fires reliably on rotation.
  checkOrientation() {
    const portrait = window.innerHeight > window.innerWidth;
    if (portrait && this.game.ui.isTouchDevice() && this.game.isRaceActive()) this.game.pause();
  }

  start() {
    document.body.classList.toggle('no-fullscreen', !fullscreen.supported);
    document.body.classList.toggle('standalone', this.pwa.isStandalone);
    this.syncFullscreen();
    this.syncNetwork();
    this.pwa.register();
  }

  on(fn) {
    this.listeners.add(fn);
  }

  emit(type, data) {
    for (const fn of this.listeners) fn(type, data);
  }

  get online() {
    return navigator.onLine !== false;
  }

  syncNetwork() {
    this.netChip.hidden = this.online;
    this.emit('network', this.online);
  }

  syncFullscreen() {
    const active = fullscreen.active;
    document.body.classList.toggle('fs-active', active);
    document.querySelectorAll('.fs-btn').forEach(b => b.setAttribute('aria-label', active ? 'Exit fullscreen' : 'Enter fullscreen'));
  }

  async toggleFullscreen() {
    if (!fullscreen.supported) {
      this.game.ui.toast('Fullscreen unavailable', this.pwa.isIosSafari ? 'Tip: Share → Add to Home Screen' : 'Not supported by this browser', 'mission');
      return;
    }
    const ok = await fullscreen.toggle();
    if (!ok) this.game.ui.toast('Fullscreen unavailable', 'The browser blocked the request', 'mission');
  }

  async install() {
    await this.pwa.promptInstall();
  }

  // Called by the game at safe moments (menus, results). Never shows during a race.
  refreshUpdateBanner() {
    const safe = !this.game.isRaceActive() && this.game.state !== 'paused';
    this.banner.hidden = !(this.pwa.updateReady && safe);
  }

  applyUpdate() {
    this.banner.hidden = true;
    this.pwa.applyUpdate();
  }
}
