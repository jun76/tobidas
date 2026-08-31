export const TOBIDAS_PUBLIC_ORIGIN = 'https://tobidas.9rsgy78c9c.workers.dev'

export type WebMcpHostKind = 'public' | 'local' | 'self-hosted'
export type WebMcpBrowserKind = 'chrome' | 'edge' | 'firefox' | 'other'
export type WebMcpOriginTrialProvider = 'chrome' | 'edge'

export interface WebMcpPageEnvironment {
  hostKind: WebMcpHostKind
  browserKind: WebMcpBrowserKind
  originTrialTokenEmbedded: boolean
  browserOriginTrialTokenEmbedded: boolean
}

const WEBMCP_TRIAL_SELECTOR = 'meta[http-equiv="origin-trial"][data-tobidas-trial="webmcp"][content]'

/** Tipsを現在の配信経路に合わせる。WebMCPの可否そのものは必ずfeature detectする。 */
export function classifyWebMcpHost(url: URL): WebMcpHostKind {
  if (url.origin === TOBIDAS_PUBLIC_ORIGIN) return 'public'
  const hostname = url.hostname.toLowerCase()
  if (
    hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '[::1]'
    || hostname.startsWith('127.')
  ) return 'local'
  return 'self-hosted'
}

/** Chromium系ではEdgeを先に判定する。EdgeのUAにもChrome表記が含まれるため。 */
export function classifyWebMcpBrowser(userAgent: string): WebMcpBrowserKind {
  if (/\bFirefox\//i.test(userAgent)) return 'firefox'
  if (/\bEdg\//i.test(userAgent)) return 'edge'
  if (/\bChrome\//i.test(userAgent)) return 'chrome'
  return 'other'
}

export function originTrialProviderForBrowser(
  browserKind: WebMcpBrowserKind,
): WebMcpOriginTrialProvider | null {
  if (browserKind === 'chrome' || browserKind === 'edge') return browserKind
  return null
}

export function getWebMcpPageEnvironment(): WebMcpPageEnvironment {
  const hostKind = typeof window === 'undefined'
    ? 'self-hosted'
    : classifyWebMcpHost(new URL(window.location.href))
  const browserKind = classifyWebMcpBrowser(
    typeof navigator === 'undefined' ? '' : navigator.userAgent,
  )
  const originTrialTokenEmbedded = typeof document !== 'undefined'
    && document.querySelector(WEBMCP_TRIAL_SELECTOR) !== null
  const provider = originTrialProviderForBrowser(browserKind)
  const browserOriginTrialTokenEmbedded = typeof document !== 'undefined'
    && provider !== null
    && document.querySelector(
      `${WEBMCP_TRIAL_SELECTOR}[data-tobidas-trial-provider="${provider}"]`,
    ) !== null
  return {
    hostKind,
    browserKind,
    originTrialTokenEmbedded,
    browserOriginTrialTokenEmbedded,
  }
}
