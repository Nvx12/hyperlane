import { Game } from './Game.js';

const boot = window.NV_BOOT;
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));

// Waits for the display fonts (so canvas text and billboards render correctly), but never
// blocks startup for long — the game falls back to system fonts.
function loadFonts(timeoutMs) {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  const fonts = Promise.all([
    document.fonts.load('900 32px Orbitron'),
    document.fonts.load('700 16px Rajdhani'),
  ]).catch(() => {});
  return Promise.race([fonts, new Promise(resolve => setTimeout(resolve, timeoutMs))]);
}

async function start() {
  const canvas = document.getElementById('game');
  if (!canvas.getContext || !canvas.getContext('2d')) {
    boot.fail('Your browser does not support HTML5 Canvas, which Night Vector needs to run.');
    return;
  }
  boot.progress(35);
  await loadFonts(2500);
  boot.progress(65, 'BUILDING THE CITY…');
  await nextFrame(); // let the progress paint before the (synchronous) sprite generation
  try {
    const game = new Game(canvas);
    boot.progress(90);
    await nextFrame();
    game.start();
    boot.finish();
    // Console handle for development builds only (?debug outside production).
    if (game.debug) window.nightVector = game;
  } catch (err) {
    boot.fail('Something went wrong while starting the game. Please reload the page.');
    throw err;
  }
}

start();
