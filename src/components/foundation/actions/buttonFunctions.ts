import type { ButtonProps } from 'tdesign-vue-next';
import registry from './button-functions.json';
export type ButtonFunction = keyof typeof registry.functions;
export type ButtonFunctionGroup = keyof typeof registry.groups;
export function buttonTheme(action: ButtonFunction): NonNullable<ButtonProps['theme']> {
  if (!Object.hasOwn(registry.functions, action)) throw new Error(`Unregistered button function: ${action}`);
  const category = registry.functions[action].category as keyof typeof registry.categories;
  return registry.categories[category].theme as NonNullable<ButtonProps['theme']>;
}
export function buttonFunctionFor(group: ButtonFunctionGroup, action: string): ButtonFunction {
  const entries: Record<string, string> = registry.groups[group];
  if (!Object.hasOwn(entries, action)) throw new Error(`Unregistered button action: ${group}/${action}`);
  return entries[action] as ButtonFunction;
}
export function actionButtonProps(
  action: ButtonFunction,
  original?: string | ButtonProps | null,
  fallback = '提交',
): ButtonProps | null {
  if (original === null) return null;
  return {
    ...(typeof original === 'string' ? { content: original } : (original ?? { content: fallback })),
    theme: buttonTheme(action),
  };
}
export function cancelButtonProps(original?: string | ButtonProps | null): ButtonProps | null {
  return actionButtonProps('cancel', original, '取消');
}
