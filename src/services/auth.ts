import { shallowRef } from 'vue';
import { expandLegacyAttributePermission } from './functionPermissionCompatibility';
import { clearAuthToken, request, setAuthToken } from './http';

const AUTH_USER_STORAGE_KEY = 'zdm-admin-user';

export interface LoginPayload {
  phone: string;
  verifyCode: string;
}

export interface LoginUser {
  id: number;
  name: string;
  phone: string;
  roles: string[];
  roleNames?: string[];
  permissions: string[];
  employeeId?: number;
  tenantId?: number;
  storeId?: number;
  dataPermission?: 'self' | 'all' | '';
}

export interface LoginResult {
  token: string;
  user: LoginUser;
}

const defaultLoginUser: LoginUser = {
  id: 0,
  name: '超级管理员',
  phone: '',
  roles: ['SUPER_ADMIN'],
  roleNames: ['超级管理员'],
  permissions: [],
  dataPermission: 'all',
};

const normalizeFunctionPermissions = (permissions: string[]) => {
  if (permissions.includes('all')) return ['all'];

  const normalized = new Set<string>();
  permissions.flatMap(expandLegacyAttributePermission).forEach((permission) => {
    const separatorIndex = permission.lastIndexOf('.');
    const suffix = permission.slice(separatorIndex + 1);
    if (suffix === 'reset' || suffix === '重置') return;

    const viewPermission = separatorIndex < 0 ? permission : `${permission.slice(0, separatorIndex)}.view`;
    if (suffix === 'query' || suffix === '查询') {
      normalized.add(viewPermission);
      return;
    }
    if (suffix !== 'view' && separatorIndex >= 0) normalized.add(viewPermission);
    normalized.add(permission);
  });
  return Array.from(normalized);
};

function readLoginUser() {
  const rawUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!rawUser) return defaultLoginUser;

  try {
    const user = JSON.parse(rawUser) as Partial<LoginUser>;
    if (!user.name) return defaultLoginUser;
    return {
      id: Number(user.id ?? 0),
      name: user.name,
      phone: user.phone ?? '',
      roles: user.roles ?? [],
      roleNames: user.roleNames ?? [],
      permissions: normalizeFunctionPermissions(user.permissions ?? []),
      employeeId: user.employeeId,
      tenantId: user.tenantId,
      storeId: user.storeId,
      dataPermission: user.dataPermission ?? '',
    };
  } catch {
    return defaultLoginUser;
  }
}

const loginUserState = shallowRef<LoginUser>(readLoginUser());

function clearLocalLoginSession() {
  clearAuthToken();
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  loginUserState.value = defaultLoginUser;
}

window.addEventListener('zdm-auth-session-cleared', clearLocalLoginSession);

export function getLoginUser() {
  return loginUserState.value;
}

export function setLoginUser(user: LoginUser) {
  const normalizedUser = {
    ...user,
    permissions: normalizeFunctionPermissions(user.permissions),
  };
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(normalizedUser));
  loginUserState.value = normalizedUser;
}

export async function logout() {
  try {
    await request<boolean>('/admin/auth/logout', { method: 'POST' });
  } catch {
    // A stale or unreachable session must not prevent local logout.
  } finally {
    clearLocalLoginSession();
  }
}

export async function login(payload: LoginPayload) {
  const result = await request<LoginResult>('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setAuthToken(result.token);
  setLoginUser(result.user);
  return result;
}
