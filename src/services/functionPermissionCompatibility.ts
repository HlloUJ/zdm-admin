const legacyAttributePermissionPrefix = 'admin.product-data-center.attribute';
const attributeScopes = ['shared', 'finished', 'accessory'] as const;

const legacyAttributeActionMap: Record<string, string> = {
  view: 'view',
  query: 'view',
  查询: 'view',
  create: 'create',
  edit: 'toggle-status',
  'toggle-status': 'toggle-status',
  delete: 'delete',
};

export const expandLegacyAttributePermission = (permission: string) => {
  const prefix = `${legacyAttributePermissionPrefix}.`;
  if (!permission.startsWith(prefix)) return [permission];

  const suffix = permission.slice(prefix.length);
  const action = legacyAttributeActionMap[suffix];
  if (!action) return [permission];

  return attributeScopes.map((scope) => `${legacyAttributePermissionPrefix}.${scope}.${action}`);
};
