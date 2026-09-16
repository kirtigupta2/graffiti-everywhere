import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { BodyAnchor, Point2D, StrokePoint } from '../types'

const LEFT_SHOULDER = 11
const RIGHT_SHOULDER = 12

/**
 * Builds a torso-anchored reference frame from pose landmarks: origin at the
 * shoulder midpoint, rotation from the shoulder line, scale from shoulder
 * width. Strokes stored relative to this frame stay "glued" to the body as
 * the person moves closer/further, leans, or turns.
 */
export function buildBodyAnchor(poseLandmarks: NormalizedLandmark[], videoWidth: number, videoHeight: number): BodyAnchor | null {
  const left = poseLandmarks[LEFT_SHOULDER]
  const right = poseLandmarks[RIGHT_SHOULDER]
  if (!left || !right) return null
  if ((left.visibility ?? 1) < 0.4 || (right.visibility ?? 1) < 0.4) return null

  const lx = left.x * videoWidth
  const ly = left.y * videoHeight
  const rx = right.x * videoWidth
  const ry = right.y * videoHeight

  const dx = rx - lx
  const dy = ry - ly
  const scale = Math.hypot(dx, dy)
  if (scale < 1) return null

  return {
    origin: { x: (lx + rx) / 2, y: (ly + ry) / 2 },
    rotation: Math.atan2(dy, dx),
    scale,
  }
}

export function screenToBody(point: Point2D, anchor: BodyAnchor): StrokePoint {
  const dx = point.x - anchor.origin.x
  const dy = point.y - anchor.origin.y
  const cos = Math.cos(-anchor.rotation)
  const sin = Math.sin(-anchor.rotation)
  const rx = dx * cos - dy * sin
  const ry = dx * sin + dy * cos
  return { x: rx / anchor.scale, y: ry / anchor.scale }
}

export function bodyToScreen(point: StrokePoint, anchor: BodyAnchor): Point2D {
  const sx = point.x * anchor.scale
  const sy = point.y * anchor.scale
  const cos = Math.cos(anchor.rotation)
  const sin = Math.sin(anchor.rotation)
  const rx = sx * cos - sy * sin
  const ry = sx * sin + sy * cos
  return { x: rx + anchor.origin.x, y: ry + anchor.origin.y }
}
