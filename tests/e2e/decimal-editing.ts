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

export async function checkNumericEditingRecovery(input: Locator) {
  await input.fill('100.23');
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0));
  await input.press('Delete');
  await expect(input).toHaveValue('00.23');
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0));
  await input.press('Delete');
  await expect(input).toHaveValue('0.23');
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0));
  await input.press('Delete');
  await expect(input).toHaveValue('.23');
  await input.press('ControlOrMeta+A');
  await input.press('Backspace');
  await expect(input).toHaveValue('');
  await input.pressSequentially('100.23');
  await expect(input).toHaveValue('100.23');
  await input.press('ControlOrMeta+A');
  await input.evaluate(async (element) => {
    const field = element as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    for (const value of ['zh', '中文']) {
      field.value = value;
      field.dispatchEvent(
        new InputEvent('input', { bubbles: true, inputType: 'insertCompositionText', isComposing: true }),
      );
      await new Promise(requestAnimationFrame);
      if (field.value !== value) throw new Error('Composition draft was overwritten');
    }
    field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
    await new Promise(requestAnimationFrame);
  });
  await expect(input).toHaveValue('100.23');
  expect(
    await input.evaluate((element) => [
      (element as HTMLInputElement).selectionStart,
      (element as HTMLInputElement).selectionEnd,
    ]),
  ).toEqual([0, 6]);
  await input.pressSequentially('123.45');
  await expect(input).toHaveValue('123.45');
  await input.press('6');
  await expect(input).toHaveValue('123.45');
  await input.evaluate((element) => (element as HTMLInputElement).setSelectionRange(0, 0));
  await input.pressSequentially('7');
  await expect(input).toHaveValue('7123.45');
  await input.blur();
  await expect(input).toHaveValue('7123.45');
}
