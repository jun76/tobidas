import { useEffect } from 'react'

const gizmoPressed = { current: false }

export function markGizmoPress(): void {
  gizmoPressed.current = true
}

export function didGizmoPress(): boolean {
  return gizmoPressed.current
}

export function useGizmoPressReset(): void {
  useEffect(() => {
    const clear = () => { gizmoPressed.current = false }
    window.addEventListener('pointerdown', clear, true)
    return () => window.removeEventListener('pointerdown', clear, true)
  }, [])
}

