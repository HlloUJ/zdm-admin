import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate } from '@vue/compiler-dom';
import ts from 'typescript';
import postcss from 'postcss';
import { createHash } from 'node:crypto';
import registry from '../src/components/foundation/actions/button-functions.json' with { type: 'json' };
import controlRegistry from '../src/components/foundation/actions/button-controls.json' with { type: 'json' };
export function registryViolations(candidate = registry) {
  const errors = [];
  const themes = {
    normal: 'primary',
    warning: 'warning',
    destructive: 'danger',
    restore: 'success',
    auxiliary: 'default',
  };
  for (const id of Object.keys(themes)) if (!candidate.categories[id]) errors.push(`Missing semantic category: ${id}`);
  for (const [id, record] of Object.entries(candidate.functions)) {
    if (
      !/^[a-z][a-z0-9-]*$/.test(id) ||
      !record.label?.trim() ||
      !record.reason?.trim() ||
      !Object.hasOwn(themes, record.category)
    )
      errors.push(`Invalid function registration: ${id}`);
  }
  for (const [id, record] of Object.entries(candidate.categories))
    if (themes[id] !== record.theme || !record.meaning?.trim()) errors.push(`Invalid semantic category: ${id}`);
  for (const [group, entries] of Object.entries(candidate.groups))
    for (const [action, id] of Object.entries(entries))
      if (!Object.hasOwn(candidate.functions, id)) errors.push(`Unregistered group function: ${group}/${action}`);
  return errors;
}
const expression = (source) => {
  const statement = ts.createSourceFile('button.ts', `(${source})`, ts.ScriptTarget.Latest, true).statements[0];
  return statement?.expression?.expression;
};
function unwrap(node) {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
}
function functionNodeValid(input, file) {
  const node = unwrap(input);
  if (!node) return false;
  if (ts.isStringLiteral(node)) return Object.hasOwn(registry.functions, node.text);
  if (ts.isConditionalExpression(node))
    return functionNodeValid(node.whenTrue, file) && functionNodeValid(node.whenFalse, file);
  if (ts.isCallExpression(node) && node.expression.getText() === 'buttonFunctionFor') {
    const [group, action] = node.arguments;
    return (
      node.arguments.length === 2 &&
      ts.isStringLiteral(group) &&
      Object.hasOwn(registry.groups, group.text) &&
      (!ts.isStringLiteral(action) || Object.hasOwn(registry.groups[group.text], action.text))
    );
  }
  return file === 'src/components/foundation/official/AdminListPage.vue' && node.getText() === 'action.function';
}
function callValid(source, name, file) {
  const node = unwrap(expression(source));
  return (
    node &&
    ts.isCallExpression(node) &&
    node.expression.getText() === name &&
    node.arguments.length > 0 &&
    functionNodeValid(node.arguments[0], file)
  );
}
const attr = (node, name) =>
  node.props.find((p) => (p.type === 6 ? p.name : p.name === 'bind' ? p.arg?.content : '') === name);
