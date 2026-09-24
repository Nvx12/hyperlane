import { Game } from './Game.js';

const loading = document.getElementById('loading');

function fail(message) {
  document.getElementById('loading-text').textContent = message;
  loading.classList.add('error');
}

const canvas = document.getElementById('game');
if (!canvas.getContext || !canvas.getContext('2d')) {
  fail('Your browser does not support HTML5 Canvas, which Hyperlane needs to run.');
} else {
  try {
    const game = new Game(canvas);
    game.start();
    loading.classList.add('done');
    setTimeout(() => loading.remove(), 600);
    // Expose the instance for console debugging with ?debug in the URL.
    if (game.debug) window.hyperlane = game;
  } catch (err) {
    fail('Something went wrong while starting the game. Please reload the page.');
    throw err;
  }
}
