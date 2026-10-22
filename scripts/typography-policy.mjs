import postcss from 'postcss';
import { parse } from '@vue/compiler-sfc';

const properties = new Set(['font', 'font-family', 'font-size', 'font-weight', 'line-height']);
export function typographyViolations(file, source, officialTokens, richTextExclusion) {
  const styles = file.endsWith('.vue') ? parse(source).descriptor.styles.map((style) => style.content) : [source];
  const problems = [];
  for (const style of styles) {
    postcss.parse(style).walkDecls((declaration) => {
      const { prop, value, parent } = declaration;
      if (/^--(?:td|zdm)-(?:font|line-height)/.test(prop)) {
        problems.push(`${file}: do not redefine official typography`);
        return;
      }
      if (!properties.has(prop)) return;
      if (file === richTextExclusion && prop === 'line-height' && ['1.5', '0.5'].includes(value)) return;
      const variable = /^var\((--td-(?:font|line-height)-[\w-]+)\)$/.exec(value);
      const allowedVariable = {
        font: /^--td-font-(?:body|mark|title|headline|display|link)-/,
        'font-family': /^--td-font-family(?:-medium)?$/,
        'font-size': /^--td-font-size-/,
        'line-height': /^--td-line-height-/,
      }[prop];
      if (variable && allowedVariable?.test(variable[1]) && officialTokens.has(variable[1])) return;
      if (value === 'inherit' && prop === 'font') return;
      if (
        prop === 'font-family' &&
        value === '-apple-system, BlinkMacSystemFont, var(--td-font-family)' &&
        ['src/styles/index.css', 'src/components/foundation/official/AdminListPage.vue'].includes(file)
      )
        return;
      // User-selected scheme 1 retains the standalone design's existing system-font stack.
      // This approval is limited to the sales-order surface and its outer table cell boundary.
      if (
        file === 'src/pages/order/prototype/SalesOrderList.vue' &&
        prop === 'font-family' &&
        value === '-apple-system, BlinkMacSystemFont, var(--td-font-family)' &&
        ['.sales-order-list', '.order-card'].includes(parent.selector)
      )
        return;
      if (prop === 'font-weight' && value === '400' && parent.selector === '.form-section-title') {
        const declarations = parent.nodes.filter((node) => node.type === 'decl');
        const font = declarations.find((node) => node.prop === 'font');
        if (
          font?.value === 'var(--td-font-title-large)' &&
          declarations.indexOf(font) < declarations.indexOf(declaration)
        )
          return;
      }
      problems.push(`${file}: ${parent.selector} uses unregistered ${prop}: ${value}`);
    });
  }
  return problems;
}
