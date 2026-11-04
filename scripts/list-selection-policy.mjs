import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import ts from 'typescript';

// These exact dialog tables select business inputs, not main-list batch targets.
const businessPickers = new Map([
  ['src/pages/finished-stock/store/index.vue', new Set(['poolColumns'])],
  ['src/pages/product/category-attribute-template/index.vue', new Set(['addColumns', 'valueColumns'])],
]);
export function listSelectionViolations(file, source) {
  const { descriptor } = parseSfc(source);
  if (!descriptor.template) return [];
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
  const parsed = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
  const definitions = new Map();
  function vars(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer)
      definitions.set(node.name.text, node.initializer);
    ts.forEachChild(node, vars);
  }
  vars(parsed);
  function dependencies(name, visited = new Set()) {
    if (visited.has(name) || !definitions.has(name)) return '';
    visited.add(name);
    const node = definitions.get(name);
    let result = node.getText(parsed);
    function refs(child) {
      if (ts.isIdentifier(child)) result += '\n' + dependencies(child.text, visited);
      ts.forEachChild(child, refs);
    }
    refs(node);
    return result;
  }
  const problems = [];
  const binding = (node, key) =>
    node.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.content === key)
      ?.exp?.content;
  function hasCheckbox(node) {
    return node.type === NodeTypes.ELEMENT && (node.tag === 't-checkbox' || node.children.some(hasCheckbox));
  }
  function visit(node, inDialog = false) {
    if (node.type === NodeTypes.ELEMENT) {
      if (
        node.tag === 'AdminListPage' &&
        hasCheckbox(node) &&
        !node.props.some(
          (prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'selection-column-key' && prop.value?.content,
        )
      )
        problems.push(`${file}: custom list selection must declare selection-column-key`);
      if (node.tag === 't-table') {
        const columns = binding(node, 'columns');
        const expression = dependencies(columns);
        const selected =
          binding(node, 'selected-row-keys') || hasCheckbox(node) || /type:\s*['"]multiple['"]/.test(expression);
        const picker = inDialog && businessPickers.get(file)?.has(columns);
        if (
          selected &&
          !picker &&
          !(expression.includes('selectionColumns(') && script.includes('useListBatchSelection('))
        )
          problems.push(
            `${file}: selectable table ${columns ?? '(unbound columns)'} must use the shared batch capability`,
          );
      }
      inDialog ||= ['AdminDialog', 'AdminFormDialog'].includes(node.tag);
    }
    for (const child of node.children ?? []) visit(child, inDialog);
  }
  visit(parseTemplate(descriptor.template.content));
  return problems;
}
