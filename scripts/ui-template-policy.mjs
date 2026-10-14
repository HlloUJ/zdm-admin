import { createHash } from 'node:crypto';
import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export function inspectPage(source) {
  const { descriptor, errors } = parse(source);
  if (errors.length || !descriptor.template) throw new Error('Invalid Vue page');
  const ast = parseTemplate(descriptor.template.content);
  const tags = [];
  const visuals = [];
  function walk(node) {
    if (node.type === NodeTypes.ELEMENT) {
      tags.push(node.tag);
      for (const prop of node.props) {
        if (
          prop.type === NodeTypes.ATTRIBUTE &&
          ['class', 'style', 'width', 'height', 'label-width', 'table-layout', 'table-content-width'].includes(
            prop.name,
          )
        )
          visuals.push([node.tag, prop.name, prop.value?.content ?? '']);
        if (
          prop.type === NodeTypes.DIRECTIVE &&
          prop.name === 'bind' &&
          prop.arg?.type === NodeTypes.SIMPLE_EXPRESSION &&
          ['style', 'width', 'height', 'label-width', 'table-content-width'].includes(prop.arg.content)
        )
          visuals.push([node.tag, ':' + prop.arg.content, prop.exp?.content ?? '']);
      }
    }
    for (const child of node.children ?? []) walk(child);
  }
  walk(ast);
  const styles = descriptor.styles.map((style) => ({ content: style.content, scoped: style.scoped, lang: style.lang }));
  return { tags, styles, visuals, visualDigest: digest(JSON.stringify({ styles, visuals })) };
}
export function pageViolations(file, source, baseline) {
  const page = inspectPage(source);
  if (baseline)
    return page.visualDigest === baseline ? [] : [`${file}: legacy visual inputs changed before migration approval`];
  const errors = [];
  if (!page.tags.some((tag) => ['AdminListPage', 'AdminFormDialog', 'AdminDetailPage'].includes(tag)))
    errors.push(`${file}: use a registered whole-page component`);
  if (page.styles.length) errors.push(`${file}: page-local CSS requires a reviewed business-layout exception`);
  const forbidden = new Set([
    't-card',
    't-tabs',
    't-table',
    't-pagination',
    't-form',
    'AdminListLayout',
    'AdminSectionCard',
    'AdminPaginationBar',
  ]);
  for (const tag of page.tags) if (forbidden.has(tag)) errors.push(`${file}: duplicated shared structure ${tag}`);
  for (const [, name] of page.visuals)
    if (name === 'style' || name === ':style' || name === 'table-content-width' || name === ':table-content-width')
      errors.push(`${file}: unregistered visual override ${name}`);
  return [...new Set(errors)];
}

export function templateShape(source, targetTag) {
  const { descriptor } = parse(source);
  const ast = parseTemplate(descriptor.template.content);
  function shape(node) {
    if (node.type === NodeTypes.TEXT) return node.content.trim() ? ['text', node.content.trim()] : null;
    if (node.type === NodeTypes.INTERPOLATION) return ['expression', node.content.content.replace(/\s+/g, '')];
    if (node.type !== NodeTypes.ELEMENT) return null;
    return [
      node.tag,
      node.props.map((prop) =>
        prop.type === NodeTypes.ATTRIBUTE
          ? [prop.name, prop.value?.content ?? '']
          : [
              prop.name,
              prop.arg?.content ?? '',
              prop.exp?.content?.replace(/\s+/g, '') ?? '',
              prop.modifiers.map((mod) => mod.content ?? mod),
            ],
      ),
      node.children.map(shape).filter(Boolean),
    ];
  }
  function find(node) {
    if (node.type === NodeTypes.ELEMENT && node.tag === targetTag) return shape(node);
    for (const child of node.children ?? []) {
      const result = find(child);
      if (result) return result;
    }
    return null;
  }
  return find(ast);
}
