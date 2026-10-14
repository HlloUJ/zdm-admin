import { parse } from '@vue/compiler-sfc';
import { parse as parseTemplate, NodeTypes } from '@vue/compiler-dom';
import { digest } from './ui-template-policy.mjs';

// Only sizing/alignment attributes are visual. Classes, text, fields, events,
// directives, component structure and every script byte remain protected.
const visualProps = new Set(['style', 'width', 'height', 'label-width', 'label-align', 'size', 'align', 'gutter']);
export function businessFingerprint(source) {
  const { descriptor, errors } = parse(source);
  if (errors.length) throw new Error('Invalid Vue source');
  function shape(node) {
    if (node.type === NodeTypes.TEXT) return node.content.trim() ? ['text', node.content.trim()] : null;
    if (node.type === NodeTypes.INTERPOLATION) return ['expression', node.content.content];
    if (node.type === NodeTypes.ELEMENT) {
      return [
        node.tag,
        node.props
          .filter((prop) => {
            const name =
              prop.type === NodeTypes.ATTRIBUTE ? prop.name : prop.name === 'bind' ? prop.arg?.content : null;
            return !visualProps.has(name);
          })
          .map((prop) =>
            prop.type === NodeTypes.ATTRIBUTE
              ? [prop.name, prop.value?.content ?? '']
              : [
                  prop.name,
                  prop.arg?.content ?? '',
                  prop.exp?.content ?? '',
                  prop.modifiers.map((m) => m.content ?? m),
                ],
          ),
        node.children.map(shape).filter(Boolean),
      ];
    }
    return node.children?.map(shape).filter(Boolean) ?? null;
  }
  return {
    script: digest(JSON.stringify([descriptor.script?.content ?? '', descriptor.scriptSetup?.content ?? ''])),
    template: digest(JSON.stringify(descriptor.template ? shape(parseTemplate(descriptor.template.content)) : null)),
  };
}
export function contractViolations(file, source, baseline) {
  if (!baseline) return [`${file}: missing pre-refactor business contract`];
  if (!file.endsWith('.vue')) return digest(source) === baseline.content ? [] : [`${file}: nonvisual source changed`];
  const current = businessFingerprint(source);
  return ['script', 'template']
    .filter((key) => current[key] !== baseline[key])
    .map((key) => `${file}: ${key} business contract changed`);
}
