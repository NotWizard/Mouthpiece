import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_DEV_SERVER_PORT = 5183
const MARKDOWN_VENDOR_PATTERNS = [
  '/node_modules/react-markdown/',
  '/node_modules/remark-',
  '/node_modules/rehype-',
  '/node_modules/unified/',
  '/node_modules/micromark/',
  '/node_modules/mdast-',
  '/node_modules/hast-',
  '/node_modules/unist-',
  '/node_modules/vfile/',
]
const APP_DICTATION_PATTERNS = [
  '/src/helpers/audioManager.js',
  '/src/hooks/useAudioRecording.js',
  '/src/helpers/clipboard.js',
  '/src/helpers/insertionPlan.js',
  '/src/helpers/textEditMonitor.js',
  '/src/utils/asrSessionTimeline.mjs',
  '/src/utils/streamingSpeechGate.mjs',
]
const APP_REASONING_SERVICE_PATTERNS = [
  '/src/services/ReasoningService.ts',
  '/src/services/BaseReasoningService.ts',
]
const APP_REASONING_POLICY_PATTERNS = [
  '/src/config/prompts.ts',
  '/src/utils/contextClassifier.ts',
  '/src/utils/postProcessingPolicy.ts',
  '/src/utils/terminologyProfile.ts',
  '/src/utils/terminologyMigration.ts',
  '/src/utils/reasoningAvailabilityCacheKey.mjs',
]
const APP_MODEL_DATA_PATTERNS = ['/src/models/modelRegistryData.json']

const parseDevServerPort = (rawPort) => {
  const normalizedPort = rawPort || String(DEFAULT_DEV_SERVER_PORT)
  const parsedPort = Number(normalizedPort)

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return DEFAULT_DEV_SERVER_PORT
  }

  return parsedPort
}

const normalizeModuleId = (id) => id.split(path.sep).join('/')

const resolveVendorChunk = (id) => {
  const normalizedId = normalizeModuleId(id)

  if (!normalizedId.includes('/node_modules/')) {
    return undefined
  }

  if (normalizedId.includes('/node_modules/@radix-ui/')) {
    return 'vendor-radix'
  }

  if (normalizedId.includes('/node_modules/lucide-react/')) {
    return 'vendor-icons'
  }

  if (
    normalizedId.includes('/node_modules/react/') ||
    normalizedId.includes('/node_modules/react-dom/') ||
    normalizedId.includes('/node_modules/scheduler/')
  ) {
    return 'vendor-react'
  }

  if (
    normalizedId.includes('/node_modules/i18next/') ||
    normalizedId.includes('/node_modules/react-i18next/')
  ) {
    return 'vendor-i18n'
  }

  if (MARKDOWN_VENDOR_PATTERNS.some((pattern) => normalizedId.includes(pattern))) {
    return 'vendor-markdown'
  }

  if (
    normalizedId.includes('/node_modules/@neondatabase/') ||
    normalizedId.includes('/node_modules/ws/')
  ) {
    return 'vendor-neon'
  }

  if (normalizedId.includes('/node_modules/zod/')) {
    return 'vendor-zod'
  }

  return undefined
}

const resolveAppChunk = (id) => {
  const normalizedId = normalizeModuleId(id)

  if (APP_DICTATION_PATTERNS.some((pattern) => normalizedId.includes(pattern))) {
    return 'app-dictation'
  }

  if (APP_REASONING_SERVICE_PATTERNS.some((pattern) => normalizedId.includes(pattern))) {
    return 'app-reasoning-service'
  }

  if (APP_REASONING_POLICY_PATTERNS.some((pattern) => normalizedId.includes(pattern))) {
    return 'app-reasoning-policy'
  }

  if (APP_MODEL_DATA_PATTERNS.some((pattern) => normalizedId.includes(pattern))) {
    return 'app-model-data'
  }

  return undefined
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const envDir = path.resolve(__dirname, '..')
  const env = loadEnv(mode, envDir, '')
  const rawPort = env.VITE_DEV_SERVER_PORT || env.MOUTHPIECE_DEV_SERVER_PORT || env.OPENWHISPR_DEV_SERVER_PORT
  const devServerPort = parseDevServerPort(rawPort)

  return {
    plugins: [
      react(),
      tailwindcss(),
      {
        name: 'write-runtime-env',
        writeBundle() {
          const runtimeEnv = {
            VITE_MOUTHPIECE_API_URL: env.VITE_MOUTHPIECE_API_URL || env.VITE_OPENWHISPR_API_URL || '',
            VITE_OPENWHISPR_API_URL: env.VITE_MOUTHPIECE_API_URL || env.VITE_OPENWHISPR_API_URL || '',
            VITE_NEON_AUTH_URL: env.VITE_NEON_AUTH_URL || '',
          }
          fs.writeFileSync(
            path.resolve(__dirname, 'dist', 'runtime-env.json'),
            JSON.stringify(runtimeEnv)
          )
        },
      },
    ],
    base: './', // Use relative paths for file:// protocol in Electron
    envDir, // Load .env from project root
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      port: devServerPort,
      strictPort: true,
      host: '127.0.0.1', // Use IP address instead of localhost for Neon Auth CORS
    },
    build: {
      outDir: 'dist',
      assetsDir: 'assets',
      chunkSizeWarningLimit: 700,
      rollupOptions: {
        external: [
          'electron',
          'fs',
          'path',
          'child_process',
          'https',
          'http',
          'crypto',
          'os',
          'stream',
          'util',
          'zlib',
          'tar',
          'unzipper',
          '@aws-sdk/client-s3'
        ],
        output: {
          manualChunks: (id) => {
            const vendorChunk = resolveVendorChunk(id)
            if (vendorChunk) {
              return vendorChunk
            }

            const appChunk = resolveAppChunk(id)
            if (appChunk) {
              return appChunk
            }

            return undefined
          },
        },
      }
    }
  }
})
