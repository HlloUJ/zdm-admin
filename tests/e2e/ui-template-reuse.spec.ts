import { expect, test } from '@playwright/test';

test('whole page examples reuse all list modes and native client pagination without business API', async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api/')) requests.push(request.url());
  });
  await page.goto('/tests/fixtures/official-ui/examples.html');
  const host = page.locator('.zdm-official-list-page');
  await expect(host).toHaveAttribute('data-page-template', 'tab-filter-list');
  await expect(host.getByText('客户1', { exact: true })).toBeVisible();
  await expect(host.getByText('客户11', { exact: true })).toHaveCount(0);
  await host.locator('.t-pagination__btn-next').click();
  await expect(host.getByText('客户11', { exact: true })).toBeVisible();
  await expect(host.getByText('客户1', { exact: true })).toHaveCount(0);
  await host.getByPlaceholder('请输入姓名').first().fill('测试客户');
  await expect(page.getByText('查询次数：0')).toBeVisible();
  await host.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('查询次数：1')).toBeVisible();
  await host.getByRole('button', { name: '重置', exact: true }).click();
  await expect(host.getByPlaceholder('请输入姓名').first()).toHaveValue('');
  await page.getByRole('button', { name: '基础列表', exact: true }).click();
  await expect(host).toHaveAttribute('data-page-template', 'base-list');
  await expect(host.locator('.t-tabs')).toHaveCount(0);
  await expect(host.locator('.t-form')).toHaveCount(0);
  await page.getByRole('button', { name: '筛选列表', exact: true }).click();
  await expect(host).toHaveAttribute('data-page-template', 'filter-list');
  await expect(host.locator('.t-form')).toBeVisible();
  await page.getByRole('button', { name: '表单弹窗', exact: true }).click();
  const dialog = page.locator('.t-dialog:visible');
  await expect(dialog.locator('.t-form')).toBeVisible();
  await dialog
    .getByRole('button', {
      name: /^确认(?:新增|保存|(?:批量)?(?:下架|调整归属)|配置权限|业务开通|添加属性|邀请员工)$/,
      exact: true,
    })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('详情范例', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('whole-page-examples.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('registered query extension contains labels controls and actions at desktop and narrow widths', async ({
  page,
}) => {
  for (const width of [1366, 1024, 768, 390]) {
    await page.setViewportSize({ width, height: 858 });
    await page.goto('/tests/fixtures/official-ui/examples.html');
    const form = page.locator('.zdm-official-list-page__grid-filters');
    await expect(form.getByRole('button', { name: '查询', exact: true })).toBeVisible();
    const geometry = await form.evaluate((element) => {
      const host = element.getBoundingClientRect();
      const fields = [...element.querySelectorAll('.t-form__label, .t-form__controls, .filter-actions button')].map(
        (child) => child.getBoundingClientRect(),
      );
      return {
        hostLeft: host.left,
        hostRight: host.right,
        leftEdges: fields.map((rect) => rect.left),
        rightEdges: fields.map((rect) => rect.right),
        scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
    for (const left of geometry.leftEdges) expect(left).toBeGreaterThanOrEqual(geometry.hostLeft - 1);
    for (const right of geometry.rightEdges) expect(right).toBeLessThanOrEqual(geometry.hostRight + 1);
  }
});

for (const count of [1, 2, 3, 4, 7]) {
  test(`default query standard keeps ${count} fields aligned across container widths`, async ({ page }) => {
    await page.goto(`/tests/fixtures/official-ui/examples.html?filterCount=${count}`);
    const host = page.locator('.zdm-official-list-page');
    const form = host.locator('.zdm-standard-query');
    const fields = form.locator('.filter-fields');
    await expect(fields.locator('.t-form__item')).toHaveCount(count);
    await host.getByPlaceholder('请输入姓名').fill('保留条件');
    for (const width of [1689, 1366, 1024, 992, 991, 768, 390]) {
      await page.setViewportSize({ width, height: 858 });
      const metrics = await form.evaluate((el) => {
        const grid = el.querySelector('.filter-fields')!;
        const area = el.querySelector('.filter-row')!;
        const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
        const division = getComputedStyle(area).gridTemplateColumns.split(' ').map(parseFloat);
        const controls = [...grid.querySelectorAll('.t-form__controls')].map((control) => {
          const { x, y, width, bottom, height } = control.getBoundingClientRect();
          return { x, y, width, bottom, height };
        });
        const labels = [...grid.querySelectorAll('.t-form__label')].map((label) => label.getBoundingClientRect().width);
        const actions = el.querySelector('.filter-actions')!.getBoundingClientRect();
        const areaBox = area.getBoundingClientRect();
        const gridBox = grid.getBoundingClientRect();
        return {
          columns,
          division,
          controls,
          labels,
          width: gridBox.width,
          fieldsBottom: gridBox.bottom,
          actions: { y: actions.y, bottom: actions.bottom, right: actions.right },
          areaRight: areaBox.right,
        };
      });
      const maxColumns = count >= 4 ? 4 : 3;
      expect(metrics.columns).toBe(Math.max(1, Math.min(maxColumns, Math.floor(metrics.width / 238))));
      if (width > 991) {
        expect(metrics.division).toHaveLength(2);
        expect(metrics.division[0] / metrics.division[1]).toBeCloseTo(5, 1);
      } else {
        // docs/ui/query-standard.md: narrow layouts stack actions below the fields.
        expect(metrics.division).toHaveLength(1);
        expect(metrics.actions.y - metrics.fieldsBottom).toBeCloseTo(24, 0);
        expect(metrics.actions.right).toBeCloseTo(metrics.areaRight, 0);
      }
      for (const labelWidth of metrics.labels) expect(labelWidth).toBeCloseTo(80, 0);
      for (let index = 0; index < count; index++) {
        const control = metrics.controls[index];
        expect(control.width).toBeCloseTo(metrics.controls[0].width, 0);
        expect(control.x).toBeCloseTo(metrics.controls[index % metrics.columns].x, 0);
        if (index >= metrics.columns) {
          expect(control.y - metrics.controls[index - metrics.columns].bottom).toBeCloseTo(24, 0);
        }
      }
      const lastBottom = Math.max(...metrics.controls.map((control) => control.bottom));
      const operations = (await host.locator('.zdm-official-list-page__operations').boundingBox())!;
      expect(operations.y - Math.max(lastBottom, metrics.actions.bottom)).toBeCloseTo(24, 0);
      await expect(host.getByPlaceholder('请输入姓名')).toHaveValue('保留条件');
      await expect(page.getByText('查询次数：0')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await form.getByRole('button', { name: '查询', exact: true }).click();
    await expect(page.getByText('查询次数：1')).toBeVisible();
    await form.getByRole('button', { name: '重置', exact: true }).click();
    await expect(host.getByPlaceholder('请输入姓名')).toHaveValue('');
  });
}

test('compound search uses a short label with explicit full hint without changing query timing', async ({ page }) => {
  await page.goto('/tests/fixtures/official-ui/examples.html?compoundSearch=1');
  const form = page.locator('.zdm-standard-query');
  const item = form.locator('.t-form__item').first();
  await expect(item.locator('.t-form__label')).toHaveText('商品：');
  expect((await item.locator('.t-form__label').boundingBox())!.width).toBe(80);
  const input = item.getByPlaceholder('请输入商品名称/ID/编号', { exact: true });
  await input.fill('测试编号');
  await expect(page.getByText('查询次数：0')).toBeVisible();
  await form.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('查询次数：1')).toBeVisible();
  await form.getByRole('button', { name: '重置', exact: true }).click();
  await expect(input).toHaveValue('');
  await expect(form.locator('.t-form__item').nth(1).getByPlaceholder('请输入联系电话')).toBeVisible();
});
