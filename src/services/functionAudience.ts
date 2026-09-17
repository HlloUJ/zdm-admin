import rules from '../../backend/src/main/resources/function-audience-policy.json';
import type { LoginUser } from './auth';

export function isFunctionAllowedForAudience(permission: string, audience: string) {
  if (!['admin', 'store', 'supplier', 'supply-chain'].includes(audience)) return false;
  const rule = rules
    .filter(({ prefix }) => permission === prefix || permission.startsWith(`${prefix}.`))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return Boolean(
    rule &&
    ((rule.scope === 'shared' && audience !== 'supply-chain') ||
      (rule.scope === 'admin-only' && audience === 'admin') ||
      (rule.scope === 'terminal-only' && ['store', 'supplier'].includes(audience)) ||
      (rule.scope === 'supply-chain-only' && audience === 'supply-chain') ||
      (rule.scope === 'supplier-directory' && audience !== 'admin')),
  );
}

export function getUserFunctionAudience(user: LoginUser) {
  if (user.clientCode === 'supply-chain') return 'supply-chain';
  if (user.storeId != null) {
    if (user.storeType === 'cityPartner') return 'store';
    if (user.storeType === 'slabSupplier' || user.storeType === 'finishedSupplier') return 'supplier';
    return '';
  }
  return user.tenantId == null ? 'admin' : '';
}
