import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

if (process.platform !== 'darwin') {
  console.log('Native argument validation requires macOS.');
  process.exit(0);
}
const executable = resolve(
  import.meta.dirname,
  '../apps/desktop/src-tauri/binaries/chripify-capture'
);
// These inputs fail before any OS permission request or capture initialization.
for (const args of [
  [],
  ['--invalid'],
  ['1', '/private/tmp/never-created.mp4', '999'],
  ['1', 'relative.mp4', '30'],
]) {
  const result = spawnSync(executable, args, { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 1, `Invalid input must fail: ${JSON.stringify(args)}`);
  const event = JSON.parse(result.stdout);
  assert.equal(event.event, 'failed');
  assert.equal(event.code, 'capture_unavailable');
  assert.equal(result.stderr, '');
}
console.log('Native helper: 4 invalid-input cases passed without requesting capture.');