const value = (p) => (p?.type === 6 ? p.value?.content : p?.exp?.content);
export function controlFingerprint(node) {
  const props = node.props.map((p) =>
    p.type === 6
      ? [p.name, p.value?.content ?? '']
      : [p.name, p.arg?.content ?? '', p.exp?.content ?? '', p.modifiers.map((m) => m.content)],
  );
  return createHash('sha256').update(JSON.stringify(props)).digest('hex');
}
const adapters = new Set([
  'src/components/foundation/AdminDialog.vue',
  'src/components/foundation/official/AdminFormDialog.vue',
]);
export function buttonColorViolations(file, source) {
  const errors = [];
  const { descriptor, errors: parseErrors } = parse(source);
  if (parseErrors.length) return [`${file}: invalid Vue source`];
  if (!descriptor.template) return [];
  let usesHelper = false;
  const aliases = new Map([
    ['TButton', 't-button'],
    ['Button', 't-button'],
    ['TLink', 't-link'],
    ['Link', 't-link'],
    ['TDialog', 't-dialog'],
    ['Dialog', 't-dialog'],
    ['TUpload', 't-upload'],
    ['Upload', 't-upload'],
  ]);
  const script = descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '';
  const tree = ts.createSourceFile('page.ts', script, ts.ScriptTarget.Latest, true);
  for (const statement of tree.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === 'tdesign-vue-next') {
      for (const element of statement.importClause?.namedBindings?.elements ?? []) {
        const name = element.propertyName?.text ?? element.name.text;
        if (['Button', 'Link', 'Dialog', 'Upload'].includes(name))
          aliases.set(element.name.text, 't-' + name.toLowerCase());
      }
    }
  }
  function walk(node) {
    if (node.type === 1) {
      const fail = (message) => errors.push(`${file}:${node.loc.start.line}: ${message}`);
      const tag = aliases.get(node.tag) ?? node.tag;
      const businessButton = ['t-button', 't-link'].includes(tag);
      if (node.tag === 'button' || attr(node, 'data-button-control')) {
        const fingerprint = controlFingerprint(node);
        if (
          !controlRegistry.controls.some(
            (c) => c.file === file && c.tag === node.tag && c.fingerprint === fingerprint && c.reason?.trim(),
          )
        )
          fail('Unreviewed state/content control; register an actual function or review the control boundary');
      } else if (businessButton) {
        if (!callValid(value(attr(node, 'theme')) ?? '', 'buttonTheme', file))
          fail('Button theme must reference a registered function through buttonTheme');
        else usesHelper = true;
        if (node.props.some((p) => p.type === 7 && p.name === 'bind' && !p.arg))
          fail('Unscoped button v-bind may override the function theme');
        if (/color|background|border/i.test(value(attr(node, 'style')) ?? ''))
          fail('Button colors cannot be overridden with inline styles');
      }
      if (
        ['AdminDialog', 'AdminFormDialog', 'AdminConfirmDialog'].includes(node.tag) &&
        file !== 'src/components/foundation/AdminConfirmDialog.vue'
      ) {
        const fn = attr(node, node.tag === 'AdminConfirmDialog' ? 'function' : 'confirm-function');
        if (!fn || !functionNodeValid(expression(fn.type === 6 ? JSON.stringify(value(fn)) : value(fn)), file))
          fail('Dialog must explicitly register its actual confirmation function');
      }
      for (const name of ['confirm-btn', 'cancel-btn']) {
        if (/\btheme\s*:/.test(value(attr(node, name)) ?? ''))
          fail('Do not duplicate a dialog theme; register its actual function');
      }
      if (tag === 't-dialog' && !adapters.has(file) && value(attr(node, 'footer')) !== 'false') {
        if (
          !['actionButtonProps', 'dialogButtonProps'].some((helper) =>
            callValid(value(attr(node, 'confirm-btn')) ?? '', helper, file),
          )
        )
          fail('Raw dialog confirmation must use actionButtonProps with a registered function');
        if (!/^cancelButtonProps\(/.test(value(attr(node, 'cancel-btn')) ?? ''))
          fail('Raw dialog cancellation must use cancelButtonProps');
        usesHelper = true;
      }
      if (tag === 't-upload' && !/buttonTheme\(['"]upload['"]\)/.test(value(attr(node, 'trigger-button-props')) ?? ''))
        fail('Upload button must use the registered upload theme');
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(parseTemplate(descriptor.template.content));
  if (
    usesHelper &&
    !/from ['"](?:@\/components\/foundation\/actions\/buttonFunctions|(?:\.\.\/|\.\/)+actions\/buttonFunctions)['"]/.test(
      descriptor.scriptSetup?.content ?? descriptor.script?.content ?? '',
    )
  )
    errors.push(`${file}: import the canonical function mapping`);
  return errors;
}

export function buttonClasses(source) {
  const { descriptor } = parse(source);
  const classes = new Set(['t-button', 't-link']);
  function walk(node) {
    if (['t-button', 't-link'].includes(node.tag) && !attr(node, 'data-button-control')) {
      const prop = attr(node, 'class');
      if (prop?.type === 6) for (const name of (value(prop) ?? '').split(/\s+/)) if (name) classes.add(name);
    }
    for (const child of node.children ?? []) walk(child);
  }
  if (descriptor.template) walk(parseTemplate(descriptor.template.content));
  return classes;
}
export function buttonStyleViolations(file, css, classes = new Set(['t-button', 't-link'])) {
  const errors = [];
  const root = postcss.parse(css);
  root.walkRules((rule) => {
    const selectors = rule.selector.split(',');
    for (const selector of selectors) {
      const target = selector;
      if (
        !target ||
        (![...classes].some((name) =>
          [...target.matchAll(/\.([a-zA-Z_][\w-]*)/g)].some((match) => match[1] === name),
        ) &&
          !/t-button|t-link/.test(target))
      )
        continue;
      rule.walkDecls((declaration) => {
        if (/^(?:color|background(?:-color)?|border(?:-(?:top|right|bottom|left))?(?:-color)?)$/.test(declaration.prop))
          errors.push(`${file}: button colors cannot be overridden by ${selector}`);
      });
    }
  });
  return errors;
}
