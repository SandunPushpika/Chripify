import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const build = spawnSync(process.execPath, [resolve(root, 'scripts/build-extension.mjs')], {
  stdio: 'inherit',
});

if (build.status !== 0) process.exit(build.status ?? 1);

const code = `
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root = Path(${JSON.stringify(root)})
source = root / 'apps/chrome-extension/dist'
output = root / 'apps/chrome-extension/chripify-extension.zip'
with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
    for path in sorted(source.rglob('*')):
        if path.is_file(): archive.write(path, path.relative_to(source))
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert 'manifest.json' in archive.namelist()
print('Packaged and verified:', output)
`;
const result = spawnSync('python3', ['-c', code], { stdio: 'inherit' });
process.exit(result.status ?? 1);
