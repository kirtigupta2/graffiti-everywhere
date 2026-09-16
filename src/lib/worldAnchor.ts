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

/**
 * Least-squares fit of a similarity transform mapping `origin` points onto
 * `current` points (same order, same length >= 1). Uses the closed-form
 * complex-number solution to 2D Procrustes: treating each centered point
 * as a complex number, the best rotation+scale is the least-squares ratio
 * of current to origin. Returns null only if the origin points are
 * degenerate (all coincident) with more than one point, since then no
 * rotation/scale is observable.
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

  if (den < 1e-6) {
    return { scale: 1, rotation: 0, originCentroid, currentCentroid }
  }

  const cRe = numRe / den
  const cIm = numIm / den
  return {
    scale: Math.hypot(cRe, cIm),
    rotation: Math.atan2(cIm, cRe),
    originCentroid,
    currentCentroid,
  }
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
