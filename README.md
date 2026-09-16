# Graffit You

A frictionless, browser-based desktop AR mirror. Point a laptop webcam at
yourself, and your fingers become a marker: pinch to draw neon strokes that
stick to your body as you move, open your palm to wipe them away, and point
+ pinch to pick colors from a floating palette or snap a capture.

## How it works

- **Hand tracking** — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  `HandLandmarker` reads finger landmarks every frame to resolve a gesture:
  pinch (draw), open palm (wipe), or a pointing finger (hover the UI). Pinch
  detection uses hysteresis (a smaller distance to *start* a pinch than to
  *end* one) so hand-tracking noise at the threshold can't flicker the
  gesture and fragment a stroke into disconnected pieces.
- **World-glued strokes** — once a stroke is finished, a handful of points
  along it are handed to a sparse optical-flow tracker
  ([jsfeat](https://inspirit.github.io/jsfeat/)'s pyramidal Lucas-Kanade,
  the same family of algorithm real AR "sticker" tools use) that follows
  those exact pixels frame to frame on a downscaled grayscale copy of the
  video. Each stroke fits a 2D similarity transform (rotation + uniform
  scale + translation) from where those points started to where they are
  now, and renders itself through that transform — so it stays glued to
  whatever it was actually drawn on (skin, clothing, a mug on the desk, the
  wall behind you), not to a fixed region of the screen or a single rigid
  body frame. Wiping splits a stroke's remaining pieces and re-anchors each
  one from its current on-screen position, so cut pieces keep tracking
  independently.
- **Smooth strokes** — the live cursor runs through a
  [1€ filter](https://cristal.univ-lille.fr/~casiez/1euro/) (adaptive
  low-pass smoothing that backs off during fast motion so it doesn't add
  lag), points closer than ~2.5px are skipped, and the rendered path uses
  quadratic-curve-through-midpoints instead of straight segments — together
  these turn raw per-frame landmark noise into one continuous line instead
  of a jittery, beaded one.
- **Selection** — pointing at a palette swatch or the capture button and
  then pinching selects it, the same way you'd pinch to draw, just aimed at
  the UI instead of the world.
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
  components/OnboardingOverlay.tsx
  hooks/useHandTracking.ts       loads MediaPipe HandLandmarker
  lib/gestures.ts                pinch (with hysteresis) / open-palm / point detection
  lib/oneEuroFilter.ts           adaptive cursor smoothing
  lib/worldTracking.ts           sparse optical-flow keypoint tracker (jsfeat)
  lib/worldAnchor.ts             least-squares 2D similarity transform fit/apply
  lib/strokes.ts                 point-path splitting for erase
  lib/videoSpace.ts              video-pixel <-> viewport coordinate mapping
  lib/palette.ts                 brand color swatches
```

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production
- `npm run lint` — run Oxlint
