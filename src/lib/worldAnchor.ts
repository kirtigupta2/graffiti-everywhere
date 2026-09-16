import type { Point2D } from '../types'

/**
 * A rigid 2D similarity transform (uniform scale + rotation about a pivot,
 * plus translation), expressed as "map a point from its original position
 * to where the tracked surface has carried it now". Fit with
 * `fitSimilarity` from N (original, current) keypoint correspondences
 * produced by optical-flow tracking, so a stroke's whole point set can
 * follow the same rigid motion as the small patch of world it was drawn
 * on — a face, a shirt, or an object on a desk.
 */
export interface SimilarityTransform {
  scale: number
  rotation: number
  originCentroid: Point2D
  currentCentroid: Point2D
}

export const IDENTITY_TRANSFORM: SimilarityTransform = {
  scale: 1,
  rotation: 0,
  originCentroid: { x: 0, y: 0 },
  currentCentroid: { x: 0, y: 0 },
}

// Below this RMS spread (video-pixel space) the keypoints are too close
// together to reliably observe rotation/scale: optical-flow noise of just
// a few pixels, divided by an origin spread of a similar size, produces
// wild ratios (the classic "explodes to 10x size" failure). Below the
// threshold we still track translation (always well-conditioned — it's
// just an average delta) but hold rotation/scale at identity instead of
// trusting a near-divide-by-zero fit.
const MIN_SPREAD_PX = 14

// A hard backstop on top of the spread guard: real camera/subject motion
// between frames should never make a stroke's tracked patch several times
// bigger or smaller from one frame to the next. Clamps out any residual
// noise (e.g. one outlier keypoint) that still slips through.
const MIN_SCALE = 0.4
const MAX_SCALE = 2.5

/**
 * Least-squares fit of a similarity transform mapping `origin` points onto
 * `current` points (same order, same length >= 1). Uses the closed-form
 * complex-number solution to 2D Procrustes: treating each centered point
 * as a complex number, the best rotation+scale is the least-squares ratio
 * of current to origin. Falls back to translation-only (scale 1, rotation
 * 0) when the origin points are too tightly clustered for rotation/scale
 * to be numerically reliable — see `MIN_SPREAD_PX`.
 */
export function fitSimilarity(origin: Point2D[], current: Point2D[]): SimilarityTransform | null {
  const n = Math.min(origin.length, current.length)
  if (n === 0) return null

  const originCentroid = centroid(origin, n)
  const currentCentroid = centroid(current, n)

  if (n === 1) {
    return { scale: 1, rotation: 0, originCentroid, currentCentroid }
  }

  let numRe = 0
  let numIm = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    const px = origin[i].x - originCentroid.x
    const py = origin[i].y - originCentroid.y
    const qx = current[i].x - currentCentroid.x
    const qy = current[i].y - currentCentroid.y
    numRe += px * qx + py * qy
    numIm += px * qy - py * qx
    den += px * px + py * py
  }

  const rmsSpread = Math.sqrt(den / n)
  if (rmsSpread < MIN_SPREAD_PX) {
    return { scale: 1, rotation: 0, originCentroid, currentCentroid }
  }

  const cRe = numRe / den
  const cIm = numIm / den
  return {
    scale: clamp(Math.hypot(cRe, cIm), MIN_SCALE, MAX_SCALE),
    rotation: Math.atan2(cIm, cRe),
    originCentroid,
    currentCentroid,
  }
}

/**
 * Exponentially smooths a stroke's transform toward a freshly-fitted one,
 * so a single noisy tracking frame nudges the drawing instead of snapping
 * or warping it. `alpha` is the per-frame blend weight toward the new fit.
 */
export function smoothTransform(previous: SimilarityTransform | undefined, next: SimilarityTransform, alpha = 0.35): SimilarityTransform {
  if (!previous) return next
  return {
    scale: previous.scale + (next.scale - previous.scale) * alpha,
    rotation: lerpAngle(previous.rotation, next.rotation, alpha),
    originCentroid: next.originCentroid,
    currentCentroid: {
      x: previous.currentCentroid.x + (next.currentCentroid.x - previous.currentCentroid.x) * alpha,
      y: previous.currentCentroid.y + (next.currentCentroid.y - previous.currentCentroid.y) * alpha,
    },
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  const twoPi = Math.PI * 2
  let diff = (to - from) % twoPi
  if (diff > Math.PI) diff -= twoPi
  if (diff < -Math.PI) diff += twoPi
  return from + diff * t
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function applySimilarity(point: Point2D, t: SimilarityTransform): Point2D {
  const dx = point.x - t.originCentroid.x
  const dy = point.y - t.originCentroid.y
  const cos = Math.cos(t.rotation) * t.scale
  const sin = Math.sin(t.rotation) * t.scale
  return {
    x: dx * cos - dy * sin + t.currentCentroid.x,
    y: dx * sin + dy * cos + t.currentCentroid.y,
  }
}

export function applySimilarityInverse(point: Point2D, t: SimilarityTransform): Point2D {
  const dx = point.x - t.currentCentroid.x
  const dy = point.y - t.currentCentroid.y
  const invScale = t.scale > 1e-6 ? 1 / t.scale : 1
  const cos = Math.cos(-t.rotation) * invScale
  const sin = Math.sin(-t.rotation) * invScale
  return {
    x: dx * cos - dy * sin + t.originCentroid.x,
    y: dx * sin + dy * cos + t.originCentroid.y,
  }
}

function centroid(points: Point2D[], n: number): Point2D {
  let x = 0
  let y = 0
  for (let i = 0; i < n; i++) {
    x += points[i].x
    y += points[i].y
  }
  return { x: x / n, y: y / n }
}
