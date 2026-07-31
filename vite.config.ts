import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// ビルダー本体 (開発時は /player.html で再生プレビューも同居)
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: true,
  },
})
