import { formElement, rejectFormSubmission } from './submitValidation';

/** Only shared numeric controls in this form participate; never inspect another open form. */
export async function validateNumericControls(root: unknown): Promise<boolean> {
  const element = formElement(root);
  if (!element) return true;
  let valid = true;
  for (const control of element.querySelectorAll<HTMLElement>('[data-numeric-error]')) {
    const input = control.querySelector<HTMLInputElement>('input');
    if (!input || input.disabled || input.readOnly || !control.dataset.numericError) continue;
    control.dispatchEvent(new CustomEvent('numeric-validate', { bubbles: true }));
    valid = false;
  }
  return valid || rejectFormSubmission(root);
}
