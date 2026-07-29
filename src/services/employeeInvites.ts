import { request } from './http';

export interface EmployeeInviteResponse {
  token: string;
  expiresAt: string;
}

export interface VerifyInviteCodePayload {
  phone: string;
  verifyCode: string;
}

export interface EmployeeInviteRegisterPayload extends VerifyInviteCodePayload {
  name: string;
  gender: 'male' | 'female';
}

export interface EmployeeInviteRegisterResponse {
  employeeId: number;
  status: 'enabled' | 'disabled';
}

export function createEmployeeInvite() {
  return request<EmployeeInviteResponse>('/admin/employee-invites', {
    method: 'POST',
  });
}

export function inspectEmployeeInvite(token: string) {
  return request<EmployeeInviteResponse>(`/open/employee-invites/${encodeURIComponent(token)}`);
}

export function verifyEmployeeInviteCode(token: string, payload: VerifyInviteCodePayload) {
  return request<boolean>(`/open/employee-invites/${encodeURIComponent(token)}/verify-code`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function registerEmployeeInvite(token: string, payload: EmployeeInviteRegisterPayload) {
  return request<EmployeeInviteRegisterResponse>(`/open/employee-invites/${encodeURIComponent(token)}/register`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
