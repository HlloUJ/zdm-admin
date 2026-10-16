import { expect, type Locator } from '@playwright/test';

export async function checkDecimalEditing(input: Locator) {
  const original = await input.inputValue();
  for (const decimalKey of ['.', 'NumpadDecimal']) {
    await input.click();
    await input.press('ControlOrMeta+A');
    await input.pressSequentially('52');
    await expect(input).toHaveValue('52');
    await input.press('Backspace');
    await expect(input).toHaveValue('5');
    await input.press(decimalKey);
    await expect(input).toHaveValue('5.');
    await input.press('2');
    await expect(input).toHaveValue('5.2');
    await input.blur();
    await expect(input).toHaveValue('5.20');
  }
  await input.fill(original);
  await input.blur();
}
