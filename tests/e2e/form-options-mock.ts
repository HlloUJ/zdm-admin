import type { Page, Route } from '@playwright/test';

/** Preserve per-test collection overrides; obsolete documents cannot consume their options response. */
export async function readFormOptionsMock(page: Pick<Page, 'evaluate'>, route: Pick<Route, 'abort'>) {
  try {
    return await page.evaluate(async () => {
      const read = async (path: string) => (await (await fetch(`/api/admin/${path}`)).json()).data;
      const [categories, attributes, suppliers] = await Promise.all([
        read('product-categories'),
        read('product-attributes'),
        read('suppliers'),
      ]);
      return { categories, attributes, suppliers };
    });
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('Execution context was destroyed')) throw error;
    // Navigation destroyed the document performing the aggregate fetch. Abort this
    // obsolete request rather than failing a later document or retrying the operation.
    await route.abort('aborted');
    return undefined;
  }
}
