// Fullscreen with vendor fallbacks. The canvas already re-fits on window resize, which the
// browser fires when entering/leaving fullscreen, so HUD, camera and touch layout follow.
import { isNative } from './native.js';

const doc = document;
const root = document.documentElement;

export const fullscreen = {
  get supported() {
    return !isNative() && Boolean(root.requestFullscreen || root.webkitRequestFullscreen);
  },

  get active() {
    return Boolean(doc.fullscreenElement || doc.webkitFullscreenElement);
  },

  async enter() {
    try {
      if (root.requestFullscreen) await root.requestFullscreen({ navigationUI: 'hide' });
      else if (root.webkitRequestFullscreen) root.webkitRequestFullscreen();
      // Landscape lock works on Android Chrome once fullscreen; elsewhere it rejects quietly.
      if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape').catch(() => {});
      return true;
    } catch {
      return false;
    }
  },

  async exit() {
    try {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else if (doc.webkitExitFullscreen) doc.webkitExitFullscreen();
    } catch {
      /* already exited */
    }
  },

  toggle() {
    return this.active ? this.exit().then(() => true) : this.enter();
  },

  onChange(fn) {
    doc.addEventListener('fullscreenchange', fn);
    doc.addEventListener('webkitfullscreenchange', fn);
  },
};
