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
  await host.getByPlaceholder('请输入').first().fill('测试客户');
  await expect(page.getByText('查询次数：0')).toBeVisible();
  await host.getByRole('button', { name: '查询', exact: true }).click();
  await expect(page.getByText('查询次数：1')).toBeVisible();
  await host.getByRole('button', { name: '重置', exact: true }).click();
  await expect(host.getByPlaceholder('请输入').first()).toHaveValue('');
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
  await dialog.getByRole('button', { name: '提交', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText('详情范例', { exact: true })).toBeVisible();
  expect(requests).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath('whole-page-examples.png'),
    fullPage: true,
    animations: 'disabled',
  });
});

test('registered extension wraps predictably and contains long labels without clipping at narrower widths', async ({
  page,
}) => {
  for (const width of [1366, 1024, 768]) {
    await page.setViewportSize({ width, height: 858 });
    await page.goto('/tests/fixtures/official-ui/examples.html');
    const form = page.locator('.zdm-official-list-page__filters');
    await expect(form.getByRole('button', { name: '查询', exact: true })).toBeVisible();
    const geometry = await form.evaluate((element) => {
      const host = element.getBoundingClientRect();
      const fields = [...element.querySelectorAll('.t-form__item, .t-space')].map((child) =>
        child.getBoundingClientRect(),
      );
      return {
        hostRight: host.right,
        rightEdges: fields.map((rect) => rect.right),
        scroll: document.documentElement.scrollWidth,
        viewport: innerWidth,
      };
    });
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.viewport);
    for (const right of geometry.rightEdges) expect(right).toBeLessThanOrEqual(geometry.hostRight + 1);
  }
});
