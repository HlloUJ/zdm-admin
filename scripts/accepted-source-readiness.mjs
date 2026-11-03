import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ACCEPTED_SOURCE_CHECK, ACCEPTED_SOURCE_WORKFLOW } from './accepted-source-policy.mjs';
export function assessAcceptedProtection({ permission, protection, tagRulesets, verifierPublished, originBound }) {
  const issues = [];
  if (['ADMIN', 'MAINTAIN'].includes(permission)) issues.push('execution-identity-can-administer-protection');
  if (!protection.enforce_admins?.enabled || !protection.required_status_checks?.strict)
    issues.push('strict-admin-enforced-protection-missing');
  if (!protection.required_status_checks?.contexts?.includes(ACCEPTED_SOURCE_CHECK))
    issues.push('accepted-source-check-not-required');
  if (
    !tagRulesets.some(
      (r) =>
        r.enforcement === 'active' &&
        r.target === 'tag' &&
        !r.bypass_actors?.length &&
        r.conditions?.ref_name?.include?.includes('refs/tags/zdm-accepted/**') &&
        ['update', 'deletion'].every((type) => r.rules?.some((rule) => rule.type === type)),
    )
  )
    issues.push('immutable-acceptance-tag-protection-missing');
  if (!verifierPublished) issues.push('trusted-base-verifier-not-published');
  if (!originBound) issues.push('independent-check-publisher-not-proven');
  return {
    configurationReady: issues.length === 0,
    independentEnforcement: false,
    isolationProofRequired: true,
    issues,
    localSnapshot: 'content-addressed-guard-not-an-independent-permission-boundary',
  };
}
export function inspectAcceptedProtection(
  root,
  execute = (args) => {
    const r = spawnSync('gh', args, { cwd: root, encoding: 'utf8' });
    assert.equal(r.status, 0, 'Cannot inspect remote source protection');
    return JSON.parse(r.stdout);
  },
) {
  const repo = execute(['repo', 'view', '--json', 'nameWithOwner,viewerPermission']);
  const base = 'repos/' + repo.nameWithOwner;
  const protection = execute(['api', base + '/branches/main/protection']);
  const rulesets = execute(['api', base + '/rulesets']).map((r) => execute(['api', base + '/rulesets/' + r.id]));
  let verifierPublished = false;
  try {
    const verifier = execute(['api', base + '/contents/' + ACCEPTED_SOURCE_WORKFLOW + '?ref=main']);
    verifierPublished = verifier.type === 'file' && /^[a-f0-9]{40}$/.test(verifier.sha);
  } catch {
    /* Missing or inaccessible is not proof of publication. */
  }
  const binding = protection.required_status_checks?.checks?.find((c) => c.context === ACCEPTED_SOURCE_CHECK);
  // GitHub Actions' shared app (15368) does not bind this check to an independent publisher.
  const originBound = Number.isSafeInteger(binding?.app_id) && binding.app_id > 0 && binding.app_id !== 15368;
  return assessAcceptedProtection({
    permission: repo.viewerPermission,
    protection,
    tagRulesets: rulesets,
    verifierPublished,
    originBound,
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = inspectAcceptedProtection(process.cwd());
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.independentEnforcement ? 0 : 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
