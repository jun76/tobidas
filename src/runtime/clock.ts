/**
 * Content Clock。
 * 住人の経過時間はReactコンポーネントの外で要素キーごとに保持し、
 * Visibility Gateによるmountとunmountを跨いで継続する。
 */
export class ClockStore {
  /** 検証用の時刻スナップショット。作品へ保存せず、未指定なら通常の経過時間を使う。 */
  sampleTime: number | undefined
  private elapsed = new Map<string, number>()
  /** story-timeモードが参照する作品全体の時刻 */
  private story = 0

  advanceStory(dt: number): void {
    if (this.sampleTime !== undefined) return
    this.story += dt
  }

  get storyTime(): number {
    return this.sampleTime ?? this.story
  }

  /** Gateが開いている要素だけが毎フレーム呼ぶ */
  advance(key: string, dt: number): number {
    if (this.sampleTime !== undefined) return this.sampleTime
    const next = (this.elapsed.get(key) ?? 0) + dt
    this.elapsed.set(key, next)
    return next
  }

  peek(key: string): number {
    return this.sampleTime ?? this.elapsed.get(key) ?? 0
  }
}
