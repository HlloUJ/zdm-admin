import { parse as parseSfc } from '@vue/compiler-sfc';
import { parse } from '@vue/compiler-dom';
import visualApprovals from '../docs/ui/visual-refactor.json' with { type: 'json' };

const inputTags = new Set([
  't-input',
  't-textarea',
  't-input-number',
  'DecimalInput',
  'decimal-input',
  'SpecPriceInput',
]);
const selectTags = new Set(['t-select', 't-cascader', 't-tree-select']);
const dateTags = new Set(['t-date-picker', 't-date-range-picker', 't-time-picker', 't-time-range-picker']);
const attr = (node, key) => node.props?.find((p) => p.name === key || (p.name === 'bind' && p.arg?.content === key));
const clean = (text) =>
  text
    .trim()
    .replace(/^[*＊]\s*/u, '')
    .replace(/[:：]\s*$/u, '');

export function placeholderViolations(file, source, { includeCompositeSelects = false } = {}) {
  const { descriptor } = parseSfc(source);
  if (!descriptor.template) return [];
  const violations = [];
  function walk(node, ancestors = []) {
    if (node.type !== 1) {
      for (const child of node.children ?? []) walk(child, ancestors);
      return;
    }
    const select = selectTags.has(node.tag) || (includeCompositeSelects && node.tag === 't-select-input');
    if (inputTags.has(node.tag) || select || dateTags.has(node.tag)) {
      const disabled = attr(node, 'disabled');
      const displayOnly = attr(node, 'readonly') || disabled?.name === 'disabled' || disabled?.exp?.content === 'true';
      const delegate = file === 'src/components/DecimalInput.vue' || file.endsWith('/SpecPriceInput.vue');
      const identitySwitch = file === 'src/components/AdminTopNav.vue';
      if (!displayOnly && !delegate && !identitySwitch) {
        const placeholder = attr(node, 'placeholder');
        const text = placeholder?.value?.content;
        const expression = placeholder?.exp?.content;
        const form = [...ancestors].reverse().find((p) => p.tag === 't-form-item');
        const table = [...ancestors].reverse().find((p) => p.tag === 't-table');
        // A table cell's own field/column title takes precedence over an enclosing section label.
        const label = attr(node, 'label') ?? (!table ? form && attr(form, 'label') : undefined);
        const title = label?.value?.content;
        const dynamicTitle = label?.exp?.content;
        const kind = select ? 'select' : 'input';
        const prefix = kind === 'select' ? '请选择' : '请输入';
        const scope = attr(node, 'data-query-search-scope');
        let valid;
        if (scope) {
          const query =
            file === 'src/components/foundation/official/AdminListPage.vue' ||
            ancestors.some(
              (ancestor) =>
                ancestor.tag === 't-form' && attr(ancestor, 'class')?.value?.content.includes('zdm-standard-query'),
            );
          valid =
            query &&
            node.tag === 't-input' &&
            (scope.value?.content
              ? text === `请输入${clean(scope.value.content)}`
              : expression === `controlPlaceholder(${scope.exp?.content} ?? ${dynamicTitle}, 'input')`);
        } else if (dateTags.has(node.tag)) {
          const time = node.tag.startsWith('t-time');
          valid = node.tag.includes('range')
            ? expression === `['请选择开始${time ? '时间' : '日期'}', '请选择结束${time ? '时间' : '日期'}']`
            : text ===
              `请选择${time ? '时间' : attr(node, 'enable-time-picker') || attr(node, 'enable-time') ? '日期时间' : '日期'}`;
        } else if (title) valid = text === `${prefix}${clean(title)}`;
        else if (dynamicTitle) valid = expression === `controlPlaceholder(${dynamicTitle}, '${kind}')`;
        else
          valid =
            (text?.startsWith(prefix) && text.length > prefix.length) ||
            /^controlPlaceholder\(.+, '(input|select)'\)$/u.test(expression ?? '');
        // Exact controls from an explicitly approved reference image only. The
        // ordinary title rules remain unchanged for every other control/file.
        const control = attr(node, 'data-design-control')?.value?.content;
        const exception =
          control &&
          visualApprovals.approvedVisualFiles.includes(file) &&
          visualApprovals.contracts[file]?.approvedPlaceholders?.find(
            (entry) =>
              entry.control === control &&
              entry.tag === node.tag &&
              entry.reason?.trim() &&
              ((entry.text !== undefined && text === entry.text && !expression) ||
                (entry.expression !== undefined && expression === entry.expression && !text)),
          );
        if (!valid && !exception)
          violations.push(`${file}:${node.loc.start.line}: ${node.tag} placeholder must follow its title`);
      }
    }
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  }
  walk(parse(descriptor.template.content));
  return violations;
}
