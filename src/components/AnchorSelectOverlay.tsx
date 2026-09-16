import styles from './AnchorSelectOverlay.module.css'

interface AnchorSelectOverlayProps {
  hoveredId: string | null
  onSelectBody: () => void
  onSelectSurface: () => void
}

export function AnchorSelectOverlay({ hoveredId, onSelectBody, onSelectSurface }: AnchorSelectOverlayProps) {
  return (
    <div className={styles.overlay}>
      <h1 className={styles.title}>Where do you want to draw?</h1>
      <p className={styles.hint}>Pick a spot for your art to live. Point and pinch, or click.</p>
      <div className={styles.choices}>
        <button
          type="button"
          data-hover-id="anchor-body"
          className={[styles.choice, hoveredId === 'anchor-body' ? styles.hovered : ''].join(' ').trim()}
          onClick={onSelectBody}
        >
          <span className={styles.icon} aria-hidden="true">
            🧍
          </span>
          <span className={styles.label}>On yourself</span>
          <span className={styles.desc}>Strokes stick to your body as you move</span>
        </button>
        <button
          type="button"
          data-hover-id="anchor-surface"
          className={[styles.choice, hoveredId === 'anchor-surface' ? styles.hovered : ''].join(' ').trim()}
          onClick={onSelectSurface}
        >
          <span className={styles.icon} aria-hidden="true">
            🖼️
          </span>
          <span className={styles.label}>On a surface</span>
          <span className={styles.desc}>Pick a spot in the background or on someone else</span>
        </button>
      </div>
    </div>
  )
}
