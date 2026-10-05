import { defineNitroConfig } from 'nitro/config';
export default defineNitroConfig({
  preset: 'vercel',
  modules: ['workflow/nitro'],
  vercel: { entryFormat: 'node', functions: { maxDuration: 300 } },
  routes: { '/**': { handler: './src/vercel.js', format: 'node' } },
  publicAssets: [{ dir: 'dist', maxAge: 0 }],
});
