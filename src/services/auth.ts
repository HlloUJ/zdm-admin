import { clearAuthToken, request, setAuthToken } from './http';
import { shallowRef } from 'vue';

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
      permissions: user.permissions ?? [],
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

export function getLoginUser() {
  return loginUserState.value;
}

export function setLoginUser(user: LoginUser) {
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
  loginUserState.value = user;
}

export function logout() {
  clearAuthToken();
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  loginUserState.value = defaultLoginUser;
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
