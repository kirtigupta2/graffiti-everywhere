export interface Point2D {
  x: number
  y: number
}

export type GestureName = 'draw' | 'wipe' | 'point' | 'none'

export interface GestureState {
  name: GestureName
  /** Fingertip used as the active cursor (index tip for draw/point, palm center for wipe). Screen-space, pixels. */
  cursor: Point2D | null
  /** 0-1 confidence-ish pinch closeness, only meaningful while pointing, used for a "charging up" select animation. */
  pinchAmount: number
}

export interface Stroke {
  id: string
  color: string
  /** Line width in raw video-pixel units, at the moment it was drawn. */
  width: number
  /** Points in raw video-pixel space, at the moment they were drawn (the stroke's "rest pose"). */
  points: Point2D[]
  /**
   * World-tracker keypoint ids sampled from this stroke once it's finalized
   * (pinch released). Empty while still being drawn. Their live tracked
   * positions, compared against the matching points below, drive the
   * per-frame transform that keeps the stroke glued to whatever it was
   * drawn on as that surface moves.
   */
  keypointIds: string[]
  /** The stroke points (in `points`) that each entry in `keypointIds` was sampled from, same order. */
  keypointOrigins: Point2D[]
}

export interface SwatchColor {
  id: string
  label: string
  hex: string
}
