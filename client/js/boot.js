/* Boot shim — a tiny classic (non-module) script that runs before the game modules.
   It owns the loading screen, catches load failures, and handles browsers too old for
   ES modules. Kept external (no inline scripts) so a strict Content-Security-Policy works. */
(function () {
  'use strict';

  var TIPS = [
    'Near misses recharge boost faster than anything else.',
    'Swerve around a car at the last moment for a PERFECT OVERTAKE.',
    'Tuck in behind a car to slipstream — free speed and boost.',
    'Safe driving lets your combo decay. Keep taking risks.',
    'Blinking amber lights mean a car is about to change lanes.'
  ];
  var done = false;

  function el(id) {
    return document.getElementById(id);
  }

  var boot = {
    progress: function (pct, label) {
      var bar = el('loading-bar');
      var text = el('loading-text');
      if (bar) bar.style.transform = 'scaleX(' + Math.max(0, Math.min(1, pct / 100)) + ')';
      if (text) text.textContent = label || 'LOADING ' + Math.round(pct) + '%';
    },
    fail: function (message) {
      var screen = el('loading');
      if (!screen || done) return;
      el('loading-text').textContent = message;
      screen.classList.add('error');
    },
    finish: function () {
      done = true;
      var screen = el('loading');
      if (!screen) return;
      boot.progress(100);
      screen.classList.add('done');
      setTimeout(function () {
        if (screen.parentNode) screen.parentNode.removeChild(screen);
      }, 600);
    }
  };
  window.NV_BOOT = boot;

  // A failed module import surfaces as a window error before the game starts.
  window.addEventListener('error', function () {
    boot.fail('Night Vector failed to load. Please check your connection and reload.');
  });

  document.addEventListener('DOMContentLoaded', function () {
    var tip = el('loading-tip');
    if (tip) tip.textContent = 'Tip: ' + TIPS[Math.floor(Math.random() * TIPS.length)];
    boot.progress(10);
    if (!('noModule' in HTMLScriptElement.prototype)) {
      boot.fail('Your browser is too old to run Night Vector. Please use a current version of Chrome, Firefox, Safari or Edge.');
    }
  });
})();
