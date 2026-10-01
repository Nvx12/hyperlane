// Android back button / iOS swipe-back / browser Back, handled like a native game:
//   racing → pause · paused → resume · results → menu · sub-menu or sheet → back one level.
// While the player is anywhere but the home screen, one extra history entry ("guard") absorbs
// the back gesture. On the home screen the guard is released, so Back leaves the page normally —
// the player is never trapped.

export class BackNav {
  constructor(onBack, enabled = true) {
    this.onBack = onBack;
    this.enabled = enabled;
    this.armed = false;
    this.ignore = 0; // popstates we caused ourselves (releasing the guard)
    window.addEventListener('popstate', () => {
      if (this.ignore > 0) {
        this.ignore--;
        return;
      }
      this.armed = false; // the guard entry was consumed by this Back
      this.onBack();
    });
  }

  // Called every frame with whether a guard is wanted; touches history only on change.
  sync(wanted) {
    if (!this.enabled) return;
    if (wanted && !this.armed) {
      history.pushState({ nvGuard: true }, '');
      this.armed = true;
    } else if (!wanted && this.armed) {
      this.armed = false;
      if (history.state && history.state.nvGuard) {
        this.ignore++;
        history.back();
      }
    }
  }
}
