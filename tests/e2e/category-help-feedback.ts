import { expect, type Locator } from '@playwright/test';

/** Assert the shared help/error slot in the actual category dialog, without saving data. */
export async function checkCategoryHelpFeedback(dialog: Locator) {
  const fields = dialog.locator('.t-form > .t-form__item');
  const name = dialog.getByPlaceholder('请输入分类名称', { exact: true });
  await name.click();
  const originalName = await name.inputValue();
  const item = dialog.locator('.t-form-item__name');
  const help = item.locator('.t-input__help');
  const helpBox = await help.boundingBox();
  const geometry = () =>
    dialog.evaluate((element) => ({
      fields: [...element.querySelectorAll('.t-form > .t-form__item')].map((field) => {
        const rect = field.getBoundingClientRect();
        return { top: rect.top, height: rect.height };
      }),
      bodyHeight: element.querySelector('.t-dialog__body')!.clientHeight,
      bodyScroll: element.querySelector('.t-dialog__body')!.scrollHeight,
    }));
  await expect(item).toHaveCSS('margin-bottom', '4px');
  const before = await geometry();
  const nameControl = await item.locator('.t-form__controls-content').boundingBox();
  const statusBox = await fields.last().boundingBox();
  expect(statusBox!.y - nameControl!.y - nameControl!.height).toBe(24);
  await name.fill('');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  const error = item.getByText('请输入分类名称', { exact: true });
  await expect(error).toBeVisible();
  await expect(help).toBeHidden();
  expect((await error.boundingBox())!.y).toBe(helpBox!.y);
  expect(await geometry()).toEqual(before);
  await name.fill(originalName);
  await name.blur();
  await expect(help).toBeVisible();
  expect(await geometry()).toEqual(before);
}
