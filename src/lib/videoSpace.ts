import type { Point2D } from '../types'

/**
 * Maps a point in raw video-pixel space to viewport (CSS pixel) space,
 * replicating the `object-fit: cover` math the <video>/<canvas> layers use,
 * then mirrors it horizontally to match the CSS `scaleX(-1)` applied to
 * those layers for the selfie-mirror effect. DOM UI (the palette, capture
 * button) lives in normal, un-mirrored viewport space, so gesture
 * hit-testing against it needs this mirrored coordinate.
 */
export function videoPointToViewport(point: Point2D, video: HTMLVideoElement, container: HTMLElement): Point2D {
  const rect = container.getBoundingClientRect()
  const cw = rect.width
  const ch = rect.height
  const vw = video.videoWidth
  const vh = video.videoHeight

  if (!vw || !vh) {
    return { x: rect.left + cw / 2, y: rect.top + ch / 2 }
  }

  const scale = Math.max(cw / vw, ch / vh)
  const displayW = vw * scale
  const displayH = vh * scale
  const offsetX = (cw - displayW) / 2
  const offsetY = (ch - displayH) / 2

  const rawX = point.x * scale + offsetX
  const rawY = point.y * scale + offsetY
  const mirroredX = cw - rawX

  return { x: rect.left + mirroredX, y: rect.top + rawY }
}
