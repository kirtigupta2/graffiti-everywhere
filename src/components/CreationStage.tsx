import { useCallback, useEffect, useRef, useState } from 'react'
import { useVisionTracking } from '../hooks/useVisionTracking'
import { resolveGesture } from '../lib/gestures'
import { buildBodyAnchor, bodyToScreen, screenToBody } from '../lib/bodySpace'
import { eraseNear } from '../lib/strokes'
import { videoPointToViewport } from '../lib/videoSpace'
import { PALETTE, DEFAULT_STROKE_WIDTH } from '../lib/palette'
import { ColorPalette } from './ColorPalette'
import { CaptureButton } from './CaptureButton'
import { OnboardingOverlay } from './OnboardingOverlay'
import type { BodyAnchor, GestureName, Point2D, Stroke } from '../types'
import styles from './CreationStage.module.css'

const MAX_STROKES = 400
const ERASE_RADIUS_PX = 55
const ENGAGE_FRAMES_NEEDED = 8
const LIME = '#cfff3d'

type CameraStatus = 'requesting' | 'granted' | 'denied'

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

  const vision = useVisionTracking()

  const activeColorRef = useRef(PALETTE[0].hex)
  const anchorRef = useRef<BodyAnchor | null>(null)
  const strokesRef = useRef<Stroke[]>([])
  const currentStrokeRef = useRef<Stroke | null>(null)
  const prevGestureRef = useRef<GestureName>('none')
  const pinchModeRef = useRef<'draw' | 'select' | null>(null)
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

  // Detection + draw loop.
  useEffect(() => {
    if (cameraStatus !== 'granted') return

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

    function drawCursor(ctx: CanvasRenderingContext2D, name: GestureName, cursor: Point2D, pinchAmount: number, scale: number) {
      ctx.save()
      ctx.shadowBlur = 0
      if (name === 'draw') {
        ctx.fillStyle = activeColorRef.current
        ctx.beginPath()
        ctx.arc(cursor.x, cursor.y, (DEFAULT_STROKE_WIDTH * scale) / 1.4, 0, Math.PI * 2)
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

      const frame = vision.detect(video, performance.now())

      if (frame.pose) {
        const anchor = buildBodyAnchor(frame.pose, canvas.width, canvas.height)
        if (anchor) anchorRef.current = anchor
      }

      if (!engagedFiredRef.current) {
        if (frame.hand || frame.pose) engagedFramesRef.current += 1
        else engagedFramesRef.current = Math.max(0, engagedFramesRef.current - 1)
        if (engagedFramesRef.current > ENGAGE_FRAMES_NEEDED) {
          engagedFiredRef.current = true
          setBodyEngaged(true)
        }
      }

      const gesture = frame.hand ? resolveGesture(frame.hand, canvas.width, canvas.height) : { name: 'none' as GestureName, cursor: null, pinchAmount: 0 }

      let viewportCursor: Point2D | null = null
      if (gesture.cursor) viewportCursor = videoPointToViewport(gesture.cursor, video, media)

      const prevGesture = prevGestureRef.current

      if (gesture.name === 'draw') {
        if (prevGesture !== 'draw') {
          const targetId = viewportCursor ? hitTest(viewportCursor) : null
          if (targetId) {
            pinchModeRef.current = 'select'
            runHoverAction(targetId)
          } else {
            pinchModeRef.current = 'draw'
            currentStrokeRef.current = null
          }
        }
        if (pinchModeRef.current === 'draw' && anchorRef.current && gesture.cursor) {
          const bodyPoint = screenToBody(gesture.cursor, anchorRef.current)
          if (!currentStrokeRef.current) {
            const stroke: Stroke = {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              color: activeColorRef.current,
              width: DEFAULT_STROKE_WIDTH,
              points: [bodyPoint],
            }
            currentStrokeRef.current = stroke
            strokesRef.current.push(stroke)
            if (strokesRef.current.length > MAX_STROKES) strokesRef.current.shift()
          } else {
            currentStrokeRef.current.points.push(bodyPoint)
          }
        }
        updateHovered(null)
      } else {
        if (prevGesture === 'draw') {
          currentStrokeRef.current = null
          pinchModeRef.current = null
        }
        if (gesture.name === 'wipe' && anchorRef.current && gesture.cursor) {
          const bodyPoint = screenToBody(gesture.cursor, anchorRef.current)
          const radius = ERASE_RADIUS_PX / anchorRef.current.scale
          strokesRef.current = eraseNear(strokesRef.current, bodyPoint, radius)
          updateHovered(null)
        } else if (gesture.name === 'point' && viewportCursor) {
          updateHovered(hitTest(viewportCursor))
        } else {
          updateHovered(null)
        }
      }
      prevGestureRef.current = gesture.name

      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const anchor = anchorRef.current
      if (anchor) {
        for (const stroke of strokesRef.current) {
          if (stroke.points.length === 0) continue
          const lineWidth = stroke.width * anchor.scale
          if (stroke.points.length === 1) {
            const p = bodyToScreen(stroke.points[0], anchor)
            ctx.fillStyle = stroke.color
            ctx.shadowColor = stroke.color
            ctx.shadowBlur = 14
            ctx.beginPath()
            ctx.arc(p.x, p.y, lineWidth / 2, 0, Math.PI * 2)
            ctx.fill()
            continue
          }
          ctx.strokeStyle = stroke.color
          ctx.shadowColor = stroke.color
          ctx.shadowBlur = 14
          ctx.lineWidth = lineWidth
          ctx.lineCap = 'round'
          ctx.lineJoin = 'round'
          ctx.beginPath()
          const first = bodyToScreen(stroke.points[0], anchor)
          ctx.moveTo(first.x, first.y)
          for (let i = 1; i < stroke.points.length; i++) {
            const p = bodyToScreen(stroke.points[i], anchor)
            ctx.lineTo(p.x, p.y)
          }
          ctx.stroke()
        }
        ctx.shadowBlur = 0

        if (gesture.cursor) {
          drawCursor(ctx, gesture.name, gesture.cursor, gesture.pinchAmount, anchor.scale)
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [cameraStatus, vision, capture])

  const overlayVisible = !bodyEngaged
  let overlayMessage = 'Fingers are your marker. Pinch to draw, open your palm to wipe.'
  let overlayError = false
  if (cameraStatus === 'denied') {
    overlayError = true
    overlayMessage = 'Camera access is blocked. Allow camera permissions in your browser and try again.'
  } else if (cameraStatus === 'requesting') {
    overlayMessage = 'Waking up your camera…'
  } else if (vision.status === 'error') {
    overlayError = true
    overlayMessage = 'Hand tracking failed to load. Check your connection and try again.'
  } else if (vision.status === 'loading') {
    overlayMessage = 'Loading hand + body tracking…'
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
