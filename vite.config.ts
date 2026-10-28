import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Worker 子项目（含本地 KV 状态）不属于前端，变动时不要触发刷新
    watch: { ignored: ['**/worker/**', '**/.wrangler/**'] },
  },
})
