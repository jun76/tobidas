import { createPublicKey, verify } from 'node:crypto'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const WEBMCP_ORIGIN_TRIAL_ENV = 'WEBMCP_ORIGIN_TRIAL_TOKEN'
const WEBMCP_EDGE_ORIGIN_TRIAL_ENV = 'WEBMCP_EDGE_ORIGIN_TRIAL_TOKEN'
const TOBIDAS_PUBLIC_TOKEN_ORIGIN = 'https://tobidas.9rsgy78c9c.workers.dev:443'
const CHROME_ORIGIN_TRIAL_PUBLIC_KEY = Buffer.from(
  '7cc4b89a93ba6ee2d0fd031dfb3266c73b72fd543a07511466aa02534e33a115',
  'hex',
)

interface ChromeOriginTrialPayload {
  origin: string
  feature: string
  expiry: number
  isSubdomain?: boolean
  isThirdParty?: boolean
  usage?: string
}

/** Chrome公開鍵で署名を検証し、別Originや期限切れのトークンを公開ビルドへ混ぜない。 */
function validateChromeWebMcpToken(token: string): ChromeOriginTrialPayload {
  const contents = Buffer.from(token, 'base64')
  if (contents.length < 69 || ![2, 3].includes(contents[0])) {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN の形式またはバージョンが不正です。')
  }
  const payloadLength = contents.readUInt32BE(65)
  const payloadBytes = contents.subarray(69)
  if (payloadBytes.length !== payloadLength) {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN のペイロード長が一致しません。')
  }
  let payload: ChromeOriginTrialPayload
  try {
    payload = JSON.parse(payloadBytes.toString('utf8')) as ChromeOriginTrialPayload
  } catch {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN のペイロードを解釈できません。')
  }
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    CHROME_ORIGIN_TRIAL_PUBLIC_KEY,
  ])
  const publicKey = createPublicKey({ key: spki, format: 'der', type: 'spki' })
  const signedData = Buffer.concat([contents.subarray(0, 1), contents.subarray(65)])
  if (!verify(null, signedData, publicKey, contents.subarray(1, 65))) {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN のChrome署名を確認できません。')
  }
  if (payload.origin !== TOBIDAS_PUBLIC_TOKEN_ORIGIN || payload.feature !== 'WebMCP') {
    throw new Error(`WEBMCP_ORIGIN_TRIAL_TOKEN は ${TOBIDAS_PUBLIC_TOKEN_ORIGIN} 向けのWebMCPトークンではありません。`)
  }
  if (payload.isSubdomain || payload.isThirdParty) {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN はサブドメイン対象とThird-party matchingをOFFにして発行してください。')
  }
  if (!Number.isFinite(payload.expiry) || payload.expiry * 1000 <= Date.now()) {
    throw new Error('WEBMCP_ORIGIN_TRIAL_TOKEN は期限切れです。')
  }
  return payload
}

/**
 * Origin Trialトークンは配信HTMLへ公開される値であり、秘密情報ではない。
 * 期限更新をソース変更から切り離すため、公開ビルド時の環境変数からmetaへ注入する。
 */
function webMcpOriginTrial(tokens: Array<{ token: string; provider: 'chrome' | 'edge' }>): Plugin {
  return {
    name: 'tobidas-webmcp-origin-trial',
    transformIndexHtml: {
      order: 'pre',
      handler: () => tokens.map(({ token, provider }) => ({
        tag: 'meta',
        attrs: {
          'http-equiv': 'origin-trial',
          content: token,
          'data-tobidas-trial': 'webmcp',
          'data-tobidas-trial-provider': provider,
        },
        injectTo: 'head-prepend',
      })),
    },
  }
}

// ビルダー本体 (開発時は /player.html で再生プレビューも同居)
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const chromeToken = env[WEBMCP_ORIGIN_TRIAL_ENV]?.trim() ?? ''
  const edgeToken = env[WEBMCP_EDGE_ORIGIN_TRIAL_ENV]?.trim() ?? ''
  if (mode === 'webmcp-public' && !chromeToken) {
    throw new Error(`${WEBMCP_ORIGIN_TRIAL_ENV} is required for the public WebMCP build.`)
  }
  if (chromeToken) validateChromeWebMcpToken(chromeToken)
  const tokens = [
    ...(chromeToken ? [{ token: chromeToken, provider: 'chrome' as const }] : []),
    ...(edgeToken ? [{ token: edgeToken, provider: 'edge' as const }] : []),
  ]

  return {
    plugins: [react(), ...(tokens.length ? [webMcpOriginTrial(tokens)] : [])],
    server: {
      port: 5174,
      strictPort: true,
    },
  }
})
