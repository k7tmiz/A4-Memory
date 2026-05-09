import { cp, rm, mkdir } from 'fs/promises';
import { existsSync } from 'fs';

const DIST = 'dist';

const FILES = [
  'index.html',
  'records.html',
  'manifest.webmanifest',
];

const DIRS = [
  'css',
  'data',
  'assets',
];

const JS_DIR = 'js';
const CLOUD_JS = 'js/cloud.js';
const CLOUD_STUB = 'js/__cloud_stub.js';

// Clean and recreate dist
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);

// Copy top-level files
await Promise.all(FILES.map(f => cp(f, `${DIST}/${f}`)));

// Copy directories
await Promise.all(DIRS.map(d => cp(d, `${DIST}/${d}`, { recursive: true })));

// Copy js/ directory
await cp(JS_DIR, `${DIST}/${JS_DIR}`, { recursive: true });

// cloud.js handling:
// - If cloud.js exists → already copied above, just remove the stub from dist
// - If cloud.js does NOT exist → copy the stub as cloud.js in dist
const hasCloud = existsSync(CLOUD_JS);

// Always remove the stub from dist (not needed at runtime)
try { await rm(`${DIST}/${CLOUD_STUB}`); } catch { /* not in dist */ }

if (!hasCloud) {
  await cp(CLOUD_STUB, `${DIST}/${CLOUD_JS}`);
  console.warn('⚠  cloud.js not found — using stub (cloud features disabled)');
}

console.log('✅  Build complete → dist/');
