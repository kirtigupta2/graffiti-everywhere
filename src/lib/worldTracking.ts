import jsfeat from 'jsfeat'
import type { Point2D } from '../types'

const TRACK_WIDTH = 480
const PYRAMID_LEVELS = 3
const WIN_SIZE = 21
const MAX_ITER = 24
const EPS = 0.01
const MIN_EIGEN_THRESHOLD = 0.0001

interface Keypoint {
  x: number
  y: number
  valid: boolean
}

/**
 * Tracks a sparse set of world-space keypoints across video frames with
 * pyramidal Lucas-Kanade optical flow (jsfeat), the same family of
 * algorithm real AR "sticker" tools use to pin a drawing to a physical
 * surface — a shirt, a face, or an object on a desk — rather than to
 * fixed screen pixels. Runs on a downscaled grayscale copy of the video
 * frame for speed; callers register/read keypoints in full video-pixel
 * space and this class handles the space conversion internally.
 */
export class WorldTracker {
  private trackWidth = 0
  private trackHeight = 0
  private scale = 1

  private offscreen: HTMLCanvasElement | null = null
  private offCtx: CanvasRenderingContext2D | null = null

  private pyrA: any = null
  private pyrB: any = null
  private useAAsTarget = true
  private hasPrevFrame = false

  private keypoints = new Map<string, Keypoint>()
  private nextId = 0

  private ensureInitialized(video: HTMLVideoElement): boolean {
    if (this.trackWidth > 0) return true
    if (!video.videoWidth || !video.videoHeight) return false

    this.scale = TRACK_WIDTH / video.videoWidth
    this.trackWidth = TRACK_WIDTH
    this.trackHeight = Math.round(video.videoHeight * this.scale)

    this.offscreen = document.createElement('canvas')
    this.offscreen.width = this.trackWidth
    this.offscreen.height = this.trackHeight
    this.offCtx = this.offscreen.getContext('2d', { willReadFrequently: true })

    this.pyrA = new jsfeat.pyramid_t(PYRAMID_LEVELS)
    this.pyrA.allocate(this.trackWidth, this.trackHeight, jsfeat.U8C1_t)
    this.pyrB = new jsfeat.pyramid_t(PYRAMID_LEVELS)
    this.pyrB.allocate(this.trackWidth, this.trackHeight, jsfeat.U8C1_t)

    return true
  }

  /** Call once per animation frame. Advances tracking for all registered keypoints. */
  processFrame(video: HTMLVideoElement) {
    if (!this.ensureInitialized(video) || !this.offCtx || !this.offscreen) return

    const target = this.useAAsTarget ? this.pyrA : this.pyrB
    const previous = this.useAAsTarget ? this.pyrB : this.pyrA

    this.offCtx.drawImage(video, 0, 0, this.trackWidth, this.trackHeight)
    const frame = this.offCtx.getImageData(0, 0, this.trackWidth, this.trackHeight)
    jsfeat.imgproc.grayscale(frame.data, this.trackWidth, this.trackHeight, target.data[0])
    target.build(target.data[0], true)

    if (this.hasPrevFrame && this.keypoints.size > 0) {
      this.track(previous, target)
    }

    this.hasPrevFrame = true
    this.useAAsTarget = !this.useAAsTarget
  }

  private track(previous: any, target: any) {
    const ids = Array.from(this.keypoints.keys()).filter((id) => this.keypoints.get(id)!.valid)
    if (ids.length === 0) return

    const count = ids.length
    const prevXY = new Float32Array(count * 2)
    for (let i = 0; i < count; i++) {
      const kp = this.keypoints.get(ids[i])!
      prevXY[i * 2] = kp.x
      prevXY[i * 2 + 1] = kp.y
    }
    const currXY = new Float32Array(prevXY)
    const status = new Uint8Array(count)

    jsfeat.optical_flow_lk.track(previous, target, prevXY, currXY, count, WIN_SIZE, MAX_ITER, status, EPS, MIN_EIGEN_THRESHOLD)

    for (let i = 0; i < count; i++) {
      const kp = this.keypoints.get(ids[i])!
      if (status[i]) {
        kp.x = currXY[i * 2]
        kp.y = currXY[i * 2 + 1]
      } else {
        kp.valid = false
      }
    }
  }

  /** Registers a point (full video-pixel space) to track from now on. Returns its id. */
  register(point: Point2D): string {
    const id = `kp-${this.nextId++}`
    this.keypoints.set(id, { x: point.x * this.scale, y: point.y * this.scale, valid: true })
    return id
  }

  /** Current tracked position in full video-pixel space, or null if tracking was lost. */
  getPosition(id: string): Point2D | null {
    const kp = this.keypoints.get(id)
    if (!kp || !kp.valid || this.scale === 0) return null
    return { x: kp.x / this.scale, y: kp.y / this.scale }
  }

  release(id: string) {
    this.keypoints.delete(id)
  }

  releaseAll(ids: string[]) {
    for (const id of ids) this.keypoints.delete(id)
  }
}
