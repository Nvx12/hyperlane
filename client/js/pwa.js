import { ENV } from './env.js';
import { isNative } from './native.js';

// Service-worker registration, update flow and install prompt.
// Updates never apply on their own: the game decides when it's safe (not during a race)
// to show "NEW VERSION AVAILABLE", and only reloads when the player accepts.

const UPDATE_CHECK_MS = 30 * 60 * 1000;

export class Pwa {
  constructor({ onUpdateReady, onInstallAvailable, onInstalled }) {
    this.onUpdateReady = onUpdateReady;
    this.onInstallAvailable = onInstallAvailable;
    this.onInstalled = onInstalled;
    this.registration = null;
    this.installEvent = null;
    this.updateReady = false;
    this.reloading = false;

    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault(); // we show our own INSTALL button instead of the browser mini-bar
      this.installEvent = e;
      if (this.onInstallAvailable) this.onInstallAvailable(true);
    });
    window.addEventListener('appinstalled', () => {
      this.installEvent = null;
      if (this.onInstallAvailable) this.onInstallAvailable(false);
      if (this.onInstalled) this.onInstalled();
    });
  }

  get supported() {
    return !isNative() && 'serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1');
  }

  get isStandalone() {
    return window.matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;
  }

  get canInstall() {
    return Boolean(this.installEvent);
  }

  // iOS Safari has no install prompt; players add to the home screen from the share sheet.
  get isIosSafari() {
    const ua = navigator.userAgent;
    return /iP(hone|ad|od)/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS/.test(ua);
  }

  async register() {
    if (!this.supported) return;
    // Development: a cache-first worker would serve stale code after every edit. Opt in with ?sw.
    if (ENV.appEnv === 'development' && !new URLSearchParams(location.search).has('sw')) {
      const regs = await navigator.serviceWorker.getRegistrations().catch(() => []);
      for (const r of regs) r.unregister();
      if (regs.length && window.caches) {
        const keys = await caches.keys();
        await Promise.all(keys.filter(k => k.startsWith('nv-')).map(k => caches.delete(k)));
      }
      return;
    }
    try {
      const reg = await navigator.serviceWorker.register('sw.js');
      this.registration = reg;
      if (reg.waiting && navigator.serviceWorker.controller) this.markUpdateReady();
      reg.addEventListener('updatefound', () => {
        const worker = reg.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          // "installed" with an existing controller = an update is waiting (first installs have none).
          if (worker.state === 'installed' && navigator.serviceWorker.controller) this.markUpdateReady();
        });
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (this.reloading) window.location.reload();
      });
      setInterval(() => reg.update().catch(() => {}), UPDATE_CHECK_MS);
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) reg.update().catch(() => {});
      });
    } catch {
      // Offline support is an enhancement: the game runs fine without a service worker.
    }
  }

  markUpdateReady() {
    if (this.updateReady) return;
    this.updateReady = true;
    if (this.onUpdateReady) this.onUpdateReady();
  }

  applyUpdate() {
    const waiting = this.registration && this.registration.waiting;
    if (!waiting) {
      window.location.reload();
      return;
    }
    this.reloading = true;
    waiting.postMessage('SKIP_WAITING');
  }

  async promptInstall() {
    const e = this.installEvent;
    if (!e) return false;
    this.installEvent = null;
    e.prompt();
    const choice = await e.userChoice.catch(() => null);
    if (this.onInstallAvailable) this.onInstallAvailable(false);
    return Boolean(choice && choice.outcome === 'accepted');
  }
}
