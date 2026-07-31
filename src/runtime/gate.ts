/**
 * Visibility Gate。
 * 連続信号に対するヒステリシス付き閾値でフレームの描画と更新を決める。
 * Gateは座標へ一切影響せず、開いた瞬間の姿勢は写像の計算結果と常に一致する。
 */

export interface GateThresholds {
  openAt: number
  closeAt: number
}

const DEFAULT_GATE: GateThresholds = { openAt: 0.045, closeAt: 0.015 }

export class GateSet {
  private state = new Map<string, boolean>()

  constructor(private thresholds: GateThresholds = DEFAULT_GATE) {}

  /** signalが開閾値を超えたら開き、閉閾値を下回るまで開いたままにする */
  evaluate(key: string, signal: number): boolean {
    const previous = this.state.get(key) ?? false
    const next = previous ? signal > this.thresholds.closeAt : signal > this.thresholds.openAt
    this.state.set(key, next)
    return next
  }

  isOpen(key: string): boolean {
    return this.state.get(key) ?? false
  }
}
