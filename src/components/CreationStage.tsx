import { useCallback, useEffect, useRef, useState } from 'react'
import { useHandTracking } from '../hooks/useHandTracking'
import { resolveGesture } from '../lib/gestures'
import { WorldTracker } from '../lib/worldTracking'
import { fitSimilarity, applySimilarity, applySimilarityInverse, smoothTransform, IDENTITY_TRANSFORM, type SimilarityTransform } from '../lib/worldAnchor'
import { splitPointsNear } from '../lib/strokes'
import { videoPointToViewport } from '../lib/videoSpace'
import { PointOneEuroFilter } from '../lib/oneEuroFilter'
import { PALETTE, DEFAULT_STROKE_WIDTH } from '../lib/palette'
import { ColorPalette } from './ColorPalette'
import { CaptureButton } from './CaptureButton'
import { OnboardingOverlay } from './OnboardingOverlay'
import type { GestureName, Point2D, Stroke } from '../types'
import styles from './CreationStage.module.css'

const MAX_STROKES = 250
const KEYPOINTS_PER_STROKE = 5
const ERASE_RADIUS_PX = 55
const ENGAGE_FRAMES_NEEDED = 8
const MIN_POINT_DISTANCE_PX = 2.5
const STROKE_END_GRACE_FRAMES = 6
const LIME = '#cfff3d'

type CameraStatus = 'requesting' | 'granted' | 'denied'
type PinchMode = 'draw' | 'select' | null

let strokeIdCounter = 0
function makeStrokeId(): string {
  return `s-${Date.now()}-${strokeIdCounter++}`
}

