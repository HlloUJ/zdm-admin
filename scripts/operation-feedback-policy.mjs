import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parse } from '@vue/compiler-sfc';
import { baseParse, NodeTypes } from '@vue/compiler-dom';
import ts from 'typescript';

export const operationDigest = (source) => createHash('sha256').update(source).digest('hex');
export function operationBindings(source) {
  const { descriptor, errors } = parse(source);
  if (errors.length) throw new Error('Invalid operation source');
  const bindings = [];
  const visit = (node) => {
    if (node.type === NodeTypes.ELEMENT) {
      for (const p of node.props) {
        if (
          p.type === NodeTypes.DIRECTIVE &&
          p.name === 'on' &&
          /^(click|confirm|submit|change|.*action)$/.test(p.arg?.content ?? '')
        )
          bindings.push({ component: node.tag, event: p.arg.content, handler: p.exp?.content ?? '' });
      }
      // Blockers must never retain a confirmation surface, including dynamic modes.
      if (
        node.tag === 'AdminConfirmDialog' &&
        node.props.some(
          (p) =>
            (p.name === 'mode' && p.value?.content === 'blocked') ||
            (p.type === NodeTypes.DIRECTIVE &&
              p.name === 'bind' &&
              p.arg?.content === 'mode' &&
              p.exp?.content !== "'confirm'"),
        )
      )
        bindings.push({ component: node.tag, event: 'blocked-dialog', handler: '' });
    }
    for (const child of node.children ?? []) visit(child);
  };
  if (descriptor.template) visit(baseParse(descriptor.template.content));
  return {
    bindings,
    scriptDigest: operationDigest((descriptor.script?.content ?? '') + (descriptor.scriptSetup?.content ?? '')),
  };
}
export function operationFiles(root, directory = 'src') {
  if (directory === 'src/components/foundation') return []; // Trusted presentation primitives; business modules remain scanned.
  return readdirSync(path.join(root, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const file = `${directory}/${entry.name}`;
      return entry.isDirectory() ? operationFiles(root, file) : file.endsWith('.vue') ? [file] : [];
    })
    .sort();
}
export function hasSharedPreflight(source) {
  const { descriptor } = parse(source);
  const ast = ts.createSourceFile(
    'operation.ts',
    descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '',
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const factories = new Set();
  const instances = new Set();
  let called = false;
  for (const node of ast.statements) {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier.text === '@/composables/useOperationPreflight') {
      for (const specifier of node.importClause?.namedBindings?.elements ?? []) {
        if ((specifier.propertyName?.text ?? specifier.name.text) === 'useOperationPreflight')
          factories.add(specifier.name.text);
      }
    }
  }
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      factories.has(node.initializer.expression.getText(ast))
    )
      instances.add(node.name.text);
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      instances.has(node.expression.expression.getText(ast)) &&
      node.expression.name.text === 'run'
    )
      called = true;
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return called;
}

export function operationViolations(file, source, entry) {
  const { bindings, scriptDigest } = operationBindings(source);
  if (!bindings.length) return entry ? [`${file}: stale operation registration`] : [];
  if (!entry) return [`${file}: missing explicit operation registration`];
  const existingPages = new Set([
    'src/pages/craft/finished-stock/index.vue',
    'src/pages/customer/index.vue',
    'src/pages/employee-invite/index.vue',
    'src/pages/finished-stock/management/components/FinishedCreationSnapshot.vue',
    'src/pages/finished-stock/management/components/HistoricalRichText.vue',
    'src/pages/finished-stock/management/components/PriceSourceToggle.vue',
    'src/pages/finished-stock/management/components/ProductDetail.vue',
    'src/pages/finished-stock/management/components/SalesLogFullscreen.vue',
    'src/pages/finished-stock/management/index.vue',
    'src/pages/finished-stock/store/StoreFinishedEditor.vue',
    'src/pages/finished-stock/store/index.vue',
    'src/pages/finished-stock/store/price-configuration.vue',
    'src/pages/finished-stock/supply-chain/index.vue',
    'src/pages/login/index.vue',
    'src/pages/order/prototype/OrderActionDialog.vue',
    'src/pages/order/prototype/OrderEditor.vue',
    'src/pages/order/prototype/SalesOrderList.vue',
    'src/pages/order/prototype/index.vue',
    'src/pages/permission/employee/index.vue',
    'src/pages/permission/terminal-function/index.vue',
    'src/pages/product/attribute-value/index.vue',
    'src/pages/product/attribute/index.vue',
    'src/pages/product/category-attribute-template/index.vue',
    'src/pages/product/category/index.vue',
    'src/pages/product/markup-configuration/index.vue',
    'src/pages/role/management/index.vue',
    'src/pages/slab/color/index.vue',
    'src/pages/slab/grade/index.vue',
    'src/pages/slab/management/components/SlabProductFormLayout.vue',
    'src/pages/slab/management/index.vue',
    'src/pages/slab/origin/index.vue',
    'src/pages/slab/supply-chain/index.vue',
    'src/pages/slab/texture/index.vue',
    'src/pages/slab/variety/index.vue',
    'src/pages/store-category/management/index.vue',
    'src/pages/store-level/management/index.vue',
    'src/pages/supplier/management/index.vue',
    'src/pages/supplier/supply-type/index.vue',
    'src/pages/tenant/management/index.vue',
    'src/pages/tenant/store/index.vue',
  ]);
  const violations = [];
  if (
    !existingPages.has(file) &&
    entry.bindings.some((b) => ['single', 'dispatch'].includes(b.type)) &&
    !hasSharedPreflight(source)
  )
    violations.push(file + ': new operation module must consume shared preflight');
  if (scriptDigest !== entry.scriptDigest)
    violations.push(`${file}: operation implementation changed; review conditions, callers and tests`);
  const declared = entry.bindings.map(({ component, event, handler }) => ({ component, event, handler }));
  if (JSON.stringify(bindings) !== JSON.stringify(declared))
    violations.push(`${file}: missing or stale operation binding`);
  for (const binding of entry.bindings) {
    if (!['single', 'batch-partial', 'batch-atomic', 'form', 'view', 'query', 'dispatch'].includes(binding.type))
      violations.push(`${file}: invalid operation type`);
    if (binding.event === 'blocked-dialog') violations.push(`${file}: operation blockers must use Toast`);
    if (
      binding.type === 'dispatch' &&
      (!binding.branches ||
        !Object.keys(binding.branches).length ||
        Object.values(binding.branches).some(
          (t) => !['single', 'batch-partial', 'batch-atomic', 'form', 'view', 'query'].includes(t),
        ))
    )
      violations.push(`${file}: dispatcher needs explicit branch types`);

    // These are registered product operation IDs, not display labels. Their existing endpoint contracts allow partial success.
    for (const branch of ['batchShelf', 'batchDelete', 'batch-shelf', 'batch-delete']) {
      if (binding.branches?.[branch] !== undefined && binding.branches[branch] !== 'batch-partial')
        violations.push(`${file}: ${branch} must preserve its partial-success contract`);
    }
    if (binding.type === 'batch-partial' && binding.itemPreflight)
      violations.push(`${file}: partial batch must not require all item prechecks`);
  }
  return violations;
}
export function auditOperations(root, registry, read = (file) => readFileSync(path.join(root, file), 'utf8')) {
  const actual = operationFiles(root).filter((file) => operationBindings(read(file)).bindings.length);
  return [
    ...actual.flatMap((file) => operationViolations(file, read(file), registry.pages[file])),
    ...Object.keys(registry.pages)
      .filter((file) => !actual.includes(file))
      .map((file) => `${file}: stale registered page`),
  ];
}
