# Graffit You

A frictionless, browser-based desktop AR mirror. Point a laptop webcam at a
plain wall or background, and your fingers become a marker: pinch to draw
neon strokes, open your palm to wipe them away, and point + pinch to pick
colors from a floating palette or snap a capture.

## How it works

- **Hand tracking** — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  `HandLandmarker` reads finger landmarks every frame to resolve a gesture:
  pinch (draw), open palm (wipe), or a pointing finger (hover the UI). Pinch
  detection requires a genuinely full pinch (fingertip and thumb tip close
  to touching) and uses hysteresis — a tighter distance to *start* a pinch
  than to *end* one — so hand-tracking noise at the threshold can't flicker
  the gesture and fragment a stroke into disconnected pieces. Drawing only
  ever runs once onboarding has fully engaged, so hand-tracking warm-up
  noise can't leave a stray mark before you've even started.
- **Fixed-coordinate canvas** — strokes are stored and rendered at the exact
  video-pixel coordinates they were drawn at, every frame, with no live
  tracking or per-frame transform. Since a laptop webcam is stationary, the
  wall or background behind you genuinely doesn't move in frame, so a plain
  fixed overlay is enough to make drawings "stick" reliably — no drift, and
  no per-frame fit that can misfire. (We tried a fancier version — glueing
  strokes to a moving person or object via live optical-flow tracking — but
  it kept trading one instability for another, so we deliberately kept this
  simple and dependable instead.)
- **Smooth strokes** — the live cursor runs through a
  [1€ filter](https://cristal.univ-lille.fr/~casiez/1euro/) (adaptive
  low-pass smoothing that backs off during fast motion so it doesn't add
  lag), points closer than ~2.5px are skipped, and the rendered path uses
  quadratic-curve-through-midpoints instead of straight segments — together
  these turn raw per-frame landmark noise into one continuous line instead
  of a jittery, beaded one.
- **Selection** — pointing at a palette swatch or the capture button and
  then pinching selects it, the same way you'd pinch to draw, just aimed at
  the UI instead of the wall.
- **Capture** — composites the mirrored camera frame and the strokes canvas
  into a PNG and downloads it.

Everything runs client-side; no video or images leave the browser.

## Running it

```sh
npm install
npm run dev
```

Open the printed local URL in a webcam-equipped browser (Chrome/Edge
recommended) and allow camera access. The hand-tracking model loads from
Google's MediaPipe CDN on first run.

## Project layout

```
src/
  components/CreationStage.tsx   camera + canvas + gesture loop + UI
  components/ColorPalette.tsx    floating swatch palette
  components/CaptureButton.tsx   pinch-to-capture button
  components/PromptOverlay.tsx   onboarding / status prompt
  hooks/useHandTracking.ts       loads MediaPipe HandLandmarker
  lib/gestures.ts                pinch (full-pinch + hysteresis) / open-palm / point detection
  lib/oneEuroFilter.ts           adaptive cursor smoothing
  lib/strokes.ts                 point-path splitting for erase
  lib/videoSpace.ts              video-pixel <-> viewport coordinate mapping
  lib/palette.ts                 brand color swatches
```

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production
- `npm run lint` — run Oxlint