export function CreationStage() {
  const stageRef = useRef<HTMLDivElement>(null)
  const mediaLayerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('requesting')
  const [bodyEngaged, setBodyEngaged] = useState(false)
  const [activeColorId, setActiveColorId] = useState(PALETTE[0].id)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [captureFlash, setCaptureFlash] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const hand = useHandTracking()

  const activeColorRef = useRef(PALETTE[0].hex)
  const worldTrackerRef = useRef<WorldTracker | null>(null)
  if (worldTrackerRef.current === null) worldTrackerRef.current = new WorldTracker()
  const transformCacheRef = useRef(new Map<string, SimilarityTransform>())

  const strokesRef = useRef<Stroke[]>([])
  const currentStrokeRef = useRef<Stroke | null>(null)
  const pinchModeRef = useRef<PinchMode>(null)
  const drawGapFramesRef = useRef(0)
  const wasPinchingRef = useRef(false)

  const drawFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const pointFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const wipeFilterRef = useRef(new PointOneEuroFilter(1.2, 0.6))
  const lastGestureNameRef = useRef<GestureName>('none')

  const hoveredIdRef = useRef<string | null>(null)
  const engagedFramesRef = useRef(0)
  const engagedFiredRef = useRef(false)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    activeColorRef.current = PALETTE.find((c) => c.id === activeColorId)?.hex ?? PALETTE[0].hex
  }, [activeColorId])

  const capture = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const out = document.createElement('canvas')
    out.width = canvas.width
    out.height = canvas.height
    const ctx = out.getContext('2d')
    if (!ctx) return

    ctx.translate(out.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, 0, 0, out.width, out.height)
    ctx.drawImage(canvas, 0, 0, out.width, out.height)

    out.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `graffit-you-${Date.now()}.png`
      link.click()
      URL.revokeObjectURL(url)
    }, 'image/png')

    setCaptureFlash(true)
    setToast('Saved to your downloads')
    window.setTimeout(() => setCaptureFlash(false), 420)
    window.setTimeout(() => setToast(null), 1800)
  }, [])

  // Camera setup.
  useEffect(() => {
    let stream: MediaStream | null = null
    let cancelled = false

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled || !videoRef.current) return
        videoRef.current.srcObject = stream
        await videoRef.current.play()
        setCameraStatus('granted')
      } catch (err) {
        console.error('Camera access failed', err)
        if (!cancelled) setCameraStatus('denied')
      }
    }

    start()

    return () => {
      cancelled = true
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [])

  // Detection + tracking + draw loop.
  useEffect(() => {
    if (cameraStatus !== 'granted') return

    const worldTracker = worldTrackerRef.current!

    function updateHovered(id: string | null) {
      if (hoveredIdRef.current !== id) {
        hoveredIdRef.current = id
        setHoveredId(id)
      }
    }

    function hitTest(point: Point2D): string | null {
      const nodes = stageRef.current?.querySelectorAll<HTMLElement>('[data-hover-id]')
      if (!nodes) return null
      for (const node of nodes) {
        const rect = node.getBoundingClientRect()
        const pad = 8
        if (point.x >= rect.left - pad && point.x <= rect.right + pad && point.y >= rect.top - pad && point.y <= rect.bottom + pad) {
          return node.dataset.hoverId ?? null
        }
      }
      return null
    }

    function runHoverAction(targetId: string) {
      if (targetId === 'capture') {
        capture()
      } else if (targetId.startsWith('swatch-')) {
        setActiveColorId(targetId.slice('swatch-'.length))
      }
    }

    /** Picks up to KEYPOINTS_PER_STROKE points spread along a path and starts tracking them from their current on-screen position. */
    function registerKeypoints(points: Point2D[], toCurrentSpace: (p: Point2D) => Point2D): { ids: string[]; origins: Point2D[] } {
      const k = Math.min(KEYPOINTS_PER_STROKE, points.length)
      const ids: string[] = []
      const origins: Point2D[] = []
      for (let i = 0; i < k; i++) {
        const idx = k === 1 ? 0 : Math.round((i * (points.length - 1)) / (k - 1))
        const origin = points[idx]
        ids.push(worldTracker.register(toCurrentSpace(origin)))
        origins.push(origin)
      }
      return { ids, origins }
    }

    /**
     * Computes (or reuses) a stroke's transform for the current frame.
     * `memo` is a per-tick cache: erase hit-testing and rendering both need
     * a stroke's transform in the same frame, and since fitting one also
     * advances its temporal smoothing, computing it twice in one tick would
     * double-apply that smoothing step.
     */
    function getTransform(stroke: Stroke, memo: Map<string, SimilarityTransform>): SimilarityTransform {
      if (stroke.keypointIds.length === 0) return IDENTITY_TRANSFORM

      const memoized = memo.get(stroke.id)
      if (memoized) return memoized

      const cached = transformCacheRef.current.get(stroke.id)

      let origins: Point2D[] = []
      let currents: Point2D[] = []
      for (let i = 0; i < stroke.keypointIds.length; i++) {
        const pos = worldTracker.getPosition(stroke.keypointIds[i])
        if (pos) {
          origins.push(stroke.keypointOrigins[i])
          currents.push(pos)
        }
      }

      if (origins.length === 0) {
        return cached ?? IDENTITY_TRANSFORM
      }

      let raw = fitSimilarity(origins, currents)
      if (!raw) return cached ?? IDENTITY_TRANSFORM

      // Single-pass outlier rejection: one keypoint whose optical-flow track
      // drifted (e.g. it landed on a low-texture patch) can otherwise skew
      // the whole fit. Drop the worst residual and refit if it's a clear
      // outlier relative to the rest.
      if (origins.length >= 3) {
        const residuals = origins.map((o, i) => {
          const predicted = applySimilarity(o, raw!)
          return Math.hypot(predicted.x - currents[i].x, predicted.y - currents[i].y)
        })
        const sorted = [...residuals].sort((a, b) => a - b)
        const median = sorted[Math.floor(sorted.length / 2)]
        let worst = 0
        for (let i = 1; i < residuals.length; i++) if (residuals[i] > residuals[worst]) worst = i
        if (residuals[worst] > Math.max(median * 3, 10)) {
          origins = origins.filter((_, i) => i !== worst)
          currents = currents.filter((_, i) => i !== worst)
          raw = fitSimilarity(origins, currents) ?? raw
        }
      }

      const smoothed = smoothTransform(cached, raw)
      transformCacheRef.current.set(stroke.id, smoothed)
      memo.set(stroke.id, smoothed)
      return smoothed
    }

    function dropStroke(stroke: Stroke) {
      worldTracker.releaseAll(stroke.keypointIds)
      transformCacheRef.current.delete(stroke.id)
    }

    function startNewStroke(point: Point2D) {
      const stroke: Stroke = {
        id: makeStrokeId(),
        color: activeColorRef.current,
        width: DEFAULT_STROKE_WIDTH,
        points: [point],
        keypointIds: [],
        keypointOrigins: [],
      }
      currentStrokeRef.current = stroke
      strokesRef.current.push(stroke)
      if (strokesRef.current.length > MAX_STROKES) {
        const dropped = strokesRef.current.shift()
        if (dropped) dropStroke(dropped)
      }
    }

    function appendPointIfFarEnough(stroke: Stroke, point: Point2D) {
      const last = stroke.points[stroke.points.length - 1]
      if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE_PX) return
      stroke.points.push(point)
    }

    function finalizeCurrentStroke() {
      const stroke = currentStrokeRef.current
      currentStrokeRef.current = null
      if (!stroke) return
      const { ids, origins } = registerKeypoints(stroke.points, (p) => p)
      stroke.keypointIds = ids
      stroke.keypointOrigins = origins
    }

    function eraseAt(cursor: Point2D, radiusPx: number, memo: Map<string, SimilarityTransform>) {
      const next: Stroke[] = []
      let changed = false

      for (const stroke of strokesRef.current) {
        const transform = getTransform(stroke, memo)
        const localCenter = applySimilarityInverse(cursor, transform)
        const localRadius = radiusPx / Math.max(transform.scale, 1e-3)
        const segments = splitPointsNear(stroke.points, localCenter, localRadius)
        const survivingPoints = segments.reduce((n, s) => n + s.length, 0)

        if (survivingPoints === stroke.points.length) {
          next.push(stroke)
          continue
        }

        changed = true
        dropStroke(stroke)
        for (const segment of segments) {
          if (segment.length === 0) continue
          const { ids, origins } = registerKeypoints(segment, (p) => applySimilarity(p, transform))
          next.push({
            id: makeStrokeId(),
            color: stroke.color,
            width: stroke.width,
            points: segment,
            keypointIds: ids,
            keypointOrigins: origins,
          })
        }
      }

      if (changed) strokesRef.current = next
    }

    function drawCursor(ctx: CanvasRenderingContext2D, name: GestureName, cursor: Point2D, pinchAmount: number) {
      ctx.save()
      ctx.shadowBlur = 0
      if (name === 'draw') {
        ctx.fillStyle = activeColorRef.current
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, DEFAULT_STROKE_WIDTH / 1.4, 0, Math.PI * 2)
        ctx.fill()
      } else if (name === 'wipe') {
        ctx.strokeStyle = 'rgba(255,255,255,0.85)'
        ctx.lineWidth = 3
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, ERASE_RADIUS_PX, 0, Math.PI * 2)
        ctx.stroke()
      } else if (name === 'point') {
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, 10, 0, Math.PI * 2)
        ctx.stroke()
        ctx.fillStyle = LIME
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, 10, -Math.PI / 2, -Math.PI / 2 + pinchAmount * Math.PI * 2)
        ctx.lineTo(cursor.x, cursor.y)
        ctx.fill()
      }
      ctx.restore()
    }

    /** Strokes a smooth curve through `points` using the midpoint quadratic-curve technique, instead of raw straight segments between noisy points. */
    function strokeSmoothPath(ctx: CanvasRenderingContext2D, points: Point2D[]) {
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2
        const my = (points[i].y + points[i + 1].y) / 2
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my)
      }
      const last = points[points.length - 1]
      ctx.lineTo(last.x, last.y)
      ctx.stroke()
    }

    function tick() {
      rafRef.current = requestAnimationFrame(tick)

      const video = videoRef.current
      const canvas = canvasRef.current
      const media = mediaLayerRef.current
      if (!video || !canvas || !media || video.readyState < 2) return

      if (canvas.width !== video.videoWidth && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
      }
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      const now = performance.now()
      const handLandmarks = hand.detect(video, now)
      worldTracker.processFrame(video)

      if (!engagedFiredRef.current) {
        if (handLandmarks) engagedFramesRef.current += 1
        else engagedFramesRef.current = Math.max(0, engagedFramesRef.current - 1)
        if (engagedFramesRef.current > ENGAGE_FRAMES_NEEDED) {
          engagedFiredRef.current = true
          setBodyEngaged(true)
        }
      }

      const gesture = handLandmarks
        ? resolveGesture(handLandmarks, canvas.width, canvas.height, wasPinchingRef.current)
        : { name: 'none' as GestureName, cursor: null, pinchAmount: 0 }
      wasPinchingRef.current = gesture.name === 'draw'

      if (gesture.name !== lastGestureNameRef.current) {
        drawFilterRef.current.reset()
        pointFilterRef.current.reset()
        wipeFilterRef.current.reset()
      }
      lastGestureNameRef.current = gesture.name

      let smoothedCursor: Point2D | null = null
      if (gesture.cursor) {
        const filter = gesture.name === 'draw' ? drawFilterRef.current : gesture.name === 'wipe' ? wipeFilterRef.current : pointFilterRef.current
        smoothedCursor = filter.filter(gesture.cursor, now)
      }

      let viewportCursor: Point2D | null = null
      if (smoothedCursor) viewportCursor = videoPointToViewport(smoothedCursor, video, media)

      const frameTransforms = new Map<string, SimilarityTransform>()

      if (gesture.name === 'draw') {
        drawGapFramesRef.current = 0
        if (pinchModeRef.current === null) {
          const targetId = viewportCursor ? hitTest(viewportCursor) : null
          if (targetId) {
            pinchModeRef.current = 'select'
            runHoverAction(targetId)
          } else {
            pinchModeRef.current = 'draw'
            if (!currentStrokeRef.current && smoothedCursor) startNewStroke(smoothedCursor)
          }
        }
        if (pinchModeRef.current === 'draw' && currentStrokeRef.current && smoothedCursor) {
          appendPointIfFarEnough(currentStrokeRef.current, smoothedCursor)
        }
        updateHovered(null)
      } else {
        if (pinchModeRef.current === 'draw') {
          drawGapFramesRef.current += 1
          if (drawGapFramesRef.current > STROKE_END_GRACE_FRAMES) {
            finalizeCurrentStroke()
            pinchModeRef.current = null
          }
        } else if (pinchModeRef.current === 'select') {
          pinchModeRef.current = null
        }

        if (gesture.name === 'wipe' && smoothedCursor) {
          eraseAt(smoothedCursor, ERASE_RADIUS_PX, frameTransforms)
          updateHovered(null)
        } else if (gesture.name === 'point' && viewportCursor) {
          updateHovered(hitTest(viewportCursor))
        } else {
          updateHovered(null)
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const stroke of strokesRef.current) {
        const transform = getTransform(stroke, frameTransforms)
        const rendered = stroke.points.map((p) => applySimilarity(p, transform))
        const width = stroke.width * transform.scale

        ctx.strokeStyle = stroke.color
        ctx.fillStyle = stroke.color
        ctx.shadowColor = stroke.color
        ctx.shadowBlur = 14

        if (rendered.length === 1) {
          ctx.beginPath()
          ctx.arc(rendered[0].x, rendered[0].y, width / 2, 0, Math.PI * 2)
          ctx.fill()
          continue
        }

        ctx.lineWidth = width
        ctx.lineCap = 'round'
        ctx.lineJoin = 'round'
        strokeSmoothPath(ctx, rendered)
      }
      ctx.shadowBlur = 0

      if (smoothedCursor) {
        drawCursor(ctx, gesture.name, smoothedCursor, gesture.pinchAmount)
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [cameraStatus, hand, capture])

  const overlayVisible = !bodyEngaged
  let overlayMessage = 'Fingers are your marker. Pinch to draw, open your palm to wipe.'
  let overlayError = false
  if (cameraStatus === 'denied') {
    overlayError = true
    overlayMessage = 'Camera access is blocked. Allow camera permissions in your browser and try again.'
  } else if (cameraStatus === 'requesting') {
    overlayMessage = 'Waking up your camera…'
  } else if (hand.status === 'error') {
    overlayError = true
    overlayMessage = 'Hand tracking failed to load. Check your connection and try again.'
  } else if (hand.status === 'loading') {
    overlayMessage = 'Loading hand tracking…'
  }

  return (
    <div className={styles.stage} ref={stageRef}>
      <div className={styles.mediaLayer} ref={mediaLayerRef}>
        <video ref={videoRef} className={styles.video} muted playsInline />
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>

      <div className={styles.wordmark}>
        graffit<span className={styles.dot}>.</span>you
      </div>

      {toast && <div className={styles.toast}>{toast}</div>}

      {bodyEngaged && (
        <>
          <ColorPalette activeColorId={activeColorId} hoveredId={hoveredId} onSelect={setActiveColorId} />
          <CaptureButton hovered={hoveredId === 'capture'} flash={captureFlash} onCapture={capture} />
        </>
      )}

      <OnboardingOverlay visible={overlayVisible} message={overlayMessage} isError={overlayError} onRetry={() => window.location.reload()} />
    </div>
  )
}
