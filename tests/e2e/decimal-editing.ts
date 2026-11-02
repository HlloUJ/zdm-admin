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
    await input.click();
    await input.press('End');
    await input.press('3');
    await expect(input).toHaveValue('5.20');
    await input.press('ControlOrMeta+A');
    await input.press('0');
    await input.press('0');
    await expect(input).toHaveValue('0');
    await input.press(decimalKey);
    await input.pressSequentially('50');
    await expect(input).toHaveValue('0.50');
    await input.press('1');
    await expect(input).toHaveValue('0.50');
  }
  await input.fill(original);
  await input.blur();
}
