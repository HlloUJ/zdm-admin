import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { digest, inspectPage, pageViolations, templateShape } from './ui-template-policy.mjs';
import { businessFingerprint, contractViolations } from './visual-refactor-contract.mjs';
const refactor = JSON.parse(readFileSync('docs/ui/visual-refactor.json', 'utf8'));
const approvedVisualFiles = new Set(refactor.approvedVisualFiles);
const read = (file) => readFileSync(file, 'utf8');
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name).replaceAll('\\', '/')],
  );
}
test('every current/new business page follows the migration policy; legacy visual inputs remain unchanged', () => {
  const baseline = JSON.parse(read('docs/ui/legacy-visual-baseline.json'));
  const violations = files('src/pages')
    .filter((file) => file.endsWith('.vue'))
    .flatMap((file) =>
      approvedVisualFiles.has(file)
        ? contractViolations(file, read(file), refactor.contracts[file])
        : pageViolations(file, read(file), baseline.pages[file]),
    );
  for (const [file, hash] of Object.entries(baseline.shared))
    if (!approvedVisualFiles.has(file) && digest(read(file)) !== hash)
      violations.push(`${file}: shared legacy visuals are frozen until acceptance`);
  assert.deepEqual(violations, []);
});
test('new inline styles, page CSS, copied tables and legacy style drift are rejected', () => {
  const good = '<template><AdminListPage :table-props="table" /></template><script setup>const table = {};</script>';
  assert.deepEqual(pageViolations('new.vue', good), []);
  assert.ok(pageViolations('new.vue', good + '<style>.x { margin: 5px }</style>').length);
  assert.ok(pageViolations('new.vue', '<template><AdminListPage style="padding: 5px" /><t-table /></template>').length);
  const hash = inspectPage(good).visualDigest;
  assert.deepEqual(
    pageViolations('old.vue', good.replace('const table = {};', 'const table = { data: [] };'), hash),
    [],
  );
  assert.ok(pageViolations('old.vue', good.replace('AdminListPage', 'AdminListPage class="different"'), hash).length);
});
test('official reference snapshots retain their independent upstream bytes', () => {
  const manifest = JSON.parse(read('docs/ui/official-sources.json'));
  for (const [file, record] of Object.entries(manifest.sources))
    assert.equal(digest(readFileSync(file)), record.sha256, file);
  assert.ok(['pending-user-acceptance', 'accepted'].includes(manifest.extension.status));
  const referenceEntry = read('tests/fixtures/official-ui/reference.ts');
  assert.doesNotMatch(referenceEntry, /foundation|src\/styles|@\//);
  assert.deepEqual(
    templateShape(read('tests/fixtures/official-ui/UpstreamReference.vue'), 't-form'),
    templateShape(read('tests/fixtures/official-ui/upstream/src/components/common-table/index.vue'), 't-form'),
  );
});

test('shared/new CSS and component style blocks cannot introduce a second visual standard', () => {
  const baseline = JSON.parse(read('docs/ui/legacy-visual-baseline.json'));
  const allowed = new Set(['src/components/foundation/official/AdminListPage.vue']);
  const problems = [];
  for (const file of files('src')) {
    if (/\.(css|less|scss)$/.test(file)) {
      if (!approvedVisualFiles.has(file) && digest(read(file)) !== baseline.styleFiles[file]) problems.push(file);
    } else if (file.endsWith('.vue')) {
      const page = inspectPage(read(file));
      if (allowed.has(file)) {
        const styles = page.styles.map((style) => style.content).join('\n');
        assert.doesNotMatch(styles, /!important|:deep|\d+(?:px|rem|em|vh|vw|%)/);
      } else if (approvedVisualFiles.has(file)) {
        problems.push(...contractViolations(file, read(file), refactor.contracts[file]));
      } else if (baseline.componentStyles[file]) {
        if (digest(JSON.stringify(page.styles)) !== baseline.componentStyles[file]) problems.push(file);
      } else if (page.styles.length) problems.push(file);
    }
  }
  assert.deepEqual(problems, [], 'Unregistered component/global style changes');
});

test('all frontend business contracts remain identical to the pre-refactor version', () => {
  assert.deepEqual(
    Object.entries(refactor.contracts).flatMap(([file, baseline]) => contractViolations(file, read(file), baseline)),
    [],
  );
});
test('visual migration never authorizes changing business events, copy, conditions or scripts', () => {
  const source =
    '<template><t-input v-model="name" placeholder="请输入" style="width:200px" @change="search" /></template><script setup>const name = "";</script>';
  const baseline = businessFingerprint(source);
  assert.deepEqual(contractViolations('page.vue', source.replace('200px', '100%'), baseline), []);
  for (const modified of [
    source.replace('@change="search"', '@change="reset"'),
    source.replace('请输入', '请选择'),
    source.replace('const name', 'let name'),
    source.replace('v-model="name"', 'v-model="phone"'),
  ]) {
    assert.ok(contractViolations('page.vue', modified, baseline).length);
  }
});

test('approved visual surfaces use official color and shadow tokens', () => {
  for (const file of approvedVisualFiles) {
    const source = read(file);
    const styles = file.endsWith('.vue') ? inspectPage(source).styles.map((s) => s.content) : [source];
    for (const style of styles)
      postcss.parse(style).walkDecls((declaration) => {
        assert.doesNotMatch(declaration.value, /#[a-f\d]{3,8}\b/i, `${file}: use official semantic color tokens`);
        if (declaration.prop === 'box-shadow')
          assert.match(declaration.value, /^(none|var\(--td-shadow-)/, `${file}: use official shadows`);
      });
  }
});

test('approved responsive sidebar additions cannot hide business changes or a different breakpoint', () => {
  const file = 'src/components/AdminSideMenu.vue';
  const source = read(file);
  const baseline = refactor.contracts[file];
  assert.deepEqual(contractViolations(file, source, baseline), []);
  assert.ok(contractViolations(file, source.replace('<= 991', '<= 990'), baseline).length);
  assert.ok(
    contractViolations(file, source.replace('@change="handleMenuChange"', '@change="otherHandler"'), baseline).length,
  );
});
