import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import ts from 'typescript';
import { createHash } from 'node:crypto';

// These exact dialog tables select business inputs, not main-list batch targets.
const businessPickers = new Map([
  ['src/pages/finished-stock/store/index.vue', new Set(['poolColumns'])],
  ['src/pages/product/category-attribute-template/index.vue', new Set(['addColumns', 'valueColumns'])],
]);
// Existing dynamic display/editor columns cannot be fully resolved within one SFC.
// Only these exact bindings at these reviewed source bytes are retained. Any source
// change requires review again; new/unknown tables fail closed, never inherit an exception.
const reviewedDisplayTables = new Map([
  [
    'src/pages/finished-stock/store/StoreFinishedEditor.vue',
    { columns: 'editorColumns(columns)', digest: '1492742ec4776eba7b9d0612c49609744f8590ef60bfd2dbc4f291cd1f2e8724' },
  ],
  [
    'src/pages/finished-stock/supply-chain/index.vue',
    { columns: 'specColumns', digest: 'e1587ec2d5c209a426f8bfe9c584eb6a421289c0ef3ca40651b955330d06e1da' },
  ],
  [
    'src/pages/finished-stock/management/components/FinishedSalesLogTable.vue',
    { columns: 'columns', digest: '744af22cba91ecf7645fcb07393cfb97da1610f3544600b22925da7914760e18' },
  ],
  [
    'src/pages/finished-stock/management/components/ProductDetail.vue',
    { columns: 'columns', digest: '8817da7b58934fa9cad73e59dd0f583b34c8c9fd84aad2dab6c27d614b4869b0' },
  ],
  [
    'src/pages/finished-stock/management/components/FinishedLogValue.vue',
    { columns: 'columns', digest: 'f4486c4b3c097d4f0eb8fbc60878f034acf1a2fbf2281cd133c03aca868b192f' },
  ],
  [
    'src/pages/finished-stock/management/index.vue',
    { columns: 'specColumns', digest: 'eb08f195b1aa64cd889f68d480b68817e39177546244f73af819fb3cb89e4a34' },
  ],
]);
export function listSelectionViolations(file, source) {
  const { descriptor } = parseSfc(source);
  if (!descriptor.template) return [];
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
  const parsed = ts.createSourceFile(file + '.ts', script, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const scopeOf = (node) => {
    for (let p = node.parent; p; p = p.parent)
      if (
        ts.isSourceFile(p) ||
        ts.isFunctionLike(p) ||
        ts.isBlock(p) ||
        ts.isForStatement(p) ||
        ts.isForInStatement(p) ||
        ts.isForOfStatement(p) ||
        ts.isCatchClause(p)
      )
        return p;
  };
  function collect(node) {
    if (
      (ts.isVariableDeclaration(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isImportSpecifier(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    ) {
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
  const writeCache = new WeakMap();
  function aliases(declared, target, seen = new Set()) {
    if (declared === target) return true;
    if (!declared || seen.has(declared) || !ts.isVariableDeclaration(declared) || !declared.initializer) return false;
    const value = unwrap(declared.initializer);
    return ts.isIdentifier(value) && aliases(definition(value.text, value), target, new Set([...seen, declared]));
  }
  function untrackedWrites(declared) {
    if (writeCache.has(declared)) return writeCache.get(declared);
    let found = false;
    function root(node) {
      node = unwrap(node);
      while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)))
        node = node.expression;
      return node && ts.isIdentifier(node) ? node : undefined;
    }
    function targets(node) {
      const owner = root(node);
      return owner && aliases(definition(owner.text, owner), declared);
    }
    function visit(node) {
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        targets(node.left)
      )
        found = true;
      if (ts.isDeleteExpression(node) && targets(node.expression)) found = true;
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const method = node.expression.name.text,
          receiver = node.expression.expression;
        if (
          ['push', 'unshift', 'splice', 'pop', 'shift', 'sort', 'reverse', 'fill', 'copyWithin'].includes(method) &&
          targets(receiver)
        ) {
          // Direct pushes on the declared array are traced by columns(); indirect mutations
          // and other imperative rewrites require a reviewed, declarative column source.
          if (
            !['push', 'unshift'].includes(method) ||
            !ts.isIdentifier(receiver) ||
            definition(receiver.text, receiver) !== declared
          )
            found = true;
        }
        if (method === 'assign' && node.arguments[0] && targets(node.arguments[0])) found = true;
      }
      ts.forEachChild(node, visit);
    }
    visit(parsed);
    writeCache.set(declared, found);
    return found;
  }
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
  function publicHook(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || !ts.isIdentifier(node)) return false;
    const declared = definition(node.text, node);
    if (!declared || seen.has(declared) || untrackedWrites(declared)) return false;
    if (ts.isImportSpecifier(declared)) {
      const imported = declared.parent.parent.parent;
      return (
        ts.isImportDeclaration(imported) &&
        ['@/components/foundation', '@/components/foundation/useListBatchSelection'].includes(
          imported.moduleSpecifier.text,
        ) &&
        (declared.propertyName ?? declared.name).text === 'useListBatchSelection'
      );
    }
    return ts.isVariableDeclaration(declared) && publicHook(declared.initializer, new Set([...seen, declared]));
  }
  const memberName = (node) => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text;
    if (ts.isElementAccessExpression(node)) return literal(node.argumentExpression);
  };
  function helper(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    const next = new Set([...seen, node]);
    if (ts.isIdentifier(node)) {
      const declared = definition(node.text, node);
      if (!declared || untrackedWrites(declared)) return false;
      if (
        ts.isBindingElement(declared) &&
        (declared.propertyName ?? declared.name).getText(parsed) === 'selectionColumns'
      ) {
        const call = resolve(declared.parent.parent.initializer);
        return call && ts.isCallExpression(call) && publicHook(call.expression);
      }
      return ts.isVariableDeclaration(declared) && helper(declared.initializer, next);
    }
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      memberName(node) === 'selectionColumns'
    ) {
      const owner = resolve(node.expression);
      return owner && ts.isCallExpression(owner) && publicHook(owner.expression);
    }
    return false;
  }
  function vueWrapper(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || !ts.isIdentifier(node) || seen.has(node)) return undefined;
    const declared = definition(node.text, node);
    const names = ['computed', 'ref', 'shallowRef', 'reactive'];
    if (!declared) return names.includes(node.text) ? node.text : undefined;
    if (untrackedWrites(declared)) return undefined;
    if (ts.isImportSpecifier(declared) && declared.parent.parent.parent.moduleSpecifier.text === 'vue') {
      const name = (declared.propertyName ?? declared.name).text;
      return names.includes(name) ? name : undefined;
    }
    return ts.isVariableDeclaration(declared) ? vueWrapper(declared.initializer, new Set([...seen, node])) : undefined;
  }
  function wrapper(node) {
    return ts.isCallExpression(node) && Boolean(vueWrapper(node.expression));
  }
  function refContainer(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return false;
    if (wrapper(node)) return vueWrapper(node.expression) !== 'reactive';
    if (ts.isIdentifier(node)) {
      const declared = definition(node.text, node);
      return (
        declared && ts.isVariableDeclaration(declared) && refContainer(declared.initializer, new Set([...seen, node]))
      );
    }
    return false;
  }
  function resolve(node, seen = new Set()) {
    node = unwrap(node);
    if (!node || seen.has(node)) return node;
    const next = new Set([...seen, node]);
    if (ts.isIdentifier(node)) {
      const declared = definition(node.text, node);
      if (declared && ts.isVariableDeclaration(declared) && declared.initializer && !untrackedWrites(declared))
        return resolve(declared.initializer, next);
    }
    if (wrapper(node)) {
      const arg = node.arguments[0];
      const values = arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) ? returns(arg.body) : [arg];
      if (values.length === 1) return resolve(values[0], next);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (memberName(node) === 'value' && refContainer(node.expression)) return resolve(node.expression, next);
      const values = members(node.expression, memberName(node), next);
      if (values.length === 1 && values[0]) return resolve(values[0], next);
    }
    return node;
  }
  function members(node, key, seen = new Set()) {
    node = resolve(node);
    if (!node || seen.has(node) || key === undefined) return [undefined];
    const next = new Set([...seen, node]);
    if (ts.isConditionalExpression(node))
      return [...members(node.whenTrue, key, next), ...members(node.whenFalse, key, next)];
    if (wrapper(node)) {
      const arg = node.arguments[0];
      return arg && (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg))
        ? returns(arg.body).flatMap((value) => members(value, key, next))
        : [undefined];
    }
    if (!ts.isObjectLiteralExpression(node)) return [undefined];
    for (const prop of [...node.properties].reverse()) {
      if (ts.isSpreadAssignment(prop)) {
        const candidates = members(prop.expression, key, next);
        if (candidates.some((value) => value !== null)) return candidates;
      } else if (prop.name) {
        const name = ts.isComputedPropertyName(prop.name)
          ? literal(prop.name.expression)
          : 'text' in prop.name
            ? prop.name.text
            : undefined;
        if (name === key) {
          if (ts.isPropertyAssignment(prop)) return [prop.initializer];
          if (ts.isShorthandPropertyAssignment(prop)) return [prop.name];
          return [undefined];
        }
      }
    }
    return [null];
  }
  const literal = (node) => {
    node = resolve(node);
    if (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))) {
      const values = members(node.expression, memberName(node));
      return values.length === 1 ? literal(values[0]) : undefined;
    }
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
      if (!declaration || !ts.isVariableDeclaration(declaration) || untrackedWrites(declaration))
        return [{ unknown: true }];
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
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node))
      return members(node.expression, memberName(node)).flatMap((value) => columns(value, next));
    if (ts.isObjectLiteralExpression(node)) {
      const values = (key) => members(node, key).map((value) => (value === null ? undefined : literal(value)));
      const keys = values('colKey'),
        types = values('type');
      const unknown = members(node, 'type').some((value) => value === undefined);
      return keys.flatMap((key) => types.map((type) => ({ key, type, ...(unknown ? { unknown: true } : {}) })));
    }
    if (ts.isCallExpression(node)) {
      if (helper(node.expression)) return [{ protected: true, customKey: literal(node.arguments[1]) }];
      if (wrapper(node)) {
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
  const tagIs = (node, tag) => node.tag?.replaceAll('-', '').toLowerCase() === tag.replaceAll('-', '').toLowerCase();
  function selectionSlots(node) {
    const result = [];
    function businessField(checkbox, aliases) {
      const model = checkbox.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'model')?.exp
        ?.content;
      const checked = binding(checkbox, 'checked');
      const value = unwrap(expression(model ?? checked ?? 'undefined'));
      if (!model && !checked) return false;
      const rowValue = binding(checkbox, 'value');
      if (rowValue) {
        let usesRow = false;
        function references(value) {
          if (ts.isIdentifier(value) && aliases.has(value.text)) usesRow = true;
          ts.forEachChild(value, references);
        }
        references(expression(rowValue));
        if (usesRow) return false;
      }
      // A row field is business data. A plain model is a business control unless the same slot
      // explicitly drives row keys. Labels, slot names and header pairing are not evidence.
      if (value && (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value))) {
        let owner = value.expression;
        while (ts.isPropertyAccessExpression(owner) || ts.isElementAccessExpression(owner)) owner = owner.expression;
        return ts.isIdentifier(owner) && aliases.has(owner.text);
      }
      return Boolean(
        model &&
        value &&
        ts.isIdentifier(value) &&
        !aliases.has(value.text) &&
        !ts.isArrayLiteralExpression(resolve(value)),
      );
    }
    for (const child of node.children ?? []) {
      if (child.type !== NodeTypes.ELEMENT) continue;
      const slot = child.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot');
      if (!slot) continue;
      const aliases = new Set(['row']);
      if (slot.exp?.content) {
        const bindingTree = ts.createSourceFile(
          'slot.ts',
          `const ${slot.exp.content} = context;`,
          ts.ScriptTarget.Latest,
          true,
        );
        const binding = bindingTree.statements[0]?.declarationList?.declarations[0]?.name;
        if (binding && ts.isObjectBindingPattern(binding))
          for (const element of binding.elements)
            if ((element.propertyName ?? element.name).getText(bindingTree) === 'row' && ts.isIdentifier(element.name))
              aliases.add(element.name.text);
      }
      let selectable = false;
      function walk(value) {
        if (value.type === NodeTypes.ELEMENT && tagIs(value, 't-checkbox') && !businessField(value, aliases))
          selectable = true;
        for (const nested of value.children ?? []) walk(nested);
      }
      walk(child);
      if (selectable) result.push(slot.arg?.content);
    }
    return result.filter(Boolean);
  }
  function visit(node, inDialog = false) {
    if (node.type === NodeTypes.ELEMENT) {
      const customSelection = selectionSlots(node);
      if (tagIs(node, 'AdminListPage') && customSelection.length) {
        const declared =
          node.props.find((prop) => prop.type === NodeTypes.ATTRIBUTE && prop.name === 'selection-column-key')?.value
            ?.content ?? literal(expression(binding(node, 'selection-column-key') ?? 'undefined'));
        const keys = customSelection.filter(
          (slot) => !customSelection.some((other) => other !== slot && slot === `${other}Title`),
        );
        if (!declared || keys.some((key) => key !== declared))
          problems.push(`${file}: custom list selection must declare its matching selection-column-key`);
      }
      if (tagIs(node, 't-table')) {
        const direct = binding(node, 'columns');
        let text;
        // Vue applies v-bind and explicit props in source order. A later object may
        // replace a previously normalized columns value, including an unknown spread.
        for (const prop of node.props) {
          if (prop.type !== NodeTypes.DIRECTIVE || prop.name !== 'bind' || !prop.exp?.content) continue;
          if (prop.arg?.content === 'columns') text = prop.exp.content;
          else if (!prop.arg) {
            const values = members(expression(prop.exp.content), 'columns');
            if (values.some((value) => value !== null)) text = `(${prop.exp.content}).columns`;
          }
        }
        const facts = text ? columns(expression(text)) : [{ unknown: true }];
        const picker = inDialog && businessPickers.get(file)?.has(direct);
        const columnSelection = customSelection.filter(
          (slot) =>
            facts.some((fact) => fact.key === slot) ||
            !customSelection.some((other) => other !== slot && slot === `${other}Title`),
        );
        const rawSelection = facts.some(
          (fact) => !fact.protected && (fact.type === 'multiple' || columnSelection.includes(fact.key)),
        );
        const selectionEvidence =
          customSelection.length ||
          (binding(node, 'selected-row-keys') &&
            facts.some((fact) => fact.unknown || fact.type === 'multiple') &&
            !facts.some((fact) => fact.type === 'single'));
        const reviewed = reviewedDisplayTables.get(file);
        const reviewedDisplay =
          !selectionEvidence &&
          !rawSelection &&
          reviewed?.columns === text &&
          createHash('sha256').update(source).digest('hex') === reviewed.digest;
        const unproven = facts.some((fact) => fact.unknown) && !reviewedDisplay;
        const missingCustomFilter = columnSelection.some(
          (key) => !facts.some((fact) => fact.protected && fact.customKey === key),
        );
        if (
          !picker &&
          (rawSelection ||
            unproven ||
            missingCustomFilter ||
            (selectionEvidence &&
              !facts.some((fact) => fact.protected) &&
              !facts.some((fact) => fact.type === 'single')))
        )
          problems.push(
            `${file}: selectable table ${text ?? '(unbound columns)'} must return columns from the shared batch capability`,
          );
      }
      inDialog ||= ['AdminDialog', 'AdminFormDialog'].some((tag) => tagIs(node, tag));
    }
    for (const child of node.children ?? []) visit(child, inDialog);
  }
  visit(parseTemplate(descriptor.template.content));
  return problems;
}
