import { displayTextViolations } from './display-text-policy.mjs';
import { confirmationRegistryViolations, confirmationViolations } from './confirmation-policy.mjs';
import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import postcss from 'postcss';
import { digest, inspectPage, listLayoutViolations, pageViolations, templateShape } from './ui-template-policy.mjs';
import { typographyViolations } from './typography-policy.mjs';
import {
  buttonColorViolations,
  registryViolations,
  buttonClasses,
  buttonStyleViolations,
  isApprovedOrderReferenceBorder,
} from './button-color-policy.mjs';
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
  const allowed = new Set([
    'src/components/foundation/official/AdminListPage.vue',
    'src/components/foundation/AdminListToolbar.vue',
  ]);
  const problems = [];
  for (const file of files('src')) {
    if (/\.(css|less|scss)$/.test(file)) {
      const queryStandard = JSON.parse(read('docs/ui/official-sources.json')).queryStandard;
      if (
        file !== queryStandard.stylesheet &&
        !JSON.parse(read('docs/ui/official-sources.json')).formStyleStandard.stylesheets.includes(file) &&
        !approvedVisualFiles.has(file) &&
        digest(read(file)) !== baseline.styleFiles[file]
      )
        problems.push(file);
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

test('approved visual surfaces use official tokens or exact user-approved local declarations', () => {
  const approvals = refactor.approvedVisualDeclarations ?? [];
  const consumed = new Set();
  const matchesApproval = (entry, file, declaration) =>
    entry.file === file &&
    entry.selector === declaration.parent.selector &&
    entry.property === declaration.prop &&
    entry.value === declaration.value;
  for (const entry of approvals) {
    assert.ok(
      approvedVisualFiles.has(entry.file) && entry.reason,
      'Local visual approvals must have a registered surface and reason',
    );
    // An approval never authorizes a different surface, selector, property or value.
    const declaration = { parent: { selector: entry.selector }, prop: entry.property, value: entry.value };
    assert.equal(matchesApproval(entry, `${entry.file}.other`, declaration), false);
    assert.equal(matchesApproval(entry, entry.file, { ...declaration, value: '#ff0000' }), false);
    assert.equal(matchesApproval(entry, entry.file, { ...declaration, prop: 'border-color' }), false);
    assert.equal(matchesApproval(entry, entry.file, { ...declaration, parent: { selector: '.other' } }), false);
  }
  for (const file of approvedVisualFiles) {
    const source = read(file);
    const styles = file.endsWith('.vue') ? inspectPage(source).styles.map((s) => s.content) : [source];
    for (const style of styles)
      postcss.parse(style).walkDecls((declaration) => {
        if (
          /#[a-f\d]{3,8}\b/i.test(declaration.value) ||
          (declaration.prop === 'box-shadow' && !/^(none|var\(--td-shadow-)/.test(declaration.value))
        ) {
          const approval = approvals.find((entry) => matchesApproval(entry, file, declaration));
          assert.ok(approval, `${file}: unapproved local color at ${declaration.parent.selector}: ${declaration.prop}`);
          consumed.add(approval);
        }
        if (declaration.prop === 'box-shadow' && !approvals.some((entry) => matchesApproval(entry, file, declaration)))
          assert.match(declaration.value, /^(none|var\(--td-shadow-)/, `${file}: use official shadows`);
      });
  }
  assert.equal(consumed.size, approvals.length, 'Local visual approvals must remain exact and used');
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

test('approved decimal bug-fix patches retain the original contract and reject unrelated edits', () => {
  const before = '<template><t-input-number v-model="coefficient" /></template>';
  const after = before.replace('t-input-number', 'DecimalInput');
  const baseline = {
    ...businessFingerprint(before),
    approvedBusinessPatches: [{ reason: 'User confirmed decimal editing fix', before, after }],
  };
  assert.deepEqual(contractViolations('price.vue', after, baseline), []);
  assert.ok(contractViolations('price.vue', after + '<script setup>const changed = true;</script>', baseline).length);
  assert.ok(contractViolations('price.vue', after.replace('coefficient', 'quantity'), baseline).length);
  assert.ok(
    contractViolations('price.vue', after, {
      ...baseline,
      approvedBusinessPatches: [{ reason: '', before, after }],
    }).length,
  );
});

test('explicit non-Vue business patches retain original hashes and reject unrelated changes', () => {
  const before = 'export const filter = { actor: true, date: true };';
  const after = 'export const filter = { actor: true };';
  const baseline = {
    content: digest(before),
    approvedBusinessPatches: [{ reason: 'User removed date filtering', before, after }],
  };
  assert.deepEqual(contractViolations('filter.ts', after, baseline), []);
  assert.ok(contractViolations('filter.ts', after.replace('actor', 'operator'), baseline).length);
  assert.ok(contractViolations('filter.ts', after + '\nexport const unrelated = true;', baseline).length);
});

test('new modules cannot opt out of the accepted query layout', () => {
  for (const layout of ['inline', 'official-grid']) {
    assert.ok(pageViolations('new.vue', `<template><AdminListPage filter-layout="${layout}" /></template>`).length);
  }
  assert.ok(pageViolations('new.vue', '<template><AdminListPage :filter-layout="choice" /></template>').length);
  assert.ok(pageViolations('new.vue', '<template><AdminListPage filterLayout="inline" /></template>').length);
  assert.ok(pageViolations('new.vue', '<template><AdminListPage :filterLayout="choice" /></template>').length);
  assert.ok(pageViolations('new.vue', '<template><AdminListPage v-bind="unknownProps" /></template>').length);
  assert.deepEqual(
    pageViolations('new.vue', '<template><AdminListPage filter-layout="adaptive-grid" /></template>'),
    [],
  );
});

test('accepted query standard has a single shared implementation and default entry', () => {
  const standard = JSON.parse(read('docs/ui/official-sources.json')).queryStandard;
  assert.equal(standard.status, 'accepted');
  assert.equal(standard.layout, 'adaptive-grid');
  assert.deepEqual(standard.rules.areaRatio, [10, 2]);
  assert.equal(standard.rules.maxColumns, 4);
  assert.equal(standard.rules.rowGapPx, 24);
  assert.equal(standard.rules.toolbarGapPx, 24);
  const entry = read('src/components/foundation/official/AdminListPage.vue');
  assert.match(entry, /filterLayout: 'adaptive-grid'/);
  assert.ok(entry.includes('src="./query-layout.css"'));
  const slab = read(standard.referencePage);
  assert.ok(slab.includes('src="../../../components/foundation/official/query-layout.css"'));
  assert.doesNotMatch(slab, /--slab-filter-max-columns|repeat\(auto-fill/);
  const css = read(standard.stylesheet);
  assert.match(css, /minmax\(0, 10fr\) minmax\(0, 2fr\)/);
  assert.match(css, /--zdm-query-max-columns: var\(--zdm-query-column-cap, 4\)/);
  assert.match(css, /--zdm-query-column-cap: 3/);
  assert.equal(JSON.parse(read('docs/ui/official-sources.json')).queryStandard.variants.log.maxColumns, 3);
  assert.match(read('src/components/product-logs/ProductOperationLogTemplate.vue'), /data-query-layout="log"/);
  assert.doesNotMatch(css, /--zdm-query-max-columns: 5|!important|#[a-f\d]{3,8}\b/i);
});

test('all existing query forms use the shared standard and no page keeps conflicting query CSS', () => {
  const pages = files('src/pages').filter((file) => file.endsWith('.vue'));
  pages.push('src/components/product-logs/ProductOperationLogTemplate.vue');
  for (const file of pages) {
    const source = read(file);
    const inspected = inspectPage(source);
    for (const classes of inspected.queryForms) assert.ok(classes.split(/\s+/).includes('zdm-standard-query'), file);
    if (inspected.queryForms.length) {
      for (const style of inspected.styles) {
        postcss.parse(style.content).walkRules((rule) => {
          for (const selector of postcss.list.comma(rule.selector))
            assert.doesNotMatch(
              selector.trim(),
              /^\.(?:filter-row|filter-fields|filter-actions|filter-primary-row|filter-secondary-row|pool-filter-fields|operation-log-filters|operation-log-filter-actions)\b/,
              file,
            );
        });
      }
    }
    if (source.includes('<AdminListPage'))
      assert.ok(!inspected.queryLayouts.some((layout) => layout !== 'adaptive-grid'), file);
  }
});

test('current and future editable controls follow the global placeholder standard', async () => {
  const { placeholderViolations } = await import('./placeholder-policy.mjs');
  const violations = files('src')
    .filter((file) => file.endsWith('.vue'))
    .flatMap((file) => placeholderViolations(file, read(file)));
  assert.deepEqual(violations, []);
  const sample = (hint) => `<template><t-form-item label="长度（mm）"><t-input ${hint} /></t-form-item></template>`;
  assert.deepEqual(placeholderViolations('new.vue', sample('placeholder="请输入长度（mm）"')), []);
  assert.equal(placeholderViolations('new.vue', sample('placeholder="请输入长度"')).length, 1);
  assert.equal(placeholderViolations('new.vue', sample('placeholder="请输入"')).length, 1);
  assert.equal(placeholderViolations('new.vue', sample('')).length, 1);
  assert.equal(
    placeholderViolations(
      'new.vue',
      '<template><t-form-item label="产地"><t-select placeholder="请选择供应商" /></t-form-item></template>',
    ).length,
    1,
  );
});

test('placeholder approvals do not permit unrelated title or event changes', () => {
  const before =
    '<template><t-form-item label="产地"><t-select placeholder="请选择" @change="save" /></t-form-item></template>';
  const after = before.replace('placeholder="请选择"', 'placeholder="请选择产地"');
  const baseline = {
    ...businessFingerprint(before),
    approvedPlaceholderPatches: [{ reason: 'User approved placeholder standard', before, after }],
  };
  assert.deepEqual(contractViolations('sample.vue', after, baseline), []);
  assert.ok(contractViolations('sample.vue', after.replace('label="产地"', 'label="供应商"'), baseline).length);
  assert.ok(contractViolations('sample.vue', after.replace('@change="save"', '@change="remove"'), baseline).length);
});

test('compound query inputs use explicit scope while ordinary and edit fields retain their title rules', async () => {
  const { placeholderViolations } = await import('./placeholder-policy.mjs');
  const control =
    '<t-form-item label="大板"><t-input data-query-search-scope="大板名称/ID/编号" placeholder="请输入大板名称/ID/编号" /></t-form-item>';
  const query = `<template><t-form class="zdm-standard-query">${control}</t-form></template>`;
  assert.deepEqual(placeholderViolations('new.vue', query), []);
  assert.equal(placeholderViolations('edit.vue', query.replace('zdm-standard-query', 'editor')).length, 1);
  assert.equal(
    placeholderViolations('new.vue', query.replace('data-query-search-scope="大板名称/ID/编号"', '')).length,
    1,
  );
  assert.equal(
    placeholderViolations('new.vue', query.replace('placeholder="请输入大板名称/ID/编号"', 'placeholder="请输入大板"'))
      .length,
    1,
  );
  assert.equal(placeholderViolations('new.vue', query.replace('<t-input ', '<t-select ')).length, 1);
  const mapping = {
    'src/pages/finished-stock/supply-chain/index.vue': ['商品', '商品名称/ID'],
    'src/pages/finished-stock/management/index.vue': ['商品', '商品名称/ID'],
    'src/pages/finished-stock/store/index.vue': ['商品', '商品名称/ID/编号'],
    'src/pages/slab/supply-chain/index.vue': ['大板', '大板名称/ID/编号'],
    'src/pages/slab/management/index.vue': ['大板', '大板名称/ID/编号'],
  };
  for (const [file, [label, scope]] of Object.entries(mapping)) {
    const source = read(file);
    assert.ok(source.includes(`<t-form-item label="${label}"`), file);
    assert.ok(source.includes(`data-query-search-scope="${scope}"`), file);
    assert.ok(source.includes(`placeholder="请输入${scope}"`), file);
  }
});

test('list pages use one header-free toolbar standard without changing editor/dialog toolbars', () => {
  const pages = files('src/pages').filter(
    (file) => file.endsWith('/index.vue') || file.endsWith('/price-configuration.vue'),
  );
  assert.deepEqual(
    pages.flatMap((file) => listLayoutViolations(file, read(file))),
    [],
  );
  assert.ok(listLayoutViolations('new.vue', '<template><AdminPageHeader /></template>').length);
  assert.ok(listLayoutViolations('new.vue', '<template><div class="table-toolbar" /></template>').length);
  assert.deepEqual(
    listLayoutViolations(
      'new.vue',
      '<template><AdminListToolbar/><AdminDialog><div class="table-toolbar"/></AdminDialog></template>',
    ),
    [],
  );
  for (const file of [
    'src/pages/finished-stock/supply-chain/index.vue',
    'src/pages/finished-stock/management/index.vue',
    'src/pages/finished-stock/store/index.vue',
    'src/pages/slab/supply-chain/index.vue',
    'src/pages/slab/management/index.vue',
  ]) {
    const source = read(file);
    assert.match(source, /<AdminListToolbar/);
    assert.match(source, /#auxiliary\s*>[\s\S]*?操作日志/);
    assert.doesNotMatch(source, /class="page-header"/);
  }
  const manifest = JSON.parse(read('docs/ui/official-sources.json'));
  assert.equal(manifest.listStandard.entry, 'AdminListPage');
  assert.equal(manifest.listStandard.compatibilityEntry, 'AdminListToolbar');
  assert.ok(read(manifest.listStandard.spec).includes('batch: true'));
});

test('all interface typography uses official tokens and preserves the rich text exception', () => {
  const manifest = JSON.parse(read('docs/ui/official-sources.json'));
  const standard = manifest.typographyStandard;
  const tokens = new Set(
    [...read(standard.tokens).matchAll(/(--td-(?:font|line-height)-[\w-]+)\s*:/g)].map((match) => match[1]),
  );
  assert.ok(tokens.has('--td-font-mark-medium'));
  assert.deepEqual(
    files('src')
      .filter((file) => /\.(vue|css|less|scss)$/.test(file))
      .flatMap((file) => typographyViolations(file, read(file), tokens, standard.richTextExclusion)),
    [],
  );
  assert.ok(
    typographyViolations('new.css', '.x { font-size: 15px; line-height: 20px; font-weight: 700 }', tokens).length,
  );
  assert.ok(typographyViolations('new.css', '.x { font: var(--td-font-missing) }', tokens).length);
  assert.ok(typographyViolations('new.css', '.x { font-size: var(--td-font-body-medium) }', tokens).length);
  assert.ok(typographyViolations('new.css', ':root { --td-font-body-medium: 12px }', tokens).length);
  assert.ok(
    typographyViolations(
      'new.css',
      '.form-section-title { font-weight: 400; font: var(--td-font-title-large) }',
      tokens,
    ).length,
  );
  assert.deepEqual(
    typographyViolations(
      'new.css',
      '.form-section-title { font: var(--td-font-title-large); font-weight: 400 }',
      tokens,
    ),
    [],
  );
  assert.deepEqual(
    typographyViolations(
      standard.richTextExclusion,
      '<template><div/></template><style>.historical-rich-text { line-height: 1.5 }</style>',
      tokens,
      standard.richTextExclusion,
    ),
    [],
  );
  assert.ok(typographyViolations('new.css', '.x { line-height: 1.5 }', tokens, standard.richTextExclusion).length);
  assert.match(read(standard.formReference), /font: var\(--td-font-title-large\);\s*font-weight: 400/);
  for (const file of [
    'src/pages/finished-stock/shared/index.css',
    'src/pages/slab/management/components/SlabProductFormLayout.vue',
  ]) {
    assert.match(read(file), /\.form-section-title\s*\{[^}]*font: var\(--td-font-title-large\);[^}]*font-weight: 400;/);
  }
});

test('form layout and Upload visuals use one registered official implementation', () => {
  const standard = JSON.parse(read('docs/ui/official-sources.json')).formStyleStandard;
  assert.deepEqual(standard.fieldGapPx, [24, 32]);
  assert.equal(standard.uploadCardSizePx, 110);
  const css = read(standard.stylesheets[0]);
  const media = read(standard.stylesheets[1]);
  assert.doesNotMatch(css, /--zdm-upload-card-size|\.upload-grid/);
  assert.doesNotMatch(css, /\.admin-layout\s+\.(?:form-grid|form-section-title|upload-grid)/);
  assert.match(css, /margin: var\(--td-comp-margin-xxl\) 0 var\(--td-comp-margin-xl\)/);
  assert.match(css, /gap: var\(--td-comp-margin-xxl\) var\(--td-comp-margin-xxxl\)/);
  assert.match(css, /margin-bottom: 0/);
  assert.match(css, /padding: var\(--td-comp-paddingTB-l\) var\(--td-comp-paddingLR-xl\)/);

  assert.match(media, /border-color: var\(--td-error-color\)/);
  assert.match(read('src/components/foundation/AdminMediaUpload.vue'), /<t-upload/);
  for (const file of ['src/pages/finished-stock/shared/index.css', 'src/pages/slab/shared/index.css']) {
    assert.doesNotMatch(read(file), /repeat\(auto-fit, 180px\)|height: 132px|padding: 14px|gap: 12px 28px/);
  }
  for (const file of standard.stylesheets) {
    assert.doesNotMatch(read(file), /!important|#[a-f\d]{3,8}\b/i);
  }
  assert.match(
    read('tests/fixtures/official-ui/upstream/vendor/tdesign-vue-next/es/upload/style/index.css'),
    /width: 110px;\s*height: 110px/,
  );
});

test('all independent image/video uploads share native Upload and leave rich text and attachments separate', () => {
  const component = read('src/components/foundation/AdminMediaUpload.vue');
  assert.match(component, /<t-upload/);
  assert.match(component, /theme="image"/);
  assert.match(component, /value\?\.coverUrl/);
  assert.doesNotMatch(component, /<style|:style=|style=|:deep/);
  const validationStyles = postcss.parse(read('src/components/foundation/official/media-upload.css'));
  const declarations = [];
  validationStyles.walkDecls((declaration) => declarations.push([declaration.prop, declaration.value]));
  assert.deepEqual(declarations, [['border-color', 'var(--td-error-color)']]);
  for (const file of [
    'src/pages/finished-stock/supply-chain/index.vue',
    'src/pages/finished-stock/management/index.vue',
    'src/pages/slab/supply-chain/index.vue',
    'src/pages/slab/management/index.vue',
    'src/pages/craft/finished-stock/index.vue',
  ]) {
    assert.match(read(file), /<AdminMediaUpload/);
    assert.match(read(file), /import\s*\{[^}]*\bAdminMediaUpload\b[^}]*\}\s*from\s*'@\/components\/foundation'/);
    assert.doesNotMatch(read(file), /SupplyChainNativeMediaUpload|class="upload-grid/);
  }
  for (const file of files('src').filter((file) => /\.(vue|css)$/.test(file))) {
    assert.doesNotMatch(
      read(file),
      /admin-media-upload__|supply-chain-native-media-upload|\.spec-upload-box|\.craft-media-upload|\.upload-grid|--zdm-upload-card-size/,
      `${file}: obsolete upload skin or layout`,
    );
  }
  assert.match(
    read('src/components/foundation/index.ts'),
    /export \{ default as AdminMediaUpload \} from '\.\/AdminMediaUpload\.vue'/,
  );
  assert.doesNotMatch(read('src/components/foundation/official/AdminOfficialMediaUpload.vue'), /<AdminMediaUpload/);
  assert.doesNotMatch(read('src/components/ProductRichEditor.vue'), /<AdminMediaUpload|<t-upload/);
  assert.match(read('src/pages/customer/index.vue'), /<CustomerFollowupAttachments/);
  const attachments = read('src/components/customer/CustomerFollowupAttachments.vue');
  assert.match(attachments, /theme="file"/);
  assert.match(attachments, /:max="3"/);
  assert.match(attachments, /#file-list-display/);
  assert.doesNotMatch(attachments, /<AdminMediaUpload|<style/);
  assert.match(read('src/pages/finished-stock/supply-chain/index.vue'), /<ProductRichEditor/);
  assert.match(read('src/pages/finished-stock/management/index.vue'), /<ProductRichEditor/);
});

test('manual native form error states always include field messages and error text stays enabled', () => {
  const violations = [];
  for (const file of files('src').filter((file) => file.endsWith('.vue'))) {
    const source = read(file);
    assert.doesNotMatch(source, /:show-error-message="false"|showErrorMessage:\s*false/, file);
    const template = parseSfc(source).descriptor.template;
    if (!template) continue;
    const walk = (node) => {
      if (
        node.type === NodeTypes.ELEMENT &&
        ['t-input', 't-select', 't-cascader', 't-textarea', 't-input-number', 'DecimalInput'].includes(node.tag)
      ) {
        const bound = node.props.filter((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind');
        if (
          bound.some((prop) => prop.arg?.content === 'status') &&
          !node.props.some((prop) => prop.name === 'tips' || prop.arg?.content === 'tips')
        )
          violations.push(`${file}: ${node.tag} status needs tips`);
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(parseTemplate(template.content));
  }
  assert.deepEqual(violations, []);
  assert.match(read('src/components/foundation/official/AdminFormDialog.vue'), /:show-error-message="true"/);
  assert.match(read('docs/ui/standard.md'), /form-validation-standard\.md/);
});

test('finished stock submit rejections expose field feedback for reasons and cross-field specifications', () => {
  for (const client of ['management', 'supply-chain']) {
    const source = read(`src/pages/finished-stock/${client}/index.vue`);
    assert.match(source, /reasonFeedback\.field\('reason', reasonForm\.reason\)/);
    assert.match(source, /reasonFeedback\.reject\('reason', reasonForm\.reason, '请选择下架原因'\)/);
    assert.match(source, /salesSpecificationFeedback\.field\('specifications'/);
    assert.match(source, /issues\.find\(\(item\) => item\.kind === 'error' && !item\.tab\)/);
    assert.match(source, /salesSpecificationFeedback\.reject/);
  }
});

test('ordinary create/edit dialogs consume the registered native-width form standard', () => {
  const standard = JSON.parse(read('docs/ui/official-sources.json')).singleColumnFormStandard;
  assert.equal(standard.dialogWidthPx, 480);
  assert.equal(standard.labelWidthPx, 100);
  for (const form of standard.forms) {
    const template = parseSfc(read(form.file)).descriptor.template;
    let target;
    const walk = (node) => {
      if (
        node.type === NodeTypes.ELEMENT &&
        node.tag === form.tag &&
        node.props.some(
          (prop) =>
            prop.type === NodeTypes.DIRECTIVE &&
            prop.name === 'model' &&
            prop.arg?.content === 'visible' &&
            prop.exp?.content === form.visible,
        )
      )
        target = node;
      for (const child of node.children ?? []) walk(child);
    };
    walk(parseTemplate(template.content));
    assert.ok(target, `${form.file} ${form.visible}`);
    assert.ok(
      target.props.some((prop) => prop.name === 'width' && prop.value?.content === '480px'),
      form.file,
    );
    if (form.tag !== 'AdminFormDialog')
      assert.ok(
        target.props.some(
          (prop) => prop.name === 'dialog-class-name' && prop.value?.content.includes('zdm-admin-single-form'),
        ),
        form.file,
      );
  }
  assert.match(read('src/components/foundation/official/AdminFormDialog.vue'), /zdm-admin-single-form/);
});

test('all dialogs containing form controls have a reviewed layout classification independent of title', () => {
  const standard = JSON.parse(read('docs/ui/official-sources.json')).singleColumnFormStandard;
  const controlTags = new Set([
    't-form',
    't-input',
    't-input-number',
    't-select',
    't-cascader',
    't-textarea',
    't-date-picker',
    't-date-range-picker',
    'SpecPriceInput',
  ]);
  const containsControls = (node) =>
    (node.type === NodeTypes.ELEMENT && controlTags.has(node.tag)) || (node.children ?? []).some(containsControls);
  const violations = [];
  for (const file of files('src/pages').filter((file) => file.endsWith('.vue'))) {
    const template = parseSfc(read(file)).descriptor.template;
    if (!template) continue;
    const walk = (node) => {
      if (
        node.type === NodeTypes.ELEMENT &&
        ['t-dialog', 'AdminDialog', 'AdminFormDialog'].includes(node.tag) &&
        node.children.some(containsControls)
      ) {
        const prop = (key) =>
          node.props.find((item) => item.name === key)?.value?.content ??
          node.props.find((item) => item.arg?.content === key)?.exp?.content ??
          '';
        const visible = prop('visible');
        const listed = standard.forms.some((item) => item.file === file && item.visible === visible);
        const excluded = standard.excludedForms.some(
          (item) => item.file === file && item.visible === visible && item.reason,
        );
        const inherited =
          node.tag === 'AdminFormDialog' &&
          !['custom'].includes(prop('form-layout')) &&
          ['', '480px'].includes(prop('width'));
        if (!listed && !excluded && !inherited) violations.push(`${file} ${visible}`);
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(parseTemplate(template.content));
  }
  assert.deepEqual(
    violations,
    [],
    'Unclassified form dialogs must consume the shared standard or document a reviewed specialized layout',
  );
});

test('store controls include composite selects and native datetime placeholders in the standard audit', async () => {
  const { placeholderViolations } = await import('./placeholder-policy.mjs');
  const storePages = [
    ...files('src/pages/finished-stock/store').filter((file) => file.endsWith('.vue')),
    'src/pages/customer/index.vue',
    'src/pages/store-category/management/index.vue',
    'src/pages/supplier/management/index.vue',
    'src/pages/role/management/index.vue',
    'src/pages/permission/employee/index.vue',
  ];
  assert.deepEqual(
    storePages.flatMap((file) => placeholderViolations(file, read(file), { includeCompositeSelects: true })),
    [],
  );
  const select = (hint) =>
    `<template><t-form-item label="商品分类"><t-select-input placeholder="${hint}" /></t-form-item></template>`;
  assert.equal(placeholderViolations('store.vue', select('请选择'), { includeCompositeSelects: true }).length, 1);
  assert.deepEqual(placeholderViolations('store.vue', select('请选择商品分类'), { includeCompositeSelects: true }), []);
  const datetime = (hint) => `<template><t-date-picker enable-time-picker placeholder="${hint}" /></template>`;
  assert.equal(placeholderViolations('store.vue', datetime('请选择日期')).length, 1);
  assert.deepEqual(placeholderViolations('store.vue', datetime('请选择日期时间')), []);
});

test('submit validation entries share one summary and location implementation without intercepting operation feedback', async () => {
  const ts = (await import('typescript')).default;
  const entries = {
    'src/pages/craft/finished-stock/index.vue': ['handleSubmit'],
    'src/pages/store-category/management/index.vue': ['handleSubmit'],
    'src/pages/product/attribute/index.vue': ['submit'],
    'src/pages/product/attribute-value/index.vue': ['submit'],
    'src/pages/product/category/index.vue': ['handleSubmit'],
    'src/pages/product/markup-configuration/index.vue': ['submitForm', 'saveGuidePriceSetting'],
    'src/pages/product/category-attribute-template/index.vue': ['preparePublish'],
    'src/pages/customer/index.vue': ['submitProfile', 'submitAction', 'submitFollowup'],
    'src/pages/permission/employee/index.vue': ['handleProfileSubmit', 'handlePermissionSubmit'],
    'src/pages/role/management/index.vue': ['handleSubmit'],
    'src/pages/tenant/management/index.vue': ['handleSubmit'],
    'src/pages/tenant/store/index.vue': ['handleSubmit', 'handleLevelSubmit'],
    'src/pages/supplier/management/index.vue': ['handleSubmit'],
    'src/pages/supplier/supply-type/index.vue': ['save'],
    'src/pages/store-level/management/index.vue': ['submitLevel'],
    'src/pages/slab/variety/index.vue': ['handleSubmit'],
    'src/pages/slab/origin/index.vue': ['handleSubmit'],
    'src/pages/slab/texture/index.vue': ['submitTexture', 'submitAlias'],
    'src/pages/slab/color/index.vue': ['submitColor', 'submitCategory'],
    'src/pages/slab/grade/index.vue': ['submitGrade'],
    'src/pages/finished-stock/store/price-configuration.vue': ['save', 'savePrices', 'saveDiscount'],
    'src/pages/finished-stock/store/index.vue': ['confirmOffShelf'],
    'src/pages/finished-stock/store/StoreFinishedEditor.vue': ['save'],
    'src/pages/finished-stock/management/index.vue': ['submitProductForm', 'submitReason', 'savePriceDrawer'],
    'src/pages/finished-stock/supply-chain/index.vue': ['submitProductForm', 'submitReason', 'savePriceDrawer'],
    'src/pages/slab/management/index.vue': ['handleProductSubmit', 'handleReasonSubmit', 'saveBatchPrice'],
    'src/pages/slab/supply-chain/index.vue': ['handleProductSubmit', 'handleReasonSubmit', 'saveBatchPrice'],
    'src/pages/login/index.vue': ['onSubmit', 'sendCode'],
    'src/pages/employee-invite/index.vue': ['handlePhoneSubmit', 'handleProfileSubmit', 'sendCode'],
  };
  for (const file of files('src/pages').filter((file) => file.endsWith('.vue'))) {
    const descriptor = parseSfc(read(file)).descriptor;
    if (!descriptor.scriptSetup) continue;
    const ast = ts.createSourceFile(file + '.ts', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true);
    const functions = new Map();
    function visit(node) {
      if (
        ts.isFunctionDeclaration(node) ||
        (ts.isVariableDeclaration(node) &&
          node.initializer &&
          (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)))
      ) {
        functions.set(node.name?.getText(ast), ts.isVariableDeclaration(node) ? node.initializer : node);
        return;
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    const reachesShared = (name, visited = new Set()) => {
      if (name === 'rejectFormSubmission') return true;
      if (visited.has(name) || !functions.has(name)) return false;
      visited.add(name);
      let found = false;
      const scan = (node) => {
        if (ts.isCatchClause(node)) return;
        if (ts.isCallExpression(node) && reachesShared(node.expression.getText(ast), visited)) found = true;
        ts.forEachChild(node, scan);
      };
      scan(functions.get(name));
      return found;
    };
    const required = new Set(entries[file] ?? []);
    // Future submit/confirm/click handlers with native or manual validation must also use the shared path.
    const walk = (node) => {
      for (const prop of node.props ?? []) {
        if (
          prop.type !== NodeTypes.DIRECTIVE ||
          prop.name !== 'on' ||
          !['submit', 'confirm', 'click'].includes(prop.arg?.content)
        )
          continue;
        const name = prop.exp?.content?.match(/^([a-zA-Z_$][\w$]*)/)?.[1];
        const body = functions.get(name)?.getText(ast) ?? '';
        if (/\.validate\(|\.validateResult|\.reject\(|\.setValidateMessage\(/.test(body)) required.add(name);
      }
      for (const child of node.children ?? []) walk(child);
    };
    if (descriptor.template) walk(parseTemplate(descriptor.template.content));
    for (const name of required) assert.ok(reachesShared(name), `${file}: ${name} must call shared submit rejection`);
  }
  const standard = JSON.parse(read('docs/ui/official-sources.json')).formValidationStandard;
  assert.equal(standard.submitEntry, 'src/utils/submitValidation.ts');
  assert.equal(standard.toastPolicy.submitValidation, 'Exactly one summary: 表单校验未通过，请检查标红字段');
  assert.ok(!('shortDialog' in standard.toastPolicy) && !('longForm' in standard.toastPolicy));
  const shared = read(standard.submitEntry);
  assert.equal((shared.match(/adminFeedback.warning\(/g) ?? []).length, 1);
  assert.doesNotMatch(shared, /MessagePlugin|addEventListener|dispatchEvent|\.focus\(/);
  assert.match(read('src/pages/finished-stock/shared/useFinishedStockSpecDialog.ts'), /return onValidationFailed\(\)/);
  assert.match(
    read('src/pages/finished-stock/store/price-configuration.vue'),
    /adminFeedback.error\(getSafeErrorMessage\(error, '保存失败，请稍后重试'\)\)/,
  );
});

test('later approved business fixes reverse before overlapping migrations without relaxing exact matching', () => {
  const original = '<template><t-button>执行</t-button></template>';
  const migrated = original.replace('执行', '批量执行');
  const fixed = migrated.replace('<t-button>', '<t-button :disabled="!selected.length">');
  const patch = {
    reason: 'User approved zero-selection disabling',
    before: migrated,
    after: fixed,
    stage: 'before-migrations',
  };
  const baseline = {
    ...businessFingerprint(original),
    approvedPlaceholderPatches: [{ reason: 'Earlier approved migration', before: original, after: migrated }],
    approvedBusinessPatches: [patch],
  };
  assert.deepEqual(contractViolations('page.vue', fixed, baseline), []);
  for (const invalid of [fixed.replace('批量执行', '删除'), fixed + fixed, migrated])
    assert.ok(contractViolations('page.vue', invalid, baseline).length);
  for (const change of [{ reason: '' }, { stage: 'unknown' }, { after: '' }])
    assert.ok(
      contractViolations('page.vue', fixed, { ...baseline, approvedBusinessPatches: [{ ...patch, ...change }] }).length,
    );
  assert.ok(contractViolations('page.vue', fixed, { ...baseline, approvedBusinessPatches: [] }).length);
});

test('all business button and dialog colors use registered functions, including future pages', () => {
  const problems = [
    ...registryViolations(),
    ...files('src')
      .filter((file) => file.endsWith('.vue'))
      .flatMap((file) => buttonColorViolations(file, read(file))),
  ];
  assert.deepEqual(problems, []);
});
test('unregistered functions, direct colors, missing confirmation semantics and forged controls fail closed', () => {
  const source = (template) =>
    `<template>${template}</template><script setup>import { buttonTheme, buttonFunctionFor, actionButtonProps, cancelButtonProps } from '@/components/foundation/actions/buttonFunctions';</script>`;
  const good = source(
    `<t-button :theme="buttonTheme('delete')">删除</t-button><t-link :theme="buttonTheme('delete')">删除</t-link><AdminConfirmDialog function="delete" /><AdminDialog confirm-function="off-shelf" />`,
  );
  assert.deepEqual(buttonColorViolations('new-page.vue', good), []);
  for (const template of [
    '<t-button>新增</t-button>',
    '<t-link theme="danger">删除</t-link>',
    `<t-button :theme="buttonTheme('not-registered')" />`,
    `<t-button :theme="buttonTheme(buttonFunctionFor('stock', 'unknown'))" />`,
    `<t-button :theme="buttonTheme('save')" style="color:red" />`,
    '<t-button data-button-control="section-navigation" />',
    '<button @click="remove">删除</button>',
    '<AdminDialog />',
    `<AdminDialog confirm-function="delete" :confirm-btn="{ content: '删除', theme: 'danger' }" />`,
    '<AdminConfirmDialog function="not-registered" />',
    '<t-dialog confirm-btn="确认" />',
    `<t-button v-bind="overrides" :theme="buttonTheme('save')" />`,
  ])
    assert.ok(buttonColorViolations('new-page.vue', source(template)).length, template);
  const invalid = {
    categories: { normal: { theme: 'danger', meaning: 'bad mapping' } },
    functions: { foo: { label: '新功能', category: 'unknown', reason: '' } },
    groups: { future: { run: 'missing' } },
  };
  assert.ok(registryViolations(invalid).length >= 3);
});

test('button classes cannot override the public mapping in scoped or global CSS', () => {
  const vueFiles = files('src').filter((file) => file.endsWith('.vue'));
  const classes = new Set(vueFiles.flatMap((file) => [...buttonClasses(read(file))]));
  const errors = [];
  for (const file of files('src')) {
    if (file.endsWith('.vue'))
      for (const style of parseSfc(read(file)).descriptor.styles)
        errors.push(...buttonStyleViolations(file, style.content, classes));
    else if (file.endsWith('.css')) errors.push(...buttonStyleViolations(file, read(file), classes));
  }
  assert.deepEqual(errors, []);
  assert.ok(buttonStyleViolations('page.vue', '.t-button:hover { color: red }').length);
  assert.ok(buttonStyleViolations('page.vue', '.custom { background: orange }', new Set(['custom'])).length);
  assert.deepEqual(buttonStyleViolations('page.vue', '.custom { margin-left: auto }', new Set(['custom'])), []);
});

test('public button and confirmation contracts require semantic IDs without legacy color fallbacks', () => {
  for (const [file, field] of [
    ['src/components/foundation/AdminDialog.vue', 'confirmFunction'],
    ['src/components/foundation/official/AdminFormDialog.vue', 'confirmFunction'],
    ['src/components/foundation/AdminConfirmDialog.vue', 'function'],
    ['src/components/foundation/official/types.ts', 'function'],
  ]) {
    const source = read(file);
    assert.match(source, new RegExp(field + ': ButtonFunction'));
    assert.doesNotMatch(source, new RegExp(field + '\\?: ButtonFunction'));
  }
  assert.doesNotMatch(read('src/components/foundation/AdminConfirmDialog.vue'), /props\.danger|删除\|移除\|清空/);
  for (const file of [
    'src/pages/finished-stock/shared/finishedStockActions.ts',
    'src/pages/finished-stock/shared/finishedStockPageModel.ts',
    'src/pages/slab/shared/slabPageActions.ts',
  ])
    assert.doesNotMatch(read(file), /\btheme\??:/);
});

test('all existing and future confirmations use registered naming without local caption overrides', () => {
  assert.deepEqual(
    [
      ...confirmationRegistryViolations(),
      ...files('src')
        .filter((file) => file.endsWith('.vue'))
        .flatMap((file) => confirmationViolations(file, read(file))),
    ],
    [],
  );
});
test('confirmation naming rejects missing registration, unknown actions and manual captions', () => {
  const source = (template) =>
    `<template>${template}</template><script setup>import { formConfirmation, operationConfirmation, dialogButtonProps } from '@/components/foundation/actions/confirmation';</script>`;
  assert.ok(
    confirmationViolations(
      'new.vue',
      source('<Alias />').replace(
        '</script>',
        "import { AdminDialog as Alias } from '@/components/foundation';</script>",
      ),
    ).length,
  );
  for (const template of [
    '<AdminDialog />',
    '<AdminFormDialog :confirmation="formConfirmation(\'unknown\')" />',
    '<AdminDialog :confirmation="operationConfirmation(\'未知动作\')" />',
    '<AdminDialog :confirmation="formConfirmation(\'create\')" confirm-btn="提交" />',
    '<AdminDialog :confirmation="formConfirmation(\'create\')" :confirm-btn="{content: \'保存\'}" />',
    '<AdminConfirmDialog action="未知动作" />',
    "<t-dialog :confirm-btn=\"actionButtonProps('delete', '提交')\" />",
    '<t-button :theme="buttonTheme(\'save\')">保存</t-button>',
    '<t-button data-form-submit :theme="buttonTheme(\'create\')">确认创建</t-button>',
  ])
    assert.ok(confirmationViolations('new.vue', source(template)).length, template);
  for (const template of [
    '<AdminDialog :confirmation="formConfirmation(\'create\')" />',
    "<AdminFormDialog :confirmation=\"formConfirmation(editing ? 'edit' : 'create')\" />",
    "<t-dialog :confirm-btn=\"dialogButtonProps('off-shelf', operationConfirmation('下架', batch), {loading: true})\" />",
    '<AdminConfirmDialog action="停用" :batch="true" />',
  ])
    assert.deepEqual(confirmationViolations('new.vue', source(template)), []);
});

test('all business text links use explicit official color hover without forced underlines', () => {
  const problems = [];
  let count = 0;
  for (const file of files('src').filter((file) => file.endsWith('.vue'))) {
    const { descriptor } = parseSfc(read(file));
    if (!descriptor.template) continue;
    function visit(node) {
      if (node.type === NodeTypes.ELEMENT && node.tag.toLowerCase().replaceAll('-', '') === 'tlink') {
        count++;
        const hover = node.props.find((prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'hover');
        if (hover?.value?.content !== 'color') problems.push(`${file}: Link must use hover="color"`);
        for (const prop of node.props) {
          if (prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.content === 'hover')
            problems.push(`${file}: dynamic hover overrides are not allowed`);
          if (prop.type === NodeTypes.ATTRIBUTE && prop.name === 'underline')
            problems.push(`${file}: forced underline is not allowed`);
          if (
            prop.type === NodeTypes.DIRECTIVE &&
            prop.name === 'bind' &&
            prop.arg?.content === 'underline' &&
            prop.exp?.content !== 'false'
          )
            problems.push(`${file}: underline must remain false`);
        }
      }
      for (const child of node.children ?? []) visit(child);
      // Native template AST also contains branches only after transforms; parseTemplate keeps v-if/v-for as elements.
    }
    visit(parseTemplate(descriptor.template.content));
  }
  assert.ok(count > 0, 'The policy must inspect existing Link components');
  assert.deepEqual(problems, []);
});

test('runtime styles retain native overlay geometry and never override internal mask selectors', () => {
  const violations = [];
  for (const file of files('src')) {
    const styles = /\.(css|less|scss)$/.test(file)
      ? [read(file)]
      : file.endsWith('.vue')
        ? inspectPage(read(file)).styles.map((style) => style.content)
        : [];
    for (const css of styles) {
      postcss.parse(css).walkRules((rule) => {
        if (/\.t-(?:dialog__mask|drawer__mask|popup__overlay|image-viewer__modal-mask)\b/.test(rule.selector))
          violations.push(`${file}: ${rule.selector}`);
      });
    }
  }
  assert.deepEqual(violations, [], 'Use public overlay properties; do not override native mask styles');
});

test('native button appearance and disabled states have no internal-selector skin overrides', () => {
  const violations = [];
  for (const file of files('src')) {
    const styles = /\.(css|less|scss)$/.test(file)
      ? [read(file)]
      : file.endsWith('.vue')
        ? inspectPage(read(file)).styles.map((style) => style.content)
        : [];
    for (const css of styles) {
      postcss.parse(css).walkRules((rule) => {
        if (!/\.t-button(?:--[\w-]+)?\b/.test(rule.selector)) return;
        rule.walkDecls((declaration) => {
          if (isApprovedOrderReferenceBorder(file, declaration)) return;
          if (/^(?:color|background(?:-[\w-]+)?|border(?:-[\w-]+)?|opacity|filter|box-shadow)$/.test(declaration.prop))
            violations.push(`${file}: ${rule.selector} overrides ${declaration.prop}`);
        });
      });
    }
  }
  assert.deepEqual(violations, [], 'Keep native button themes, shapes and disabled states; preserve business layout');
});

import { placeholderViolations } from './placeholder-policy.mjs';
const approvedOrderFile = 'src/pages/order/prototype/SalesOrderList.vue';
test('reference-image placeholders are scoped to exact approved file, tag, marker and text', () => {
  const approved = '<template><t-select data-design-control="order-filter-select" placeholder="请选择" /></template>';
  assert.deepEqual(placeholderViolations(approvedOrderFile, approved), []);
  assert.equal(placeholderViolations('new.vue', approved).length, 1);
  assert.equal(placeholderViolations(approvedOrderFile, approved.replace('order-filter-select', 'other')).length, 1);
  assert.equal(placeholderViolations(approvedOrderFile, approved.replace('t-select', 't-input')).length, 1);
  assert.equal(
    placeholderViolations(approvedOrderFile, approved.replace('placeholder="请选择"', 'placeholder="随便填"')).length,
    1,
  );
  const dates =
    '<template><t-date-range-picker data-design-control="order-filter-dates" :placeholder="[\'开始日期\', \'结束日期\']" /></template>';
  assert.deepEqual(placeholderViolations(approvedOrderFile, dates), []);
  assert.equal(placeholderViolations('new.vue', dates).length, 1);
  assert.equal(placeholderViolations(approvedOrderFile, dates.replace('结束日期', '结束时间')).length, 1);
});

test('scheme one rejects superseded raster border skins', () => {
  const selector = '.order-card__actions :deep(.t-button--variant-outline.t-button--theme-primary)';
  const css = `${selector} { border: 1px solid #bfd1f6; }`;
  assert.equal(buttonStyleViolations(approvedOrderFile, css).length, 1);
  assert.equal(buttonStyleViolations('other.vue', css).length, 1);
  assert.equal(buttonStyleViolations(approvedOrderFile, css.replace('#bfd1f6', '#ff0000')).length, 1);
  assert.equal(buttonStyleViolations(approvedOrderFile, css.replace(selector, selector + '.t-is-disabled')).length, 1);
  const declaration = postcss.parse(css).first.first;
  assert.equal(isApprovedOrderReferenceBorder(approvedOrderFile, declaration), false);
  assert.equal(isApprovedOrderReferenceBorder(approvedOrderFile, { ...declaration, prop: 'background' }), false);
});

test('ordinary record names titles and identifiers never act as navigation or action triggers', () => {
  const violations = files('src/pages')
    .filter((file) => file.endsWith('.vue'))
    .flatMap((file) => displayTextViolations(read(file)).map((issue) => `${file}: ${issue}`));
  assert.deepEqual(violations, []);
  assert.match(read('AGENTS.md'), /display-text-standard\.md/);
  assert.match(read('docs/ui/standard.md'), /display-text-standard\.md/);
});

test('display text guard rejects link click keyboard and render-function regressions without blocking explicit operations', () => {
  for (const body of [
    '<t-link @click="openDetail(row.id)">{{ row.name }}</t-link>',
    '<router-link :to="`/detail/${row.id}`">{{ row.title }}</router-link>',
    '<span @click="openDetail(row.id)">{{ row.name || "未命名" }}</span>',
    '<a href="/detail">{{ formatName(row.productName) }}</a>',
    '<span @click="openDetail(row.id)">{{ row.orderNo ?? "-" }}</span>',

    '<template #name="{ row }"><a href="/detail">{{ display(row) }}</a></template>',
    '<span @click="openDetail(order.id)">{{ order.id }}</span>',
    '<div @dblclick="openDetail(row.id)"><strong>{{ row.title }}</strong></div>',
    '<span role="link" tabindex="0" @keydown.enter="openDetail(row.id)">{{ row.code }}</span>',
    '<div :role="canView ? \'link\' : undefined">{{ row.orderNumber }}</div>',
    '<t-link @click="openDetail(attachment.id)">{{ attachment.name }}</t-link>',
  ])
    assert.ok(displayTextViolations(`<template>${body}</template>`).length, body);
  assert.ok(
    displayTextViolations(
      `<script setup>const cell = (h, row) => h('a', { onClick: () => detail(row.id) }, row.name);</script>`,
    ).length,
  );
  assert.ok(
    displayTextViolations(
      `<script setup>const cell = (h, row) => h('span', { onClick: () => detail(row.id) }, row.orderNo);</script>`,
    ).length,
  );
  for (const body of [
    '<span>{{ row.name }}</span><strong>{{ order.id }}</strong>',
    '<t-button @click="toggleExpansion(order.id)">{{ isExpanded(order.id) ? "收起" : "展开" }}</t-button>',

    '<t-link v-if="canDetail" @click="openDetail(row.id)">详情</t-link>',
    '<t-button :aria-label="`复制订单号 ${order.id}`" @click="copy(order.id)"><t-icon name="copy" /></t-button>',
    '<t-menu><t-menu-item @click="choose(item.id)">{{ item.name }}</t-menu-item></t-menu>',
    '<button @click="selectCategory(level, item.id)">{{ item.name }}</button>',
    '<div tabindex="0" aria-label="可横向滚动"><span>{{ row.name }}</span></div>',
    '<t-link :theme="buttonTheme(\'preview\')" @click="previewAttachment(record, attachment)">{{ attachment.name }}</t-link>',
  ])
    assert.deepEqual(displayTextViolations(`<template>${body}</template>`), [], body);
});
