import { parse } from '@vue/compiler-sfc';
import ts from 'typescript';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';

const identityFields = /(?:^|\.)(?:name|title|id|code|[A-Za-z_$]\w*(?:Name|Title|No|Number|Code))$/;
const identitySlots = new Set([
  'name',
  'title',
  'customerName',
  'orderNo',
  'orderNumber',
  'orderCode',
  'serialNo',
  'code',
  'id',
]);
const controls = new Set([
  'tmenu',
  'tmenuitem',
  'tsubmenu',
  'ttabs',
  'ttabpanel',
  'ttree',
  'ttreeselect',
  'tcascader',
  'tselect',
  'toption',
  'tradio',
  'tradiobutton',
  'tcheckbox',
  'tupload',
]);
const tagName = (node) => node.tag?.replaceAll('-', '').toLowerCase();

function interactive(node) {
  if (['a', 'tlink', 'routerlink', 'button', 'tbutton'].includes(tagName(node))) return true;
  return node.props.some((prop) => {
    if (prop.type === NodeTypes.ATTRIBUTE)
      return prop.name === 'role' && ['link', 'button'].includes(prop.value?.content);
    if (prop.type !== NodeTypes.DIRECTIVE) return false;
    return (
      (prop.name === 'on' && /^(click|dblclick|keydown|keyup|keypress)$/.test(prop.arg?.content ?? '')) ||
      (prop.name === 'bind' && prop.arg?.content === 'role')
    );
  });
}

/** Ordinary record identity text is display-only; explicit actions and choice controls stay separate. */
export function displayTextViolations(source) {
  const { descriptor, errors } = parse(source);
  if (errors.length) throw new Error('Invalid Vue source');
  const problems = [];
  function visit(node, ancestors = [], slot = false) {
    if (node.type === NodeTypes.ELEMENT) {
      if (controls.has(tagName(node))) return;
      const click =
        node.props.find((p) => p.type === NodeTypes.DIRECTIVE && p.name === 'on' && p.arg?.content === 'click')?.exp
          ?.content ?? '';
      // Existing native category/spec choices and attachment preview are explicit
      // operations, not ordinary record titles. Detail navigation is never exempt.
      if (['button', 'tbutton'].includes(tagName(node)) && /^(selectCategory|toggleSpecGroup)\(/.test(click)) return;
      if (
        tagName(node) === 'tlink' &&
        /^previewAttachment\(record, attachment\)$/.test(click) &&
        node.props.some(
          (p) =>
            p.type === NodeTypes.DIRECTIVE &&
            p.name === 'bind' &&
            p.arg?.content === 'theme' &&
            p.exp?.content === "buttonTheme('preview')",
        )
      )
        return;
      const currentSlot = node.props.find((prop) => prop.type === NodeTypes.DIRECTIVE && prop.name === 'slot');
      const inSlot = currentSlot ? identitySlots.has(currentSlot.arg?.content) : slot;
      for (const child of node.children) visit(child, [...ancestors, node], inSlot);
    } else if (node.type === NodeTypes.INTERPOLATION) {
      const expression = node.content.content.trim();
      // Parse expressions instead of matching only a bare field: nullish and
      // display-format fallbacks must not turn record identity back into links.
      const expressionAst = ts.createSourceFile('display.ts', `(${expression})`, ts.ScriptTarget.Latest, true);
      let ordinaryIdentity = false;
      function identityReferences(child) {
        if (ts.isConditionalExpression(child)) {
          identityReferences(child.whenTrue);
          identityReferences(child.whenFalse);
          return;
        }
        if (ts.isPropertyAccessExpression(child) && identityFields.test(child.name.text)) ordinaryIdentity = true;
        ts.forEachChild(child, identityReferences);
      }
      identityReferences(expressionAst);
      if ((slot || ordinaryIdentity) && ancestors.some(interactive))
        problems.push(`line ${node.loc.start.line}: name/title/identifier must be display text (${expression})`);
    } else {
      for (const child of node.children ?? []) visit(child, ancestors, slot);
    }
  }
  if (descriptor.template) visit(parseTemplate(descriptor.template.content));
  for (const script of [descriptor.script, descriptor.scriptSetup].filter(Boolean)) {
    const ast = ts.createSourceFile('page.ts', script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    function hasIdentity(node) {
      if (ts.isConditionalExpression(node)) return hasIdentity(node.whenTrue) || hasIdentity(node.whenFalse);
      if (ts.isPropertyAccessExpression(node) && identityFields.test(node.name.text)) return true;
      let found = false;
      ts.forEachChild(node, (child) => {
        if (hasIdentity(child)) found = true;
      });
      return found;
    }
    function renderCalls(node) {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        ['h', 'createVNode'].includes(node.expression.text)
      ) {
        const [tag, props, children] = node.arguments;
        const kind =
          tag && (ts.isStringLiteral(tag) || ts.isIdentifier(tag)) ? tag.text.replaceAll('-', '').toLowerCase() : '';
        const hasAction =
          props &&
          ts.isObjectLiteralExpression(props) &&
          props.properties.some(
            (prop) =>
              prop.name &&
              /^(onClick|onDblclick|onKeydown|onKeyup|role)$/.test(prop.name.getText(ast).replaceAll(/['"]/g, '')),
          );
        if (
          children &&
          (['a', 'link', 'tlink', 'routerlink', 'button', 'tbutton'].includes(kind) || hasAction) &&
          hasIdentity(children)
        )
          problems.push(
            `render line ${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1}: name/title/identifier must be display text`,
          );
      }
      ts.forEachChild(node, renderCalls);
    }
    renderCalls(ast);
  }
  return problems;
}
