export interface ApplicationManifest {
  version: 1;
  entries: string[];
  developmentCases: Array<{ file: string; title: string; movedFrom: string }>;
}
export const APP_DIRECTORY: string;
export const APP_PROOF: string;
export function readApplicationManifest(root?: string): ApplicationManifest;
export function applicationSource(root?: string): string;
export function readApplicationProof(root?: string): { version: 1; source: string; artifact: string; policy: string };
export function prepareApplication(root?: string): ReturnType<typeof readApplicationProof>;
export function testPorts(env?: Record<string, string | undefined>): { app: number; development: number };
