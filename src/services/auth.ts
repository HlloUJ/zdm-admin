import { request, setAuthToken } from './http';

export interface LoginPayload {
  phone: string;
  verifyCode: string;
}

export interface LoginResult {
  token: string;
  user: {
    id: number;
    name: string;
    phone: string;
    roles: string[];
    permissions: string[];
  };
}

export async function login(payload: LoginPayload) {
  const result = await request<LoginResult>('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setAuthToken(result.token);
  return result;
}
