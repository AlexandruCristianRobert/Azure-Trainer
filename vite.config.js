import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  base: '/',
  plugins: [vue()],
  server: { port: 5175 },
  build: { rollupOptions: { output: { manualChunks: { vendor: ['vue', 'pinia', 'vue-router'] } } } },
  test: { environment: 'node', exclude: [...configDefaults.exclude, '**/.superpowers/**'] },
})
