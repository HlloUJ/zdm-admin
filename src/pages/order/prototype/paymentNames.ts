/** Retire browser-only configuration without importing it into the shared store database. */
export function stripLocalPaymentConfiguration(state: object) {
  const legacy = state as { settings?: unknown; paymentNames?: unknown };
  delete legacy.settings;
  delete legacy.paymentNames;
}
