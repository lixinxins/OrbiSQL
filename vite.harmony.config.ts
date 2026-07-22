import { resolve } from 'node:path'
import { readFileSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const harmonyOutDir = resolve(__dirname, 'harmony-client/entry/src/main/resources/rawfile/orbisql')

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [
    react(),
    {
      name: 'orbisql-harmony-inline-bundle',
      closeBundle() {
        const indexPath = resolve(harmonyOutDir, 'index.html')
        let html = readFileSync(indexPath, 'utf8')
        html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_match, fileName: string) => {
          const script = readFileSync(resolve(harmonyOutDir, fileName), 'utf8')
            .replace(/<\/script>/g, '<\\/script>')
            .replace(
              /new URL\("(?!\.|\/|https?:|data:)([^"/]+\.(?:png|jpe?g|svg|webp|gif|mp4|glb|onnx|wasm|woff2?))",import\.meta\.url\)/g,
              'new URL("./assets/$1",import.meta.url)'
            )
          return `<script type="module">${script}</script>`
        })
        html = html.replace(/<link rel="stylesheet" crossorigin href="\.\/(assets\/[^"]+\.css)">/g, (_match, fileName: string) => {
          const style = readFileSync(resolve(harmonyOutDir, fileName), 'utf8')
            .replace(/url\(\.\//g, 'url(./assets/')
            .replace(/url\("\.\//g, 'url("./assets/')
            .replace(/url\('\.\//g, "url('./assets/")
            .replace(/url\(\.\.\/assets\//g, 'url(./assets/')
            .replace(/url\("\.\.\/assets\//g, 'url("./assets/')
            .replace(/url\('\.\.\/assets\//g, "url('./assets/")
            .replace(/<\/style/gi, '<\\/style')
          return `<style>${style}</style>`
        })
        writeFileSync(indexPath, html)
      }
    }
  ],
  define: {
    __ORBISQL_HARMONY__: 'true'
  },
  build: {
    outDir: harmonyOutDir,
    emptyOutDir: true,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})
