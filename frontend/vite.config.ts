import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Capacitor 需要相对路径（file:// 协议加载本地文件）
  base: './',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['sql.js'],
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    // 确保 WASM 文件被正确复制到 dist
    assetsInlineLimit: 0,
  },
});
