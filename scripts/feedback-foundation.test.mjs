import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sourceRoot = path.resolve('src');
const allowedDirectImport = path.resolve('src/components/foundation/feedback/adminFeedback.ts');

function collectSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(entryPath);
    return /\.(ts|vue)$/.test(entry.name) ? [entryPath] : [];
  });
}

test('业务模块只能通过统一反馈基座展示全局提示', () => {
  const violations = collectSourceFiles(sourceRoot)
    .filter((file) => path.resolve(file) !== allowedDirectImport)
    .filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return /import\s*\{[^}]*\b(?:DialogPlugin|MessagePlugin|NotifyPlugin)\b[^}]*\}\s*from\s*['"]tdesign-vue-next['"]/.test(
        source,
      );
    })
    .map((file) => path.relative(process.cwd(), file));

  assert.deepEqual(violations, [], `发现绕过统一反馈基座的直接导入：\n${violations.join('\n')}`);
});

test('业务模块不得继续使用无动作语义的系统提示弹窗', () => {
  const violations = collectSourceFiles(sourceRoot)
    .filter((file) => {
      const source = fs.readFileSync(file, 'utf8');
      return (
        source.includes('header="系统提示"') ||
        /<t-dialog[\s\S]{0,320}?confirm-btn="(?:确认|确定|确认删除)"/.test(source)
      );
    })
    .map((file) => path.relative(process.cwd(), file));

  assert.deepEqual(violations, [], `发现未迁移的“系统提示”弹窗：\n${violations.join('\n')}`);
});
