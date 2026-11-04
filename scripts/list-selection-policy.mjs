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
  const declarations = new Map();
  const scopeOf = (node) => {
    for (let p = node.parent; p; p = p.parent) if (ts.isSourceFile(p) || ts.isFunctionLike(p)) return p;
  };
  function collect(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const entries = declarations.get(node.name.text) ?? [];
      entries.push(node);
      declarations.set(node.name.text, entries);
    }
    ts.forEachChild(node, collect);
  }
  collect(parsed);
  function definition(name, context) {
    for (let scope = scopeOf(context) ?? parsed; scope; scope = scopeOf(scope)) {
      const found = declarations.get(name)?.find((node) => scopeOf(node) === scope);
      if (found) return found;
    }
  }
  const helperNames = new Set();
  const importedHooks = new Set();
  for (const statement of parsed.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      /(?:^@\/components\/foundation(?:\/|$)|useListBatchSelection)/.test(statement.moduleSpecifier.text)
    ) {
      const bindings = statement.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings))
        for (const item of bindings.elements)
          if ((item.propertyName ?? item.name).text === 'useListBatchSelection') importedHooks.add(item.name.text);
    }
  }
  function helpers(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      importedHooks.has(node.initializer.expression.getText(parsed))
    )
      for (const item of node.name.elements)
        if ((item.propertyName ?? item.name).getText(parsed) === 'selectionColumns')
          helperNames.add(item.name.getText(parsed));
    ts.forEachChild(node, helpers);
  }
  helpers(parsed);
  const unwrap = (node) => {
    while (
      node &&
      (ts.isParenthesizedExpression(node) ||
        ts.isAsExpression(node) ||
        ts.isSatisfiesExpression(node) ||
        ts.isNonNullExpression(node))
    )
      node = node.expression;
    return node;
  };
  function resolve(node, seen = new Set()) {
    node = unwrap(node);
    if (node && ts.isIdentifier(node)) {
      const declaration = definition(node.text, node);
      if (declaration && !seen.has(declaration))
        return resolve(declaration.initializer, new Set([...seen, declaration]));
    }
    if (node && ts.isPropertyAccessExpression(node)) {
      const parent = resolve(node.expression, seen);
      if (parent && ts.isObjectLiteralExpression(parent)) {
        const prop = parent.properties.find(
          (item) =>
            (item.name && ('text' in item.name ? item.name.text : item.name.getText(parsed))) === node.name.text,
        );
        if (prop && ts.isPropertyAssignment(prop)) return resolve(prop.initializer, seen);
        if (prop && ts.isShorthandPropertyAssignment(prop)) return resolve(prop.name, seen);
      }
      if (node.name.text === 'value') return parent;
    }
    return node;
  }
  const literal = (node) => {
    node = resolve(node);
    return node && ts.isStringLiteralLike(node) ? node.text : undefined;
  };
  function returns(node) {
    if (!ts.isBlock(node)) return [node];
    const result = [];
    function visit(child) {
      if (ts.isReturnStatement(child) && child.expression) result.push(child.expression);
      else if (!ts.isFunctionLike(child)) ts.forEachChild(child, visit);
    }
    visit(node);
    return result;
  }
  // Trace only values that reach the bound columns. A discarded filter call proves nothing.
  function columns(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return [{ unknown: true }];
    const next = new Set([...seen, node]);
    if (ts.isIdentifier(node)) {
      const declaration = definition(node.text, node);
      if (!declaration) return [{ unknown: true }];
      const result = columns(declaration.initializer, next);
      // Existing builders append columns before returning the resulting array.
      const scope = scopeOf(declaration);
      function mutations(child) {
        if (
          ts.isCallExpression(child) &&
          ts.isPropertyAccessExpression(child.expression) &&
          ts.isIdentifier(child.expression.expression) &&
          child.expression.expression.text === node.text &&
          definition(node.text, child.expression.expression) === declaration &&
          ['push', 'unshift'].includes(child.expression.name.text)
        )
          result.push(...child.arguments.flatMap((argument) => columns(argument, next)));
        ts.forEachChild(child, mutations);
      }
      if (scope) mutations(scope);
      return result;
    }
    const resolved = resolve(node);
    if (resolved !== node) return columns(resolved, next);
    if (ts.isArrayLiteralExpression(node))
      return node.elements.flatMap((item) => columns(ts.isSpreadElement(item) ? item.expression : item, next));
    if (ts.isConditionalExpression(node)) return [...columns(node.whenTrue, next), ...columns(node.whenFalse, next)];
    if (ts.isObjectLiteralExpression(node)) {
      const prop = (key) =>
        node.properties.find(
          (item) => (item.name && ('text' in item.name ? item.name.text : item.name.getText(parsed))) === key,
        );
      const value = (key) => {
        const p = prop(key);
        return p && ts.isPropertyAssignment(p) ? literal(p.initializer) : undefined;
      };
      return [{ key: value('colKey'), type: value('type') }];
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression) && helperNames.has(node.expression.text)) return [{ protected: true }];
      if (['computed', 'ref', 'shallowRef'].includes(node.expression.getText(parsed))) {
        const arg = node.arguments[0];
        return arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))
          ? returns(arg.body).flatMap((value) => columns(value, next))
          : columns(arg, next);
      }
    }
    return [{ unknown: true }];
  }
  const problems = [];
  const binding = (node, key) =>
    node.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && prop.arg?.content === key)
      ?.exp?.content;
  const expression = (text) => {
    const tree = ts.createSourceFile('binding.ts', `(${text})`, ts.ScriptTarget.Latest, true);
    const result = tree.statements[0]?.expression;
    // Template expressions resolve in the SFC setup scope, not the synthetic source file.
    if (result) result.parent = parsed;
    return result;
  };
  function hasCheckbox(node) {
    return node.type === NodeTypes.ELEMENT && (node.tag === 't-checkbox' || node.children.some(hasCheckbox));
  }
  function checkboxSlots(node) {
    return node.children
      .filter((child) => child.type === NodeTypes.ELEMENT && hasCheckbox(child))
      .flatMap((child) =>
        child.props
          .filter((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot')
          .map((prop) => prop.arg?.content),
      )
      .filter(Boolean);
  }
  function visit(node, inDialog = false) {
    if (node.type === NodeTypes.ELEMENT) {
      const slots = checkboxSlots(node);
      const customSelection = slots.filter((slot) => /select/i.test(slot) || slots.includes(`${slot}Title`));
      if (
        node.tag === 'AdminListPage' &&
        customSelection.length &&
        !node.props.some(
          (prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'selection-column-key' && prop.value?.content,
        )
      )
        problems.push(`${file}: custom list selection must declare selection-column-key`);
      if (node.tag === 't-table') {
        const direct = binding(node, 'columns');
        const spread = node.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'bind' && !prop.arg)
          ?.exp?.content;
        const text = direct ?? (spread ? `(${spread}).columns` : undefined);
        const facts = text ? columns(expression(text)) : [{ unknown: true }];
        const picker = inDialog && businessPickers.get(file)?.has(direct);
        const rawSelection = facts.some(
          (fact) => !fact.protected && (fact.type === 'multiple' || customSelection.includes(fact.key)),
        );
        const selectionEvidence =
          customSelection.length ||
          (binding(node, 'selected-row-keys') && !facts.some((fact) => fact.type === 'single'));
        const unproven = facts.some((fact) => fact.unknown) && (spread || selectionEvidence);
        if (!picker && (rawSelection || unproven || (selectionEvidence && !facts.some((fact) => fact.protected))))
          problems.push(
            `${file}: selectable table ${text ?? '(unbound columns)'} must return columns from the shared batch capability`,
          );
      }
      inDialog ||= ['AdminDialog', 'AdminFormDialog'].includes(node.tag);
    }
    for (const child of node.children ?? []) visit(child, inDialog);
  }
  visit(parseTemplate(descriptor.template.content));
  return problems;
}
