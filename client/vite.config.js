import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const MOCK_MODULE = /[\/]src[\/](mock-data|services[\/]mock)[\/][^\/]+\.js$/;

/**
 * In API mode the demo implementation (seed data, demo password, simulated AI,
 * browser storage) must not ship. Every module under src/mock-data and
 * src/services/mock is replaced by a stub with the same export names; calling
 * any of them throws. The service layer only reaches them in mock mode.
 */
function excludeMockModules() {
  return {
    name: 'studioflow:exclude-mock-modules',
    enforce: 'pre',
    transform(code, id) {
      if (!MOCK_MODULE.test(id)) return null;
      const ast = this.parse(code);
      const names = new Set();
      const reexports = [];
      for (const node of ast.body) {
        if (node.type === 'ExportNamedDeclaration') {
          const d = node.declaration;
          if (d?.type === 'VariableDeclaration') d.declarations.forEach((v) => v.id.type === 'Identifier' && names.add(v.id.name));
          else if (d?.id) names.add(d.id.name);
          node.specifiers?.forEach((s) => names.add(s.exported.name ?? s.exported.value));
        } else if (node.type === 'ExportAllDeclaration') {
          reexports.push(`export * from ${JSON.stringify(node.source.value)};`);
        } else if (node.type === 'ExportDefaultDeclaration') {
          names.add('default');
        }
      }
      const lines = [
        'const disabled = (name) => function demoModeDisabled() { throw new Error(`Demo mode is not included in this build (${name}).`); };',
        ...reexports,
        ...[...names].filter((n) => n !== 'default').map((n) => `export const ${n} = disabled(${JSON.stringify(n)});`),
      ];
      if (names.has('default')) lines.push('export default disabled("default");');
      return { code: lines.join('\n'), map: null };
    },
    // public/samples holds the demo workspace's sample files — not part of an API build.
    writeBundle(options) {
      fs.rmSync(path.join(options.dir || 'dist', 'samples'), { recursive: true, force: true });
    },
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const mock = env.VITE_DATA_MODE === 'mock';
  if (command === 'build' && mock && env.VITE_ALLOW_DEMO_BUILD !== 'true') {
    throw new Error(
      'Refusing to build in demo (mock) mode: it ships fake data and demo passwords. ' +
        'Set VITE_DATA_MODE=api for production, or VITE_ALLOW_DEMO_BUILD=true for an intentional demo build.',
    );
  }
  if (!mock) {
    const missing = ['VITE_API_BASE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'].filter((k) => !env[k]);
    if (command === 'build' && missing.length) throw new Error(`Missing required build variables for API mode: ${missing.join(', ')}`);
  }
  return {
    plugins: [react(), tailwindcss(), ...(mock ? [] : [excludeMockModules()])],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    build: {
      chunkSizeWarningLimit: 1200,
    },
  };
});
