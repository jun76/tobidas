/**
 * Content Clock (docs/005 §8.2)。
 * 住人の経過時間はReactコンポーネントの外で要素キーごとに保持し、
 * Visibility Gateによるmountとunmountを跨いで継続する。
 */
export class ClockStore {
  private elapsed = new Map<string, number>()
  /** story-timeモードが参照する作品全体の時刻 */
  private story = 0

  advanceStory(dt: number): void {
    this.story += dt
  }

  get storyTime(): number {
    return this.story
  }

  /** Gateが開いている要素だけが毎フレーム呼ぶ */
  advance(key: string, dt: number): number {
    const next = (this.elapsed.get(key) ?? 0) + dt
    this.elapsed.set(key, next)
    return next
  }

  peek(key: string): number {
    return this.elapsed.get(key) ?? 0
  }
}
