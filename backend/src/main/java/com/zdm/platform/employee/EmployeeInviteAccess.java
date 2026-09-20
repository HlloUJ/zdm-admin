package com.zdm.platform.employee;

import com.zdm.platform.auth.AuthAccount;
import com.zdm.platform.auth.AuthAccountMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.EffectivePermissionResolver;
import com.zdm.platform.security.FunctionAudiencePolicy;
import com.zdm.platform.security.ManagedClientScope;
import java.util.List;
import java.util.Objects;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class EmployeeInviteAccess {
  private final AuthAccountMapper accounts;
  private final EffectivePermissionResolver permissions;

  public EmployeeInviteAccess(AuthAccountMapper accounts, EffectivePermissionResolver permissions) {
    this.accounts = accounts;
    this.permissions = permissions;
  }

  public void requireValidIssuer(EmployeeInvite invite) {
    if (invite.getCreatedByAccountId() == null
        || accounts.findAllEnabledByAccountId(invite.getCreatedByAccountId()).stream()
            .noneMatch(account -> canInvite(account, invite))) {
      throw new IllegalArgumentException("邀请已失效，请联系管理员重新邀请");
    }
  }

  private boolean canInvite(AuthAccount account, EmployeeInvite invite) {
    if ((invite.getCreatedByIdentityId() != null
            && !Objects.equals(account.getIdentityId(), invite.getCreatedByIdentityId()))
        || !sameOrganization(account, invite)) {
      return false;
    }
    List<String> roles = "platform_admin".equals(account.getIdentityType())
        ? List.of("SUPER_ADMIN") : accounts.findAdminRoleCodes(account.getId(), account.getIdentityId());
    CurrentIdentity identity = new CurrentIdentity(null, account.getId(), account.getIdentityId(),
        account.getEmployeeId(), account.getClientCode(), account.getTenantId(), account.getStoreId(),
        account.getDisplayName(), account.getDataPermission(), roles, permissions.resolve(account));
    try {
      ManagedClientScope.resolve(identity, invite.getClientCode());
    } catch (AccessDeniedException exception) {
      return false;
    }
    String permission = EmployeeService.permissionPrefix(invite.getClientCode()) + ".create";
    return FunctionAudiencePolicy.allows(permission, identity)
        && (identity.isSuperAdmin() || identity.permissions().contains("all")
            || identity.permissions().contains(permission));
  }

  public boolean canLogin(Long accountId, EmployeeInvite invite) {
    return accounts.findAllEnabledByAccountId(accountId).stream()
        .filter(account -> Objects.equals(account.getClientCode(), invite.getClientCode()))
        .filter(account -> sameOrganization(account, invite))
        .anyMatch(account -> switch (account.getIdentityType()) {
          case "platform_admin", "tenant_admin", "store_admin" -> true;
          default -> StringUtils.hasText(account.getDataPermission())
              && !accounts.findAdminRoleCodes(account.getId(), account.getIdentityId()).isEmpty();
        });
  }

  private boolean sameOrganization(AuthAccount account, EmployeeInvite invite) {
    return Objects.equals(account.getTenantId(), invite.getTenantId())
        && Objects.equals(account.getStoreId(), invite.getStoreId());
  }
}
