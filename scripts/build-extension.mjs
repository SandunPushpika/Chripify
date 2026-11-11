import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const app = resolve(root, 'apps/chrome-extension');
const output = resolve(app, 'dist');
mkdirSync(output, { recursive: true });
const result = spawnSync(
  process.execPath,
  [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', resolve(app, 'tsconfig.json')],
  { stdio: 'inherit' }
);
if (result.status !== 0) process.exit(result.status ?? 1);
cpSync(resolve(app, 'public'), output, { recursive: true });
const manifest = JSON.parse(readFileSync(resolve(output, 'manifest.json'), 'utf8'));
if (
  manifest.manifest_version !== 3 ||
  manifest.host_permissions ||
  manifest.content_scripts ||
  manifest.externally_connectable
)
  throw new Error('Unexpected extension authority. Review the manifest.');
if (
  JSON.stringify(manifest.permissions) !==
  JSON.stringify(['storage', 'activeTab', 'scripting', 'desktopCapture'])
)
  throw new Error('Unexpected permission request.');
if (
  JSON.stringify(manifest.optional_host_permissions) !==
    JSON.stringify(['http://*/*', 'https://*/*']) ||
  manifest.action.default_popup !== 'popup.html'
)
  throw new Error('Unexpected overlay authority or popup.');
const policy = manifest.content_security_policy?.extension_pages ?? '';
if (
  !policy.includes("connect-src 'none'") ||
  !policy.includes("script-src 'self'") ||
  /unsafe-eval|https?:/.test(policy)
)
  throw new Error('Extension CSP must remain local and restrictive.');
const html = readFileSync(resolve(output, 'recorder.html'), 'utf8');
if (/\son[a-z]+\s*=/i.test(html)) throw new Error('Inline event handlers are forbidden.');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (new Set(ids).size !== ids.length) throw new Error('Duplicate UI element IDs.');
const ui = readFileSync(resolve(app, 'src/ui.ts'), 'utf8');
for (const match of ui.matchAll(/(?:element|button|input|select)(?:<[^>]+>)?\('([^']+)'\)/g)) {
  if (!ids.includes(match[1])) throw new Error(`Missing UI control: ${match[1]}`);
}
const popupHtml = readFileSync(resolve(output, 'popup.html'), 'utf8');
if (/\son[a-z]+\s*=/i.test(popupHtml)) throw new Error('Inline popup handlers are forbidden.');
const popupIds = [...popupHtml.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
if (new Set(popupIds).size !== popupIds.length) throw new Error('Duplicate popup IDs.');
const popupSource = readFileSync(resolve(app, 'src/popup.ts'), 'utf8');
for (const match of popupSource.matchAll(/(?<![.\w])get(?:<[^>]+>)?\('([^']+)'\)/g)) {
  if (!popupIds.includes(match[1])) throw new Error(`Missing popup control: ${match[1]}`);
}
const classicScript = readFileSync(resolve(output, 'content.js'), 'utf8');
if (/^\s*(import|export)\s/m.test(classicScript))
  throw new Error('The page overlay must remain a classic content script.');
const captureSource = readFileSync(resolve(output, 'media.js'), 'utf8');
if (/requestAnimationFrame|requestVideoFrameCallback|\.captureStream\(/.test(captureSource))
  throw new Error('Encoded camera video must not depend on document presentation callbacks.');
const workerSource = readFileSync(resolve(output, 'compositor-worker.js'), 'utf8');
if (
  /\bdocument\s*\.|requestAnimationFrame\s*\(|requestVideoFrameCallback\s*\(|setInterval\s*\(/.test(
    workerSource
  )
)
  throw new Error(
    'The frame compositor must stay independent of page rendering and interval timers.'
  );
for (const file of readdirSync(output)) {
  if (
    !/^(background|domain|engine|media|storage|ui|content|popup|effects|integration|desktop-source|lifecycle|compositor(?:-core|-protocol|-worker)?)\.js$|^(manifest\.json|recorder\.html|recorder\.css|popup\.html|popup\.css|icon\.png)$/.test(
      file
    )
  )
    throw new Error(`Unexpected file in distributable: ${file}`);
  if (file.endsWith('.js')) {
    const source = readFileSync(resolve(output, file), 'utf8');
    for (const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      if (!match[1].startsWith('./') || !existsSync(resolve(output, match[1])))
        throw new Error('Missing or non-local runtime module.');
    }
  }
}
console.log(`Chrome extension built: ${output}`);
console.log(
  `Validated manifest, CSP, module closure, classic overlay, ${ids.length} main controls and ${popupIds.length} popup controls.`
);
console.log('Load this folder using chrome://extensions → Developer mode → Load unpacked.');
