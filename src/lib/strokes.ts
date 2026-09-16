import type { Stroke, StrokePoint } from '../types'

/**
 * Removes any stroke points within `radius` of `center` (both in body
 * space). A stroke that gets cut in the middle is split into two so the
 * remaining pieces don't snap together into a straight line.
 */
export function eraseNear(strokes: Stroke[], center: StrokePoint, radius: number): Stroke[] {
  const result: Stroke[] = []

  for (const stroke of strokes) {
    let current: StrokePoint[] = []
    let part = 0

    for (const point of stroke.points) {
      const hit = Math.hypot(point.x - center.x, point.y - center.y) < radius
      if (hit) {
        if (current.length > 0) {
          result.push({ ...stroke, id: `${stroke.id}-${part++}`, points: current })
          current = []
        }
      } else {
        current.push(point)
      }
    }

    if (current.length > 0) {
      result.push(current.length === stroke.points.length ? stroke : { ...stroke, id: `${stroke.id}-${part}`, points: current })
    }
  }

  return result
}
