import { useRef } from 'react'

export function useSwipe({ onSwipeLeft, onSwipeRight, threshold = 40 }) {
  const touchStartX = useRef(null)
  const touchEndX = useRef(null)
  const touchStartY = useRef(null)
  const touchEndY = useRef(null)

  const onTouchStart = (e) => {
    touchEndX.current = null
    touchEndY.current = null
    touchStartX.current = e.targetTouches[0].clientX
    touchStartY.current = e.targetTouches[0].clientY
  }

  const onTouchMove = (e) => {
    touchEndX.current = e.targetTouches[0].clientX
    touchEndY.current = e.targetTouches[0].clientY
  }

  const onTouchEnd = () => {
    if (!touchStartX.current || !touchEndX.current) return
    const distanceX = touchStartX.current - touchEndX.current
    const distanceY = touchStartY.current - touchEndY.current
    
    // Asegurar que el deslizamiento fue principalmente horizontal (no un scroll vertical rapido o en diagonal)
    const isHorizontalSwipe = Math.abs(distanceX) > Math.abs(distanceY) * 1.5

    if (isHorizontalSwipe) {
      if (distanceX > threshold && onSwipeLeft) {
        onSwipeLeft()
      } else if (distanceX < -threshold && onSwipeRight) {
        onSwipeRight()
      }
    }
  }

  return { onTouchStart, onTouchMove, onTouchEnd }
}
