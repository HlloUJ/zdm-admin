export function resetProductForm<T extends Record<string, unknown>>(form: T, defaults: T): void {
  for (const key of Object.keys(form)) {
    if (key.startsWith('attribute_')) delete form[key];
  }
  Object.assign(form, defaults);
}
