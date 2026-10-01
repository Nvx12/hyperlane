import { isNative, platform, listen, call } from './native.js';

// Native app integration (Android / iOS through Capacitor). Wires the native events to the
// hooks the game already has, so the native app behaves like the web game, only more so:
//   app pause / resume  → Game.onBackground() / onForeground() (race paused, audio suspended;
//                         coming back shows PAUSED and waits for RESUME)
//   hardware Back       → the game's own back handling; on the home screen the app is sent to
//                         the background instead of the WebView navigating away
//   network status      → the OFFLINE / LOCAL ONLY chip and sync recovery (never in the loop)
// In a browser none of this runs (isNative() is false) and the web behaviour is unchanged.
export class NativeShell {
  constructor(game) {
    this.game = game;
    this.active = isNative();
    this.platform = platform();
  }

  start() {
    if (!this.active) return;
    const g = this.game;
    document.body.classList.add('native', `native-${this.platform}`);
    listen('App', 'pause', () => g.onBackground());
    listen('App', 'resume', () => g.onForeground());
    listen('App', 'backButton', () => this.back());
    listen('Network', 'networkStatusChange', s => g.shell.setNativeOnline(Boolean(s.connected)));
    call('Network', 'getStatus').then(s => {
      if (s) g.shell.setNativeOnline(Boolean(s.connected));
    });
  }

  // Android Back: in a race it pauses, in sub-menus it goes back a level; on the home screen
  // the app goes to the background (Android's convention for a root screen), so the player is
  // never trapped and never loses the session by accident.
  back() {
    const g = this.game;
    if (g.wantsBackGuard()) g.handleBack();
    else call('App', 'minimizeApp');
  }

  // Native splash: hidden as soon as the game has drawn its first menu frame (no fixed delay).
  hideSplash() {
    if (this.active) call('SplashScreen', 'hide', { fadeOutDuration: 200 });
  }
}
