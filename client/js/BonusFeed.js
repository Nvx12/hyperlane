// In-race bonus feed: a short list under the score (top-left, above the horizon) that replaces
// the old floating text over the road. The centre of the screen belongs to traffic.
//
//   push() → entry enters at the top → stays briefly → fades → slot is reused
//
// At most MAX entries are visible. Repeats of the same event while it is still showing merge
// into one line ("NEAR MISS ×3  +750") instead of stacking. Priority decides lifetime, styling
// and who gets evicted first when the feed is full:
//   routine   — near misses, perfect overtakes, pickups, checkpoints (subtle, short)
//   important — mission complete, new record, police escape (highlighted, longer)
//   major     — achievement unlocked (compact here; the full presentation is on the results screen)
//
// DOM is touched only when an event arrives or expires — never per frame. Rows are created once.

export const PRIORITY = { ROUTINE: 'routine', IMPORTANT: 'important', MAJOR: 'major' };
const RANK = { routine: 0, important: 1, major: 2 };
const LIFE = { routine: 1.6, important: 2.8, major: 3.4 };
const LEAVE_TIME = 0.3; // CSS fade-out duration (seconds)
const MAX = 3;

export class BonusFeed {
  constructor(root, format = n => String(n)) {
    this.root = root;
    this.format = format;
    this.entries = [];
    // MAX visible rows plus one that may still be fading out.
    for (let i = 0; i < MAX + 1; i++) {
      const row = document.createElement('div');
      row.className = 'feed-row';
      const points = document.createElement('b');
      const label = document.createElement('span');
      const count = document.createElement('em');
      row.append(points, label, count);
      root.appendChild(row);
      this.entries.push({ row, points, label, count, key: '', total: 0, n: 0, life: 0, leaving: 0, priority: 'routine', stamp: 0 });
    }
    this.stamp = 0;
  }

  // points: number to show (0 = none). key: events with the same key merge while visible.
  push(label, points = 0, priority = PRIORITY.ROUTINE, variant = '', key = label) {
    this.stamp++;
    const live = this.entries.find(e => e.life > 0 && e.key === key);
    if (live) {
      live.n++;
      live.total += points;
      live.life = LIFE[live.priority];
      live.stamp = this.stamp;
      this.paint(live);
      this.bump(live.row);
      this.root.prepend(live.row); // most recent on top
      return;
    }
    const visible = this.entries.filter(e => e.life > 0);
    if (visible.length >= MAX) {
      // Evict the lowest-priority, oldest entry to make room.
      visible.sort((a, b) => RANK[a.priority] - RANK[b.priority] || a.stamp - b.stamp);
      this.retire(visible[0]);
    }
    const slot = this.entries.find(e => e.life <= 0 && e.leaving <= 0) || this.entries.find(e => e.life <= 0);
    slot.key = key;
    slot.n = 1;
    slot.total = points;
    slot.priority = priority;
    slot.life = LIFE[priority];
    slot.leaving = 0;
    slot.stamp = this.stamp;
    slot.label.textContent = label;
    slot.row.className = `feed-row ${priority}${variant ? ` fv-${variant}` : ''}`; // fv-: no clashes with menu classes
    this.paint(slot);
    this.root.prepend(slot.row);
    this.bump(slot.row, 'enter');
  }

  paint(e) {
    e.points.textContent = e.total > 0 ? `+${this.format(e.total)}` : '';
    e.count.textContent = e.n > 1 ? `×${e.n}` : '';
  }

  bump(row, cls = 'bump') {
    row.classList.remove('enter', 'bump', 'leaving');
    void row.offsetWidth; // replay the animation (event-driven, not per frame)
    row.classList.add(cls, 'visible');
  }

  retire(e) {
    e.life = 0;
    e.leaving = LEAVE_TIME;
    e.row.classList.remove('visible');
    e.row.classList.add('leaving');
  }

  update(dt) {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (e.life > 0) {
        e.life -= dt;
        if (e.life <= 0) this.retire(e);
      } else if (e.leaving > 0) {
        e.leaving -= dt;
        if (e.leaving <= 0) e.row.classList.remove('leaving');
      }
    }
  }

  clear() {
    for (const e of this.entries) {
      e.life = 0;
      e.leaving = 0;
      e.key = '';
      e.row.className = 'feed-row';
    }
  }

  // Test/QA helper: what the player currently sees, newest first.
  visibleLines() {
    return [...this.root.children]
      .map(row => this.entries.find(e => e.row === row))
      .filter(e => e && e.life > 0)
      .map(e => `${e.label.textContent}${e.n > 1 ? ` ×${e.n}` : ''}${e.total > 0 ? ` +${e.total}` : ''}`);
  }
}
