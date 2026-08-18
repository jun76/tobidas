import type { BookProject } from '../../schema/bookPackage'

export class ProjectAutosave {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly save: (project: BookProject) => Promise<void>,
    private readonly delayMilliseconds = 500,
    private readonly events: {
      scheduled?(): void
      saved?(): void
      failed?(error: unknown): void
    } = {},
  ) {}

  schedule(project: BookProject): void {
    if (this.timer) clearTimeout(this.timer)
    this.events.scheduled?.()
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.save(project)
        .then(() => this.events.saved?.())
        .catch((error) => this.events.failed?.(error))
    }, this.delayMilliseconds)
  }
}
