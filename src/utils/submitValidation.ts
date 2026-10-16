import { nextTick } from 'vue';
import { adminFeedback } from '@/components/foundation/feedback/adminFeedback';

export const FORM_VALIDATION_MESSAGE = '表单校验未通过，请检查标红字段';

export interface ValidationLocationOptions {
  /** Reveal an error's tab or collapsed section through the page's existing navigation API. */
  reveal?: (field: HTMLElement) => void | Promise<void>;
}

export function formElement(root: unknown): HTMLElement | undefined {
  if (root && typeof root === 'object' && 'getFormElement' in root && typeof root.getFormElement === 'function') {
    return formElement(root.getFormElement());
  }
  const element =
    root instanceof HTMLElement ? root : root && typeof root === 'object' && '$el' in root ? root.$el : undefined;
  return element instanceof HTMLElement ? element : undefined;
}

function firstError(root: HTMLElement) {
  // Only field feedback counts. API alerts and upload transport failures are not validation errors.
  const selector = '.t-is-error, .admin-media-upload--invalid, [aria-invalid="true"], [data-form-error="true"]';
  const error = root.matches(selector) ? root : root.querySelector<HTMLElement>(selector);
  return error?.closest<HTMLElement>('.t-form__item, [data-form-field]') ?? error;
}

function scrollHost(field: HTMLElement) {
  let parent = field.parentElement;
  while (parent && parent !== document.body) {
    if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY) && parent.scrollHeight > parent.clientHeight) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return undefined;
}

export function locateValidationField(field: HTMLElement, root: HTMLElement) {
  const host = scrollHost(field);
  const hostRect = host?.getBoundingClientRect();
  let top = hostRect?.top ?? 0;
  let bottom = hostRect?.bottom ?? window.innerHeight;
  // Account for existing fixed/sticky page chrome without changing its appearance or navigation.
  const scope = root.closest('.t-dialog, .t-drawer') ?? document;
  for (const chrome of scope.querySelectorAll<HTMLElement>(
    '.top-nav, .form-anchor-card, .form-submit-bar, .t-dialog__header, .t-dialog__footer, .t-drawer__header, .t-drawer__footer',
  )) {
    const rect = chrome.getBoundingClientRect();
    if (rect.height === 0) continue;
    const position = getComputedStyle(chrome).position;
    if (rect.top <= top + 1 || (['fixed', 'sticky'].includes(position) && rect.top < window.innerHeight / 2)) {
      top = Math.max(top, rect.bottom);
    }
    if (rect.bottom >= bottom - 1) bottom = Math.min(bottom, rect.top);
  }
  const rect = field.getBoundingClientRect();
  const feedbackBottom = Math.max(
    rect.bottom,
    ...Array.from(
      field.querySelectorAll<HTMLElement>(
        '.t-input__tips, .t-input__help, .t-input__extra, .t-form__controls .t-form-item-tips, .t-upload__tips',
      ),
    ).map((tip) => tip.getBoundingClientRect().bottom),
  );
  if (!rect.height || (rect.top >= top && feedbackBottom <= bottom)) return;
  const delta = rect.top - top - 16;
  if (host) host.scrollTo({ top: Math.max(0, host.scrollTop + delta), behavior: 'smooth' });
  else window.scrollTo({ top: Math.max(0, window.scrollY + delta), behavior: 'smooth' });
}

/** Call once, only on a submit rejection, after all existing validators have populated field feedback. */
export async function rejectFormSubmission(root: unknown, options: ValidationLocationOptions = {}): Promise<false> {
  adminFeedback.warning(FORM_VALIDATION_MESSAGE);
  await nextTick();
  const element = formElement(root);
  if (!element) return false;
  const field = firstError(element);
  if (!field) return false;
  await options.reveal?.(field);
  await nextTick();
  locateValidationField(firstError(element) ?? field, element);
  return false;
}
