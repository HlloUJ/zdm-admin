const legacyScopedPermissionPrefixes = [
  'admin.product-data-center.attribute',
  'admin.product-data-center.attribute-value',
] as const;
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

export const expandLegacyScopedPermission = (permission: string) => {
  const legacyPermissionPrefix = legacyScopedPermissionPrefixes.find((candidate) =>
    permission.startsWith(`${candidate}.`),
  );
  if (!legacyPermissionPrefix) return [permission];

  const suffix = permission.slice(legacyPermissionPrefix.length + 1);
  const action = legacyAttributeActionMap[suffix];
  if (!action) return [permission];

  return attributeScopes.map((scope) => `${legacyPermissionPrefix}.${scope}.${action}`);
};
