package com.zdm.platform.security;

import com.zdm.platform.auth.AuthAccount;
import com.zdm.platform.auth.AuthAccountMapper;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;

@Component
public class EffectivePermissionResolver {
  private final AuthAccountMapper authAccountMapper;

  public EffectivePermissionResolver(AuthAccountMapper authAccountMapper) {
    this.authAccountMapper = authAccountMapper;
  }

  public List<String> resolve(AuthAccount account) {
    return switch (identityType(account)) {
      case "platform_admin" -> List.of("all");
      case "tenant_admin" -> List.of();
      case "store_admin" -> terminalPermissions(account);
      default -> employeePermissions(account);
    };
  }

  private List<String> employeePermissions(AuthAccount account) {
    List<String> rolePermissions = FunctionPermissionNormalizer.normalize(
        authAccountMapper.findAdminPermissionValues(account.getId(), account.getIdentityId()));
    if (account.getStoreId() == null) {
      return rolePermissions;
    }
    return intersect(rolePermissions, terminalPermissions(account));
  }

  private List<String> terminalPermissions(AuthAccount account) {
    String value = authAccountMapper.findTerminalPermissionValue(account.getStoreType());
    return StringUtils.hasText(value)
        ? FunctionPermissionNormalizer.normalize(List.of(value))
        : List.of();
  }

  private List<String> intersect(List<String> rolePermissions, List<String> terminalPermissions) {
    if (rolePermissions.contains("all")) {
      return terminalPermissions;
    }
    if (terminalPermissions.contains("all")) {
      return rolePermissions;
    }
    Set<String> terminalSet = new LinkedHashSet<>(terminalPermissions);
    return rolePermissions.stream().filter(terminalSet::contains).distinct().toList();
  }

  private String identityType(AuthAccount account) {
    return StringUtils.hasText(account.getIdentityType()) ? account.getIdentityType() : "employee";
  }
}
