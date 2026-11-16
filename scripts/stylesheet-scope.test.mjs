import { classifyChangedFiles } from './verification-impact.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { stylesheetScope } from './stylesheet-scope.mjs';
import { deliveryStandardRule, deliveryStandardPlan } from './delivery-standard.mjs';
function fixture(t) {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), 'style-consumer-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'src'));
  return root;
}
test('actual global entry is shared while raw/importless CSS cannot prove local nature', (t) => {
  assert.equal(deliveryStandardRule('src/styles/index.css').level, 'R3');
  assert.equal(
    stylesheetScope(process.cwd(), 'src/styles/index.css').consumers.some((c) => c.file === 'src/main.ts' && !c.scoped),
    true,
  );
  const root = fixture(t);
  writeFileSync(path.join(root, 'src/stock.css'), '.x {color:red}');
  assert.equal(deliveryStandardRule('src/stock.css', { root }).level, 'R4');
  const impact = classifyChangedFiles(['src/stock.css'], { root, engineeringProof: { proven: true } });
  const plan = deliveryStandardPlan({ root, files: ['src/stock.css'], impact });
  assert.equal(impact.full, true);
  assert.equal(plan.unknownScope, true);
  assert.deepEqual(plan.domains, ['frontend', 'backend', 'engineering']);
  writeFileSync(path.join(root, 'src/read.ts'), "import css from './stock.css?raw'; export default css;");
  assert.equal(deliveryStandardRule('src/stock.css', { root }).level, 'R4');
});
test('real Vite Vue pipeline scopes external CSS imported by scoped style; only that proven case is R1', async (t) => {
  const root = fixture(t);
  writeFileSync(path.join(root, 'src/stock.css'), '.fixture-scoped { color: red; }');
  writeFileSync(
    path.join(root, 'src/App.vue'),
    '<template><div class="fixture-scoped">fixture</div></template><style scoped>@import url("./stock.css");</style>',
  );
  writeFileSync(
    path.join(root, 'src/main.js'),
    "import {createApp} from 'vue'; import App from './App.vue'; createApp(App).mount('#app');",
  );
  writeFileSync(
    path.join(root, 'index.html'),
    '<div id="app"></div><script type="module" src="/src/main.js"></script>',
  );
  const { build } = await import('vite'),
    { default: vue } = await import('@vitejs/plugin-vue');
  const result = await build({
    root,
    configFile: false,
    plugins: [vue()],
    logLevel: 'silent',
    build: { write: false, minify: false, cssMinify: false, cssCodeSplit: false, rollupOptions: { external: ['vue'] } },
  });
  const css = result.output
    .filter((item) => item.type === 'asset' && item.fileName.endsWith('.css'))
    .map((item) => String(item.source))
    .join('\n');
  assert.match(
    css,
    /\.fixture-scoped\[data-v-[a-f0-9]+\]/,
    'Installed Vite/plugin-vue must actually scope imported selectors',
  );
  assert.doesNotMatch(css, /\.fixture-scoped\s*\{/);
  assert.equal(stylesheetScope(root, 'src/stock.css').shared, false);
  assert.equal(deliveryStandardRule('src/stock.css', { root }).level, 'R1');
  writeFileSync(path.join(root, 'src/global.ts'), "import './stock.css';");
  assert.equal(deliveryStandardRule('src/stock.css', { root }).level, 'R3');
});
