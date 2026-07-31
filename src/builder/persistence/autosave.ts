import type { BookProject } from '../../schema/bookPackage'

export class ProjectAutosave {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly save: (project: BookProject) => Promise<void>,
    private readonly delayMilliseconds = 500,
  ) {}

  schedule(project: BookProject): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.save(project)
    }, this.delayMilliseconds)
  }
}

