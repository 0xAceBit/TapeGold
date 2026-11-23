import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// The one place that says where the site lives. Link previews (og:url, og:image, twitter:image, canonical) must be
// absolute and must point at the address the site really serves from, not at a redirect, or the preview breaks.
// Change it here (or set SITE_URL when building) when you move to a custom domain.
const SITE_URL = (process.env.SITE_URL || 'https://tapegolf.vercel.app').replace(/\/+$/, '')
const siteUrl = (): Plugin => ({ name: 'tapegold-site-url', transformIndexHtml: (html) => html.replaceAll('__SITE_URL__', SITE_URL) })

export default defineConfig({
  // Relative asset URLs, so the built site works from any path: IPFS gateways, ENS/eth.limo, Arweave, plain static hosts.
  base: './',
  plugins: [react(), nodePolyfills(), siteUrl()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
  },
})
