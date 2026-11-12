import { cpSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';

/**
 * Build step: the application is server-rendered, so "build" copies static
 * assets into dist/ and validates that every server module parses. It fails
 * loudly instead of producing a broken deploy.
 */
const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');

if (existsSync(dist)) rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

cpSync(path.join(root, 'src', 'public'), path.join(dist, 'public'), { recursive: true });

// Import every route and lib module so syntax or import errors fail the build.
const modules = [
  'src/server.js',
  'src/routes/public.js',
  'src/routes/auth.js',
  'src/routes/workspace.js',
  'src/routes/site.js',
  'src/routes/api.js',
  'src/routes/admin.js',
  'src/routes/webhooks.js',
];

let failed = 0;
for (const rel of modules) {
  const file = path.join(root, rel);
  if (!existsSync(file)) {
    console.error(`missing module: ${rel}`);
    failed += 1;
    continue;
  }
  try {
    await import(`file://${file}`);
    console.log(`ok ${rel}`);
  } catch (err) {
    console.error(`fail ${rel}: ${err.message}`);
    failed += 1;
  }
}

if (failed) {
  console.error(`build failed: ${failed} module(s) did not load`);
  process.exit(1);
}
console.log('build complete: static assets copied, all modules load');
