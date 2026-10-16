/** The visible field title is authoritative; preserve units and search wording. */
export function controlPlaceholder(title: string, kind: 'input' | 'select' = 'input'): string {
  const label = title
    .trim()
    .replace(/^[*＊]\s*/u, '')
    .replace(/[:：]\s*$/u, '');
  return `${kind === 'select' ? '请选择' : '请输入'}${label}`;
}
