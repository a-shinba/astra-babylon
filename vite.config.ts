import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: '127.0.0.1', port: 53147, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@babylonjs/core')) return 'babylon';
        },
      },
    },
  },
});
