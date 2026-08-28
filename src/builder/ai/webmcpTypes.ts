/**
 * WebMCPの実験的なブラウザAPIを、tobidasの型境界へ閉じ込める。
 * 非対応ブラウザでもこの型だけでビルドできるよう、DOMのambient拡張は行わない。
 */
export interface WebMcpToolAnnotations {
  readOnlyHint?: boolean
  untrustedContentHint?: boolean
}

export interface WebMcpTool {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  annotations?: WebMcpToolAnnotations
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown
}

export interface WebMcpModelContext {
  registerTool(tool: WebMcpTool, options?: { signal?: AbortSignal; exposedTo?: string[] }): Promise<void>
}

export function getWebMcpModelContext(): WebMcpModelContext | null {
  if (typeof document === 'undefined') return null
  const candidates = [
    (document as Document & { modelContext?: unknown }).modelContext,
    typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { modelContext?: unknown }).modelContext,
  ]
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue
    const registerTool = (candidate as { registerTool?: unknown }).registerTool
    if (typeof registerTool === 'function') return candidate as WebMcpModelContext
  }
  return null
}
