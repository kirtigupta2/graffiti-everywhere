import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { GestureName, GestureState, Point2D } from '../types'

// MediaPipe Hand landmark indices.
const WRIST = 0
const THUMB_TIP = 4
const INDEX_PIP = 6
const INDEX_TIP = 8
const MIDDLE_MCP = 9
const MIDDLE_PIP = 10
const MIDDLE_TIP = 12
const RING_PIP = 14
const RING_TIP = 16
const PINKY_PIP = 18
const PINKY_TIP = 20

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** A finger is "extended" when its tip sits further from the wrist than its own pip joint does, scaled against the palm so it works at any distance from the camera. */
function isExtended(landmarks: NormalizedLandmark[], tip: number, pip: number, palmSize: number): boolean {
  const wrist = landmarks[WRIST]
  return dist(landmarks[tip], wrist) - dist(landmarks[pip], wrist) > palmSize * 0.08
}

/**
 * Reads one hand's landmarks and resolves it to a single gesture for this frame.
 * Priority: draw (pinch) > wipe (open palm swipe) > point (index only) > none.
 */
export function resolveGesture(landmarks: NormalizedLandmark[], videoWidth: number, videoHeight: number): GestureState {
  const wrist = landmarks[WRIST]
  const palmSize = dist(wrist, landmarks[MIDDLE_MCP]) || 0.001

  const pinchDist = dist(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
  const pinchAmount = clamp01(1 - pinchDist / (palmSize * 1.1))

  const indexOut = isExtended(landmarks, INDEX_TIP, INDEX_PIP, palmSize)
  const middleOut = isExtended(landmarks, MIDDLE_TIP, MIDDLE_PIP, palmSize)
  const ringOut = isExtended(landmarks, RING_TIP, RING_PIP, palmSize)
  const pinkyOut = isExtended(landmarks, PINKY_TIP, PINKY_PIP, palmSize)

  const isPinching = pinchDist < palmSize * 0.42
  const fingersExtendedCount = [indexOut, middleOut, ringOut, pinkyOut].filter(Boolean).length

  let name: GestureName = 'none'
  let cursorLandmark: NormalizedLandmark = landmarks[INDEX_TIP]

  if (isPinching) {
    name = 'draw'
    cursorLandmark = midpoint(landmarks[THUMB_TIP], landmarks[INDEX_TIP])
  } else if (fingersExtendedCount >= 3) {
    name = 'wipe'
    cursorLandmark = midpoint(landmarks[MIDDLE_MCP], landmarks[WRIST])
  } else if (indexOut && !middleOut && !ringOut && !pinkyOut) {
    name = 'point'
    cursorLandmark = landmarks[INDEX_TIP]
  }

  const cursor: Point2D = {
    x: cursorLandmark.x * videoWidth,
    y: cursorLandmark.y * videoHeight,
  }

  return { name, cursor, pinchAmount }
}

function midpoint(a: NormalizedLandmark, b: NormalizedLandmark): NormalizedLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: (a.z + b.z) / 2,
    visibility: ((a.visibility ?? 0) + (b.visibility ?? 0)) / 2,
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v))
}
