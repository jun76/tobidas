export const PANEL_WIDTH_MIN = 200
export const PANEL_WIDTH_MAX = 560

export function clampPanelWidth(width: number): number {
  return Math.min(PANEL_WIDTH_MAX, Math.max(PANEL_WIDTH_MIN, width))
}

export function loadPanelWidth(key: string, fallback: number): number {
  const value = Number(localStorage.getItem(`tobidas4.panelW.${key}`))
  return Number.isFinite(value) && value > 0 ? clampPanelWidth(value) : fallback
}

export function savePanelWidth(key: string, width: number): void {
  localStorage.setItem(`tobidas4.panelW.${key}`, String(width))
}

