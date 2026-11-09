import { expect, type Locator } from '@playwright/test';

export async function clickOpenedDialogConfirmation(dialog: Locator, label: string) {
  const context = dialog.locator(
    'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " t-dialog__ctx ")][1]',
  );
  await expect(context).toBeVisible();
  // The installed TDesign dialog can still be entering after the card is visible
  // and its button has been stable for two frames. Act only after opening ends.
  await expect(context).not.toHaveClass(/t-dialog-zoom__vue-enter-(?:from|active|to)/);
  await dialog.getByRole('button', { name: label, exact: true }).click();
}
