import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
if (process.platform !== 'darwin') {
  console.log('Native capture helper is implemented only on macOS.');
  process.exit(0);
}
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'apps/desktop/src-tauri/binaries');
mkdirSync(output, { recursive: true });
const cache = resolve(root, '.cache/swift');
mkdirSync(cache, { recursive: true });
const target = process.arch === 'arm64' ? 'arm64-apple-macosx15.0' : 'x86_64-apple-macosx15.0';
const result = spawnSync(
  '/usr/bin/xcrun',
  [
    'swiftc',
    '-parse-as-library',
    '-swift-version',
    '5',
    '-target',
    target,
    '-module-cache-path',
    cache,
    '-O',
    resolve(root, 'apps/desktop/native/Capture.swift'),
    '-o',
    resolve(output, 'chripify-capture'),
  ],
  { stdio: 'inherit' }
);
process.exit(result.status ?? 1);
