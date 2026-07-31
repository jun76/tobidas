import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// サイト書き出し用: プレイヤー (再生ランタイム) のみをバンドルする。
// 成果物は scripts/embed-player.mjs が public/player/ へ同梱し、
// ビルダーの「サイト書き出し」がブラウザ内で .site.zip に束ねる
export default defineConfig({
  plugins: [react()],
  base: './',
  // public/ には前回ビルドの同梱プレイヤー (public/player/) があるため取り込まない
  publicDir: false,
  build: {
    outDir: 'dist-player',
    rollupOptions: {
      input: resolve(__dirname, 'player.html'),
    },
  },
})
