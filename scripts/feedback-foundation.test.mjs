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

// Operation inventory is part of the existing mandatory source-guard domain.
import {
  auditOperations,
  operationBindings,
  operationDigest,
  operationViolations,
  hasSharedPreflight,
} from './operation-feedback-policy.mjs';
const operationRegistry = JSON.parse(fs.readFileSync('docs/ui/operation-feedback-registry.json', 'utf8'));
test('all existing and new operation entries have an exact reviewed classification', () => {
  assert.deepEqual(auditOperations(process.cwd(), operationRegistry), []);
});
test('operation guard rejects missing declarations, stale implementations, blockers and partial-batch misuse', () => {
  const source = `<template><AdminConfirmDialog @confirm="submit" /></template><script setup>
import { useOperationPreflight } from '@/composables/useOperationPreflight';
const preflight = useOperationPreflight();
const submit = () => preflight.run(async () => {});
</script>`;
  const parsed = operationBindings(source);
  const entry = { ...parsed, bindings: parsed.bindings.map((b) => ({ ...b, type: 'single' })) };
  assert.deepEqual(operationViolations('new.vue', source, entry), []);
  assert.ok(operationViolations('new.vue', source, undefined).length);
  assert.ok(operationViolations('new.vue', source.replace('submit"', 'other"'), entry).length);
  assert.ok(
    operationViolations('new.vue', source.replace('async () => {}', 'async () => { execute(); }'), entry).length,
  );
  const blocked = source.replace('@confirm', 'mode="blocked" @confirm');
  assert.ok(operationViolations('new.vue', blocked, entry).length);
  const batch = structuredClone(entry);
  batch.bindings[0].type = 'batch-partial';
  batch.bindings[0].itemPreflight = true;
  assert.ok(operationViolations('new.vue', source, batch).length);
  const wrongBatch = structuredClone(entry);
  wrongBatch.bindings[0].type = 'dispatch';
  wrongBatch.bindings[0].branches = { batchShelf: 'single' };
  assert.ok(operationViolations('new.vue', source, wrongBatch).length);
  const dispatch = structuredClone(entry);
  dispatch.bindings[0].type = 'dispatch';
  assert.ok(operationViolations('new.vue', source, dispatch).length);
  assert.notEqual(operationDigest('single'), operationDigest('batch-partial'));
});

test('new module guard requires a real imported and consumed preflight, comments cannot spoof it', () => {
  assert.equal(hasSharedPreflight('<template/><script setup>// @/composables/useOperationPreflight</script>'), false);
  assert.equal(
    hasSharedPreflight(
      `<template/><script setup>import { useOperationPreflight } from '@/composables/useOperationPreflight';</script>`,
    ),
    false,
  );
  assert.equal(
    hasSharedPreflight(
      `<template/><script setup>import {useOperationPreflight as useCheck} from '@/composables/useOperationPreflight'; const p=useCheck(); const open=()=>p.run(check);</script>`,
    ),
    true,
  );
});
