import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyWebMcpBrowser,
  classifyWebMcpHost,
  getWebMcpPageEnvironment,
  originTrialProviderForBrowser,
  TOBIDAS_PUBLIC_ORIGIN,
} from './webmcpEnvironment'

describe('WebMCP page environment', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('recognizes the official public origin exactly', () => {
    expect(classifyWebMcpHost(new URL(`${TOBIDAS_PUBLIC_ORIGIN}/`))).toBe('public')
    expect(classifyWebMcpHost(new URL('https://preview.tobidas.example/'))).toBe('self-hosted')
  })

  it.each([
    'http://localhost:5174/',
    'http://tobidas.localhost:5174/',
    'http://127.0.0.1:5174/',
    'http://[::1]:5174/',
  ])('recognizes a local clone at %s', (url) => {
    expect(classifyWebMcpHost(new URL(url))).toBe('local')
  })

  it('treats another deployed origin as self-hosted', () => {
    expect(classifyWebMcpHost(new URL('https://example.com/tobidas/'))).toBe('self-hosted')
  })

  it.each([
    ['Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36', 'chrome'],
    ['Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0', 'edge'],
    ['Mozilla/5.0 Firefox/154.0', 'firefox'],
    ['ExampleBrowser/1.0', 'other'],
  ] as const)('recognizes the browser from %s', (userAgent, expected) => {
    expect(classifyWebMcpBrowser(userAgent)).toBe(expected)
  })

  it('maps only Chrome and Edge to Origin Trial providers', () => {
    expect(originTrialProviderForBrowser('chrome')).toBe('chrome')
    expect(originTrialProviderForBrowser('edge')).toBe('edge')
    expect(originTrialProviderForBrowser('firefox')).toBeNull()
    expect(originTrialProviderForBrowser('other')).toBeNull()
  })

  it('reports a token issued for the current browser provider', () => {
    const querySelector = vi.fn((selector: string) => (
      selector.includes('data-tobidas-trial-provider="chrome"')
        || !selector.includes('data-tobidas-trial-provider')
        ? { content: 'token' }
        : null
    ))
    vi.stubGlobal('window', { location: { href: `${TOBIDAS_PUBLIC_ORIGIN}/` } })
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36' })
    vi.stubGlobal('document', { querySelector })

    expect(getWebMcpPageEnvironment()).toEqual({
      hostKind: 'public',
      browserKind: 'chrome',
      originTrialTokenEmbedded: true,
      browserOriginTrialTokenEmbedded: true,
    })
    expect(querySelector).toHaveBeenCalledWith(
      'meta[http-equiv="origin-trial"][data-tobidas-trial="webmcp"][content]',
    )
  })

  it('does not treat a Chrome token as an Edge token', () => {
    const querySelector = vi.fn((selector: string) => (
      selector.includes('data-tobidas-trial-provider') ? null : { content: 'token' }
    ))
    vi.stubGlobal('window', { location: { href: `${TOBIDAS_PUBLIC_ORIGIN}/` } })
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 Chrome/151.0.0.0 Safari/537.36 Edg/151.0.0.0',
    })
    vi.stubGlobal('document', { querySelector })

    expect(getWebMcpPageEnvironment()).toEqual({
      hostKind: 'public',
      browserKind: 'edge',
      originTrialTokenEmbedded: true,
      browserOriginTrialTokenEmbedded: false,
    })
  })
})
