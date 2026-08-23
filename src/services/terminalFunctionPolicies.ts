import { request } from './http';

import type { TerminalType } from './functionCatalog';

export interface TerminalFunctionPolicyRecord {
  id: number;
  terminal: TerminalType;
  functionPermissions?: string;
  updatedAt?: string;
}

export function listTerminalFunctionPolicies() {
  return request<TerminalFunctionPolicyRecord[]>('/admin/terminal-function-policies');
}

export function saveTerminalFunctionPolicy(terminal: TerminalType, functionPermissions: string) {
  return request<TerminalFunctionPolicyRecord>(`/admin/terminal-function-policies/${terminal}`, {
    method: 'PUT',
    body: JSON.stringify({ functionPermissions }),
  });
}
