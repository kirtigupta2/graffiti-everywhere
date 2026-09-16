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
  /**
   * Points in raw video-pixel space, at the moment they were drawn. Every
   * stroke shares the single session anchor (see worldAnchor.ts /
   * CreationStage's anchor tracking) — there's one transform per frame,
   * not one per stroke, so these points always render through the same
   * mapping as every other stroke.
   */
  points: Point2D[]
}

export interface SwatchColor {
  id: string
  label: string
  hex: string
}
