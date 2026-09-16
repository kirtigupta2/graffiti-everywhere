import type { Point2D } from '../types'

/**
 * Splits a point path at any point within `radius` of `center` (both in
 * the same coordinate space as `points`), dropping the erased points. A
 * path cut in the middle becomes two separate pieces instead of one that
 * jumps straight across the gap.
 */
export function splitPointsNear(points: Point2D[], center: Point2D, radius: number): Point2D[][] {
  const segments: Point2D[][] = []
  let current: Point2D[] = []

  for (const point of points) {
    const hit = Math.hypot(point.x - center.x, point.y - center.y) < radius
    if (hit) {
      if (current.length > 0) {
        segments.push(current)
        current = []
      }
    } else {
      current.push(point)
    }
  }
  if (current.length > 0) segments.push(current)

  return segments
}
