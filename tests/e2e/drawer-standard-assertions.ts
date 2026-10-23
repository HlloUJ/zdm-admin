import { expect, type Locator } from '@playwright/test';

export async function expectEditableDrawer(drawer: Locator, title: string) {
  const header = drawer.locator('.t-drawer__header');
  const body = drawer.locator('.t-drawer__body');
  const footer = drawer.locator('.t-drawer__footer');
  await expect(header.getByText(title, { exact: true })).toHaveCount(1);
  await expect(body.getByText(title, { exact: true })).toHaveCount(0);
  await expect(body.getByRole('button', { name: '确认保存', exact: true })).toHaveCount(0);
  await expect(footer.getByRole('button')).toHaveText(['确认保存', '取消']);
  await expect(footer).toBeVisible();
  await footer.getByRole('button', { name: '取消', exact: true }).click({ trial: true });
  const layout = await footer.evaluate((element) => {
    const footer = element.getBoundingClientRect();
    const buttons = Array.from(element.querySelectorAll('button')).map((button) => button.getBoundingClientRect());
    return {
      left: buttons[0].left - footer.left,
      right: footer.right - buttons[1].right,
      first: buttons[0].left,
      second: buttons[1].left,
    };
  });
  expect(layout.first).toBeLessThan(layout.second);
  expect(layout.left).toBeLessThan(layout.right);
  const headerBefore = await header.boundingBox();
  const footerBefore = await footer.boundingBox();
  await body.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  expect(await header.boundingBox()).toEqual(headerBefore);
  expect(await footer.boundingBox()).toEqual(footerBefore);
}
