// Spatial focus navigation for controllers: moves focus to the nearest control in the
// pressed direction inside the active screen. Only runs on navigation input, never per frame.

const FOCUSABLE = 'button:not([disabled]), [data-nav], [data-gtab], input:not([disabled]), select:not([disabled]), [tabindex="0"]';

function visible(el) {
  if (el.closest('[hidden]')) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

function layers() {
  const active = document.querySelector('.screen.active');
  const out = [];
  if (active) out.push(active);
  const banner = document.getElementById('update-banner');
  if (banner && !banner.hidden) out.push(banner);
  return out;
}

export function focusables() {
  const out = [];
  for (const layer of layers()) {
    layer.querySelectorAll(FOCUSABLE).forEach(el => {
      if (visible(el)) out.push(el);
    });
  }
  return out;
}

function center(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function moveFocus(dir) {
  const items = focusables();
  if (!items.length) return null;
  const current = document.activeElement;
  if (!current || !items.includes(current)) {
    const first = items.find(el => el.classList.contains('btn-primary') || el.classList.contains('nav-play')) || items[0];
    first.focus({ preventScroll: false });
    return first;
  }

  // Range and select controls consume left/right to change their value.
  if ((dir === 'left' || dir === 'right') && adjustValue(current, dir === 'right' ? 1 : -1)) return current;

  const from = center(current.getBoundingClientRect());
  const vx = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
  const vy = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
  let best = null;
  let bestScore = Infinity;
  for (const el of items) {
    if (el === current) continue;
    const c = center(el.getBoundingClientRect());
    const dx = c.x - from.x;
    const dy = c.y - from.y;
    const along = dx * vx + dy * vy;
    if (along <= 2) continue; // not in that direction
    const across = Math.abs(vx ? dy : dx);
    const score = along + across * 2.5; // prefer targets in line with the current one
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }
  if (best) {
    best.focus({ preventScroll: true });
    best.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  return best;
}

function adjustValue(el, step) {
  if (el instanceof HTMLInputElement && el.type === 'range') {
    const min = Number(el.min || 0);
    const max = Number(el.max || 100);
    const inc = Number(el.step) || (max - min) / 20;
    const next = Math.min(max, Math.max(min, Number(el.value) + inc * step));
    if (next === Number(el.value)) return true;
    el.value = String(next);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el instanceof HTMLSelectElement) {
    const i = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + step));
    if (i !== el.selectedIndex) {
      el.selectedIndex = i;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  }
  return false;
}

// A / Cross: activate the focused control, or report that nothing was focused.
export function activateFocused() {
  const el = document.activeElement;
  if (!el || el === document.body || !focusables().includes(el)) return false;
  el.click();
  return true;
}
