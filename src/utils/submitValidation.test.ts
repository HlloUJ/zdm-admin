import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FORM_VALIDATION_MESSAGE, rejectFormSubmission } from './submitValidation';

const warning = vi.hoisted(() => vi.fn());
vi.mock('@/components/foundation/feedback/adminFeedback', () => ({ adminFeedback: { warning } }));
const box = (top: number, bottom: number) => ({
  top,
  bottom,
  height: bottom - top,
  left: 0,
  right: 300,
  width: 300,
  x: 0,
  y: top,
  toJSON() {},
});

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  window.scrollTo = vi.fn();
});

describe('explicit submit validation feedback', () => {
  it('shows exactly one fixed summary and locates the first field in DOM order', async () => {
    document.body.innerHTML =
      '<form><div class="t-form__item" id="first"><input class="t-is-error"><div>请输入名称</div></div><input class="t-is-error"></form>';
    const root = document.querySelector('form')!;
    root.firstElementChild!.getBoundingClientRect = () => box(1100, 1160);
    expect(await rejectFormSubmission({ $el: root })).toBe(false);
    expect(warning).toHaveBeenCalledExactlyOnceWith(FORM_VALIDATION_MESSAGE);
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 1084, behavior: 'smooth' });
  });
  it('does not scroll when the field and its inline feedback are already visible', async () => {
    const root = document.createElement('form');
    root.innerHTML = '<div class="t-form__item t-is-error">具体提示</div>';
    root.firstElementChild!.getBoundingClientRect = () => box(100, 160);
    await rejectFormSubmission(root);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('uses the containing dialog scroller and waits for the page to reveal a hidden field', async () => {
    document.body.innerHTML =
      '<div class="t-dialog"><div style="overflow-y:auto"><form><div class="t-is-error">具体提示</div></form></div></div>';
    const root = document.querySelector('form')!;
    const host = root.parentElement!;
    Object.defineProperties(host, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } });
    host.getBoundingClientRect = () => box(200, 400);
    host.scrollTo = vi.fn();
    const field = root.firstElementChild as HTMLElement;
    field.getBoundingClientRect = () => box(600, 650);
    const reveal = vi.fn();
    await rejectFormSubmission(root, { reveal });
    expect(reveal).toHaveBeenCalledWith(field);
    expect(host.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 384, behavior: 'smooth' });
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('does not inspect unrelated forms, API alerts, or upload transport failures', async () => {
    document.body.innerHTML =
      '<input class="t-is-error"><form><div class="t-alert--error">网络异常</div><div class="t-upload__error">上传失败</div></form>';
    await rejectFormSubmission(document.querySelector('form'));
    expect(window.scrollTo).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledTimes(1);
  });
  it('has no input/blur listeners and never changes rules, values or focus', async () => {
    document.body.innerHTML = '<form><input value="原值"></form>';
    const input = document.querySelector('input')!;
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    expect(warning).not.toHaveBeenCalled();
    expect(input.value).toBe('原值');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });
  it('keeps fixed navigation and absolute inline tips within the visible area', async () => {
    document.body.innerHTML =
      '<header class="top-nav" style="position:sticky"></header><form><div class="t-form__item t-is-error"><input><div class="t-input__tips">具体提示</div></div></form>';
    document.querySelector('header')!.getBoundingClientRect = () => box(0, 64);
    const root = document.querySelector('form')!;
    root.firstElementChild!.getBoundingClientRect = () => box(45, 77);
    root.querySelector('.t-input__tips')!.getBoundingClientRect = () => box(77, 97);
    await rejectFormSubmission({ getFormElement: () => root });
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' });
    vi.mocked(window.scrollTo).mockClear();
    root.firstElementChild!.getBoundingClientRect = () => box(window.innerHeight - 40, window.innerHeight - 8);
    root.querySelector('.t-input__tips')!.getBoundingClientRect = () =>
      box(window.innerHeight - 8, window.innerHeight + 12);
    await rejectFormSubmission(root);
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
});
