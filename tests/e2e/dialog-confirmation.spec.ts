import { expect, test } from '@playwright/test';
import { clickOpenedDialogConfirmation } from './dialog-confirmation';

test('confirmation waits for a completed dialog opening and clicks exactly once', async ({ page }) => {
  await page.setContent(`<div class="t-dialog__ctx"><div class="t-dialog">
    <button onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">确认操作</button>
  </div></div>`);
  const button = page.getByRole('button', { name: '确认操作', exact: true });
  await clickOpenedDialogConfirmation(page.locator('.t-dialog'), '确认操作');
  await expect(button).toHaveAttribute('data-clicks', '1');
});

test('a visible but still entering dialog cannot dispatch its confirmation', async ({ page }) => {
  await page.setContent(`<div class="t-dialog__ctx t-dialog-zoom__vue-enter-active"><div class="t-dialog">
    <button onclick="this.dataset.clicks=String(Number(this.dataset.clicks||0)+1)">确认操作</button>
  </div></div>`);
  const button = page.getByRole('button', { name: '确认操作', exact: true });
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  await expect(clickOpenedDialogConfirmation(page.locator('.t-dialog'), '确认操作')).rejects.toThrow(/toHaveClass/);
  await expect(button).not.toHaveAttribute('data-clicks');
});
