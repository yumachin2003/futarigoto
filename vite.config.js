import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

function firebaseSwEnvPlugin(env) {
  const replaceEnv = (content) => {
    return content
      .replace(/__FIREBASE_API_KEY__/g, env.VITE_FIREBASE_API_KEY || '')
      .replace(/__FIREBASE_AUTH_DOMAIN__/g, env.VITE_FIREBASE_AUTH_DOMAIN || '')
      .replace(/__FIREBASE_PROJECT_ID__/g, env.VITE_FIREBASE_PROJECT_ID || '')
      .replace(/__FIREBASE_STORAGE_BUCKET__/g, env.VITE_FIREBASE_STORAGE_BUCKET || '')
      .replace(/__FIREBASE_MESSAGING_SENDER_ID__/g, env.VITE_FIREBASE_MESSAGING_SENDER_ID || '')
      .replace(/__FIREBASE_APP_ID__/g, env.VITE_FIREBASE_APP_ID || '')
  }

  return {
    name: 'firebase-sw-env-plugin',
    // 開発サーバー用: /firebase-messaging-sw.js へのアクセス時に動的変換してレスポンス
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/firebase-messaging-sw.js') {
          const swPath = path.resolve(process.cwd(), 'public/firebase-messaging-sw.js')
          if (fs.existsSync(swPath)) {
            const raw = fs.readFileSync(swPath, 'utf-8')
            res.setHeader('Content-Type', 'application/javascript')
            return res.end(replaceEnv(raw))
          }
        }
        next()
      })
    },
    // ビルド用: dist 出力後に dist/firebase-messaging-sw.js を置換
    closeBundle() {
      const distSwPath = path.resolve(process.cwd(), 'dist/firebase-messaging-sw.js')
      if (fs.existsSync(distSwPath)) {
        const raw = fs.readFileSync(distSwPath, 'utf-8')
        fs.writeFileSync(distSwPath, replaceEnv(raw), 'utf-8')
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), firebaseSwEnvPlugin(env)],
  }
})
