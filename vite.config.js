import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        about: resolve(__dirname, 'about.html'),
        notfound: resolve(__dirname, '404.html'),
      },
    },
    modulePrelude: {
        polyfill: false,
    },
  },
});
