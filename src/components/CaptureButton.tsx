import styles from './CaptureButton.module.css'

interface CaptureButtonProps {
  hovered: boolean
  flash: boolean
  onCapture: () => void
}

export function CaptureButton({ hovered, flash, onCapture }: CaptureButtonProps) {
  return (
    <button
      type="button"
      data-hover-id="capture"
      className={[styles.capture, hovered ? styles.hovered : '', flash ? styles.flash : ''].join(' ').trim()}
      aria-label="Capture pose"
      onClick={onCapture}
    />
  )
}
