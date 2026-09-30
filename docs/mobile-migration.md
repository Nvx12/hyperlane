# Mobile-first migration

Night Vector becomes a mobile arcade racer: thumbs, landscape, short sessions, phone hardware.
This file records the audit that drove the change and the plan it followed.

## 1. Audit of the desktop-era build

| Area | Finding | Mobile impact |
|---|---|---|
| Input | Keyboard is the primary scheme (WASD/arrows, Space, Esc, M/G/F shortcuts). Touch = four 84 px round buttons, only shown when a touch device is detected; "Touch controls Auto/On/Off" setting. | Touch is an afterthought; digital steering snaps straight to full lock (lateral target = steer × up to 11.5 m/s, ~0.1 s response) — twitchy under a thumb. |
| Gestures | `touch-action: none` on `html, body`. | **Bug:** touch-action combines with ancestors, so no menu list/panel can be scrolled with a finger on a real phone. Emulated mouse-wheel tests never caught it. |
| Hover | `pointerover` hover sounds; `:hover` transforms on nav, buttons, cards. | Sticky hover states after a tap on iOS/Android; wasted listeners. |
| Keyboard hints | Race intro (A D / W / S / Space / Esc), menu hint bar, `Space` badge on the boost meter. | Wrong instructions on a phone. |
| HUD | Desktop panels: 220 px score card, 150–200 px SVG speedometer, 200–300 px meters, mission tracker, three 40 px icon buttons. | Covers road on a 390 px-tall screen; 40 px targets are below thumb size. |
| Menus | Desktop layouts: side nav + hero, 1180 px panels, 3-column garage with car list, 2-column results, route screen before every race. | Too dense, too many steps before driving; small targets. |
| Rendering | `renderScale = min(DPR, 1.25 on touch, pixel budget ≥ 1×)`; quality Low/Medium/High (default High); detail auto-scaler then resolution step-down; no FPS cap. | No AUTO tier; 120 Hz phones render 120 fps (battery/heat); no 30 fps floor. |
| Camera | Shake up to 16 px, road vibration from 180 km/h, boost vibration, strong FOV widening. | Large relative to a phone screen; widened FOV shrinks traffic. |
| Lifecycle | Pauses on `visibilitychange`; resume is instant. No back-button handling. Rotate overlay only for detected touch devices. | Resuming straight into traffic after a phone call is unfair; Android back leaves the game. |
| Audio | Context created on first interaction; suspend/resume on pause. | iOS `interrupted` state (calls, Siri) not recovered. |
| Haptics / tilt | None. | Missing core mobile feedback / option. |
| Onboarding | Text tip + keyboard reference for 4 races. | No interactive tutorial. |
| Performance | Particles/rain/speed lines already pooled (typed arrays) with detail-scaled limits. Traffic leader search is O(n²) with n ≤ 28 (~800 cheap checks/frame). Garage preview allocates gradients per frame (menu only). | Baseline at 4× CPU throttle, 844×390 @3×, worst case: 60 fps, update 0.72 ms, render 4.95 ms, startup 1.4 s, 210 KB. JS has headroom; GPU fill rate is the risk on phones. |

## 2. Plan

1. **Landscape, safe areas, canvas.** Rotate screen for any portrait race (not just detected touch devices), auto-pause, safe-area insets everywhere, debounced resize (address bar / rotation), quality tiers Auto/Low/Medium/High with explicit DPR caps, pixel budgets and particle budgets, FPS cap 30/60/Auto (also caps 120 Hz phones at 60).
2. **Touch controls.** Left steering zone (hold left/right half, slide to switch, multi-touch, last finger wins) with a ramped, sensitivity-scaled steering signal; right-thumb BRAKE + BOOST; optional tilt steering (permission, calibration, sensitivity, automatic fallback); haptics manager; keyboard/gamepad kept but never shown.
3. **HUD + menus + garage.** Phone HUD (score/hull top-left, combo top-center, speed + pause top-right, boost bottom-center), one-tap PLAY, tile menu usable in portrait and landscape, swipe garage with an upgrade sheet, concise results with PLAY AGAIN, concise settings, back-button navigation, resume countdown, interactive tutorial.
4. **Balancing.** Touch steering feel, calmer camera, traffic fairness margins for thumb reaction times, session length check.
5. **Performance.** Adaptive AUTO quality (down and up), battery-friendly frame pacing, fix per-frame allocations found in the audit.
6. **PWA/offline.** Keep precache/offline; installed app is fullscreen landscape; network stays asynchronous.
7. **QA.** Phone viewports 640×360 → 932×430 (16:9–20:9) and portrait menus, high DPR, multi-touch via CDP touch events, 20× restart memory test, throttled-CPU performance, offline, background/resume, tilt fallback.
