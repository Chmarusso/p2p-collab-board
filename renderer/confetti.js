// A short confetti burst from a point on screen, for finishing a card. Plain DOM
// and the Web Animations API; with reduced motion it is a quiet check mark.

const COLORS = ['#4bce97', '#f5cd47', '#fea362', '#f87168', '#9f8fef', '#579dff', '#e774bb']
const PIECES = 36

export function celebrate(x, y, { reducedMotion = false, accent = null } = {}) {
  const layer = document.createElement('div')
  layer.className = 'confetti-layer'
  layer.setAttribute('aria-hidden', 'true')
  document.body.append(layer)

  if (reducedMotion) {
    const mark = document.createElement('div')
    mark.className = 'confetti-check'
    mark.textContent = '✓'
    mark.style.left = `${x}px`
    mark.style.top = `${y}px`
    layer.append(mark)
    mark
      .animate(
        [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 1, offset: 0.7 }, { opacity: 0 }],
        {
          duration: 900
        }
      )
      .finished.finally(() => layer.remove())
    return
  }

  const colors = accent ? [accent, ...COLORS] : COLORS
  const animations = []
  for (let i = 0; i < PIECES; i++) {
    const piece = document.createElement('i')
    piece.className = 'confetti-piece'
    const size = 5 + Math.random() * 5
    piece.style.width = `${size}px`
    piece.style.height = `${size * (Math.random() < 0.5 ? 0.45 : 1)}px`
    piece.style.left = `${x}px`
    piece.style.top = `${y}px`
    piece.style.background = colors[i % colors.length]
    if (Math.random() < 0.3) piece.style.borderRadius = '50%'
    layer.append(piece)
    // Mostly upwards, fanned out, then gravity pulls it down past the start.
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1
    const speed = 120 + Math.random() * 220
    const dx = Math.cos(angle) * speed
    const dy = Math.sin(angle) * speed
    const spin = (Math.random() - 0.5) * 1080
    const duration = 700 + Math.random() * 400
    animations.push(
      piece.animate(
        [
          { transform: 'translate(-50%, -50%) rotate(0deg)', opacity: 1 },
          {
            transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${spin / 2}deg)`,
            opacity: 1,
            offset: 0.45
          },
          {
            transform: `translate(calc(-50% + ${dx * 1.3}px), calc(-50% + ${dy + 260}px)) rotate(${spin}deg)`,
            opacity: 0
          }
        ],
        { duration, easing: 'cubic-bezier(0.2, 0.7, 0.4, 1)', fill: 'forwards' }
      ).finished
    )
  }
  Promise.allSettled(animations).then(() => layer.remove())
}
