import { afterEach, describe, expect, it, vi } from 'vitest'
import { readAiMode, writeAiMode } from './session'

function mockWindow(search = '') {
  const values = new Map<string, string>()
  vi.stubGlobal('window', {
    location: { search },
    sessionStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })
}

describe('AI mode session', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('ignores the retired ai query when deciding whether to show the AI workspace', () => {
    mockWindow('?ai=1')
    expect(readAiMode()).toBe(false)
  })

  it('remembers an explicit UI toggle for the current session', () => {
    mockWindow()
    expect(readAiMode()).toBe(false)
    writeAiMode(true)
    expect(readAiMode()).toBe(true)
  })
})
