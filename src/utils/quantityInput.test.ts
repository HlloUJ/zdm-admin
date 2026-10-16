import { describe, expect, it } from 'vitest';
import { preventZeroQuantity } from './quantityInput';

function input(value: string, start = value.length, end = start) {
  const element = document.createElement('input');
  element.value = value;
  element.setSelectionRange(start, end);
  element.addEventListener('beforeinput', (event) => preventZeroQuantity(event as InputEvent));
  element.addEventListener('paste', (event) => preventZeroQuantity(event as ClipboardEvent));
  return element;
}
describe('quantity zero input restriction', () => {
  it.each([
    ['', 0, 0, '0'],
    ['12', 0, 2, '0'],
    ['0', 1, 1, '0'],
  ])('rejects zero without substituting a value: %j', (value, start, end, data) => {
    const element = input(String(value), Number(start), Number(end));
    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: String(data),
    });
    expect(element.dispatchEvent(event)).toBe(false);
    expect(element.value).toBe(value);
  });
  it('keeps zero digits in positive quantities and clearing available', () => {
    for (const [value, inputType, data] of [
      ['1', 'insertText', '0'],
      ['2', 'insertText', '0'],
      ['1', 'deleteContentBackward', null],
    ] as const) {
      const element = input(value);
      expect(element.dispatchEvent(new InputEvent('beforeinput', { cancelable: true, inputType, data }))).toBe(true);
    }
  });
  it.each(['a', '中文', '-', '+', '.', '1.5', '1e2', ' 2 ', '12a'])(
    'rejects non-digit typing and paste: %s',
    (data) => {
      const element = input('');
      expect(
        element.dispatchEvent(new InputEvent('beforeinput', { cancelable: true, inputType: 'insertText', data })),
      ).toBe(false);
      const paste = new Event('paste', { cancelable: true });
      Object.defineProperty(paste, 'clipboardData', { value: { getData: () => data } });
      expect(element.dispatchEvent(paste)).toBe(false);
    },
  );
  it('rejects deleting down to zero and pasting zero over the full value', () => {
    const element = input('10', 0, 1);
    expect(
      element.dispatchEvent(new InputEvent('beforeinput', { cancelable: true, inputType: 'deleteContentBackward' })),
    ).toBe(false);
    element.setSelectionRange(0, 2);
    const paste = new Event('paste', { cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: () => '0' } });
    expect(element.dispatchEvent(paste)).toBe(false);
  });
});
