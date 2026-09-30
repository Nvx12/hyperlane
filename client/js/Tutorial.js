// First-race tutorial: taught while driving, one instruction at a time, skippable.
//   1. steer (both directions)  2. brake  3. near miss (charges boost)  4. boost
// Every step also advances on a timeout, so nobody gets stuck. While it runs the car can take
// hits but can't be wrecked — the first race should teach, not punish.

const STEPS = [
  { id: 'steer', target: '.steer-glyph', timeout: 14 },
  { id: 'brake', target: '[data-touch="brake"]', timeout: 12 },
  { id: 'near', target: null, timeout: 24 },
  { id: 'boost', target: '[data-touch="boost"]', timeout: 12 },
];
const DONE_HOLD = 2;
const START_DELAY = 1; // let the "GO!" callout finish before the first instruction

function stepText(id, tilt) {
  switch (id) {
    case 'steer': return tilt ? 'TILT THE PHONE TO STEER' : 'HOLD ◀  ▶ TO STEER';
    case 'brake': return 'TAP BRAKE TO SLOW DOWN';
    case 'near': return 'PASS CLOSE TO A CAR — NEAR MISSES CHARGE BOOST';
    case 'boost': return 'BOOST IS CHARGED — TAP BOOST!';
    default: return '';
  }
}

export class Tutorial {
  constructor(game) {
    this.game = game;
    this.box = document.getElementById('coach');
    this.text = document.getElementById('coach-text');
    this.dots = document.getElementById('coach-steps');
    this.index = -1;
    this.finished = false;
  }

  start() {
    this.index = -1;
    this.finished = false;
    this.doneTimer = 0;
    this.delay = START_DELAY;
    this.dots.innerHTML = STEPS.map(() => '<i></i>').join('');
  }

  next() {
    this.clearTarget();
    this.index++;
    if (this.index >= STEPS.length) {
      this.showDone();
      return;
    }
    const step = STEPS[this.index];
    this.time = 0;
    this.left = 0;
    this.right = 0;
    this.held = 0;
    this.nearMiss = false;
    this.boosted = false;
    if (step.id === 'boost') this.game.player.boost = 100; // guarantee there's something to fire
    this.setText(stepText(step.id, this.game.input.usingTilt), false);
    this.dots.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i <= this.index));
    if (step.target) {
      this.targets = document.querySelectorAll(step.target);
      this.targets.forEach(el => el.classList.add('coach-target'));
    }
    this.game.haptics.pulse('tap');
  }

  setText(text, done) {
    // Re-trigger the entrance animation for each new instruction.
    const node = this.text.cloneNode(false);
    node.textContent = text;
    node.classList.toggle('done', done);
    this.text.replaceWith(node);
    this.text = node;
  }

  showDone() {
    this.setText('NICE! BUILD YOUR COMBO', true);
    this.doneTimer = DONE_HOLD;
    this.game.audio.perfect();
  }

  // Events from gameplay systems.
  notify(kind) {
    if (this.index < 0 || this.index >= STEPS.length) return;
    if (kind === 'nearMiss') this.nearMiss = true;
    if (kind === 'boost') this.boosted = true;
  }

  // Called every frame while racing.
  update(dt) {
    if (this.finished) return;
    if (this.delay > 0) {
      this.delay -= dt;
      if (this.delay <= 0) {
        this.box.hidden = false;
        this.next();
      }
      return;
    }
    if (this.doneTimer > 0) {
      this.doneTimer -= dt;
      if (this.doneTimer <= 0) this.finish();
      return;
    }
    const step = STEPS[this.index];
    if (!step) return;
    this.time += dt;
    const input = this.game.input;
    let complete = false;
    switch (step.id) {
      case 'steer':
        if (input.steer < -0.3) this.left += dt;
        if (input.steer > 0.3) this.right += dt;
        complete = this.left > 0.2 && this.right > 0.2;
        break;
      case 'brake':
        this.held = input.brake ? this.held + dt : this.held;
        complete = this.held > 0.15;
        break;
      case 'near':
        complete = this.nearMiss;
        break;
      case 'boost':
        complete = this.boosted;
        break;
      default:
        break;
    }
    if (complete || this.time > step.timeout) this.next();
  }

  clearTarget() {
    if (this.targets) this.targets.forEach(el => el.classList.remove('coach-target'));
    this.targets = null;
  }

  skip() {
    this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    this.clearTarget();
    this.box.hidden = true;
    const game = this.game;
    game.save.flags.tutorial = true;
    game.store.save();
    game.tutorial = null;
  }

  // Race ended or abandoned mid-tutorial: hide it (it will run again next race).
  abort() {
    this.finished = true;
    this.clearTarget();
    this.box.hidden = true;
    this.game.tutorial = null;
  }
}
