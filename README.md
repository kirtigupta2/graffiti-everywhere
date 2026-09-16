# Graffit You

A frictionless, browser-based desktop AR mirror. Point a laptop webcam at
yourself, and your fingers become a marker: pinch to draw neon strokes that
stick to your body as you move, open your palm to wipe them away, and point
+ pinch to pick colors from a floating palette or snap a capture.

## How it works

- **Hand tracking** — [MediaPipe Tasks Vision](https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker)
  `HandLandmarker` reads finger landmarks every frame to resolve a gesture:
  pinch (draw), open palm (wipe), or a pointing finger (hover the UI).
- **Body-glued strokes** — `PoseLandmarker` tracks the shoulders each frame
  to build a torso-anchored coordinate frame (origin, rotation, scale).
  Strokes are stored relative to that frame, so as you move closer, lean,
  or turn, they translate/rotate/scale back onto your body instead of
  staying pinned to fixed screen pixels.
- **Selection** — pointing at a palette swatch or the capture button and
  then pinching selects it, the same way you'd pinch to draw, just aimed at
  the UI instead of your body.
- **Capture** — composites the mirrored camera frame and the strokes canvas
  into a PNG and downloads it.

Everything runs client-side; no video or images leave the browser.

## Running it

```sh
npm install
npm run dev
```

Open the printed local URL in a webcam-equipped browser (Chrome/Edge
recommended) and allow camera access. Hand + pose tracking models load
from Google's MediaPipe CDN on first run.

## Project layout

```
src/
  components/CreationStage.tsx   camera + canvas + gesture loop + UI
  components/ColorPalette.tsx    floating swatch palette
  components/CaptureButton.tsx   pinch-to-capture button
  components/OnboardingOverlay.tsx
  hooks/useVisionTracking.ts     loads HandLandmarker + PoseLandmarker
  lib/gestures.ts                pinch / open-palm / point detection
  lib/bodySpace.ts               screen <-> torso-anchored coordinate math
  lib/strokes.ts                 wipe/erase logic
  lib/videoSpace.ts              video-pixel <-> viewport coordinate mapping
  lib/palette.ts                 brand color swatches
```

## Scripts

- `npm run dev` — start the Vite dev server
- `npm run build` — typecheck and build for production
- `npm run lint` — run Oxlint
