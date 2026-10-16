import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import ts from 'typescript';
import registry from '../src/components/foundation/actions/button-functions.json' with { type: 'json' };
const attr = (node, name) =>
  node.props.find((p) => (p.type === 6 ? p.name : p.name === 'bind' ? p.arg?.content : '') === name);
const value = (p) => (p?.type === 6 ? p.value?.content : p?.exp?.content);
function expression(source) {
  return ts.createSourceFile('confirmation.ts', `(${source})`, ts.ScriptTarget.Latest, true).statements[0]?.expression
    ?.expression;
}
const literal = (node) => (node && ts.isStringLiteral(node) ? node.text : undefined);
function validIntent(node) {
  if (!node) return false;
  if (ts.isConditionalExpression(node)) return validIntent(node.whenTrue) && validIntent(node.whenFalse);
  if (ts.isCallExpression(node)) {
    const name = node.expression.getText();
    const [first] = node.arguments;
    if (name === 'formConfirmation')
      return (
        node.arguments.length === 1 && (literal(first) === undefined || ['create', 'edit'].includes(literal(first)))
      );
    if (name === 'operationConfirmation')
      return (
        node.arguments.length >= 1 &&
        node.arguments.length <= 2 &&
        (literal(first) === undefined || Object.hasOwn(registry.confirmationActions, literal(first)))
      );
    return false;
  }
  if (!ts.isObjectLiteralExpression(node)) return false;
  const props = Object.fromEntries(node.properties.map((p) => [p.name?.getText(), p.initializer]));
  const kind = literal(props.kind);
  if (kind === 'none') return true;
  if (kind === 'close') return ['关闭', '我知道了'].includes(literal(props.text));
  if (kind === 'navigation') return Object.hasOwn(registry.confirmationNavigation, literal(props.action));
  return false;
}
export function confirmationRegistryViolations(candidate = registry) {
  const errors = [];
  for (const [name, caption] of Object.entries(candidate.confirmationActions ?? {}))
    if (!name.trim() || !caption.trim() || /确认|提交$|[／/]/.test(caption))
      errors.push(`Invalid confirmation action: ${name}`);
  for (const [name, caption] of Object.entries(candidate.confirmationNavigation ?? {}))
    if (!name.trim() || !caption.trim()) errors.push(`Invalid confirmation navigation: ${name}`);
  if (!Object.keys(candidate.confirmationActions ?? {}).length) errors.push('Missing confirmation action registry');
  return errors;
}
export function confirmationViolations(file, source) {
  const { descriptor } = parse(source);
  if (!descriptor.template) return [];
  const errors = [];
  const adapters = [
    'src/components/foundation/AdminDialog.vue',
    'src/components/foundation/official/AdminFormDialog.vue',
  ];
  const aliases = new Set(['t-dialog', 'TDialog', 'Dialog']);
  const foundationAliases = new Map();
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
  const tree = ts.createSourceFile('page.ts', script, ts.ScriptTarget.Latest, true);
  for (const statement of tree.statements)
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'tdesign-vue-next')
      for (const item of statement.importClause?.namedBindings?.elements ?? [])
        if ((item.propertyName?.text ?? item.name.text) === 'Dialog') aliases.add(item.name.text);
  for (const statement of tree.statements)
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text.startsWith('@/components/foundation'))
      for (const item of statement.importClause?.namedBindings?.elements ?? []) {
        const imported = item.propertyName?.text ?? item.name.text;
        if (['AdminDialog', 'AdminFormDialog', 'AdminConfirmDialog'].includes(imported))
          foundationAliases.set(item.name.text, imported);
      }
  let usesHelper = false;
  function walk(node) {
    if (node.type === 1) {
      const fail = (message) => errors.push(`${file}:${node.loc.start.line}: ${message}`);
      const tag = foundationAliases.get(node.tag) ?? node.tag;
      if (['AdminDialog', 'AdminFormDialog'].includes(tag)) {
        const intent = value(attr(node, 'confirmation'));
        if (
          !(file === 'src/components/foundation/AdminConfirmDialog.vue' && intent === 'confirmation') &&
          !validIntent(expression(intent ?? ''))
        )
          fail('Dialog confirmation requires an explicit registered form mode or action');
        else if (intent?.includes('Confirmation(')) usesHelper = true;
        if (attr(node, 'confirm-btn')?.type === 6 || /\bcontent\s*:/.test(value(attr(node, 'confirm-btn')) ?? ''))
          fail('Confirmation captions are generated centrally; do not override content');
        if (node.props.some((p) => p.type === 7 && p.name === 'bind' && !p.arg))
          fail('Unscoped dialog binding may override confirmation registration');
      }
      if (tag === 'AdminConfirmDialog') {
        const action = attr(node, 'action');
        if (!action || (action.type === 6 && !Object.hasOwn(registry.confirmationActions, value(action))))
          fail('Confirmation action must be registered');
      }
      if (aliases.has(node.tag) && !adapters.includes(file) && value(attr(node, 'footer')) !== 'false') {
        const call = expression(value(attr(node, 'confirm-btn')) ?? '');
        if (
          !call ||
          !ts.isCallExpression(call) ||
          call.expression.getText() !== 'dialogButtonProps' ||
          !validIntent(call.arguments[1])
        )
          fail('Native dialog confirmation must use dialogButtonProps with explicit registration');
        else {
          usesHelper = true;
          if (
            call.arguments.length > 3 ||
            (call.arguments[2] && ts.isStringLiteral(call.arguments[2])) ||
            /\bcontent\s*:/.test(call.arguments[2]?.getText() ?? '')
          )
            fail('Native confirmation captions cannot be overridden');
        }
      }
      if (
        ['t-button', 'TButton', 'Button'].includes(node.tag) &&
        (/buttonTheme\(['"](?:save|submit)['"]\)/.test(value(attr(node, 'theme')) ?? '') ||
          attr(node, 'data-form-submit'))
      ) {
        const captions = node.children.filter((c) => c.type === 2 || c.type === 5);
        if (
          !captions.some(
            (c) => c.type === 5 && /^(?:formConfirmationText|confirmationText)\(/.test(c.content.content.trim()),
          ) ||
          captions.some((c) => c.type === 2 && c.content.trim())
        )
          fail('Form execution caption must use the public confirmation naming implementation');
        else usesHelper = true;
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(parseTemplate(descriptor.template.content));
  if (usesHelper && !/from ['"]@\/components\/foundation\/actions\/confirmation['"]/.test(script))
    errors.push(`${file}: import canonical confirmation implementation`);
  return errors;
}
