import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import os from 'os';

function getLocalIPv4() {
  const interfaces = os.networkInterfaces();
  const allIps = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface && iface.family === 'IPv4' && !iface.internal) {
        if (
          iface.address.startsWith('192.168.') ||
          iface.address.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(iface.address)
        ) {
          return iface.address;
        }
        allIps.push(iface.address);
      }
    }
  }
  return allIps[0] || '127.0.0.1';
}

function hostInfoPlugin() {
  return {
    name: 'host-info-plugin',
    configureServer(server) {
      server.middlewares.use('/api/host-info', (req, res) => {
        const ip = getLocalIPv4();
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(JSON.stringify({ ip, success: true }));
      });
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [svelte(), hostInfoPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
