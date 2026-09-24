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
    if ("supply-chain".equals(account.getClientCode())) {
      return intersect(FunctionAudiencePolicy.filter(rolePermissions, "supply-chain"), terminalPermissions(account));
    }
    if (account.getStoreId() == null) {
      return FunctionAudiencePolicy.filter(rolePermissions, "admin");
    }
    return intersect(rolePermissions, terminalPermissions(account));
  }

  private List<String> terminalPermissions(AuthAccount account) {
    if ("supply-chain".equals(account.getClientCode())) {
      String value = authAccountMapper.findTerminalPermissionValue("supply-chain");
      return FunctionAudiencePolicy.filter(FunctionPermissionNormalizer.normalize(
          List.of(value == null ? "" : value)), "supply-chain");
    }
    if (account.getStoreType() == null
        || !List.of("cityPartner", "slabSupplier", "finishedSupplier").contains(account.getStoreType())) {
      return List.of();
    }
    String value = authAccountMapper.findTerminalPermissionValue(account.getStoreType());
    String audience = "cityPartner".equals(account.getStoreType()) ? "store" : "supplier";
    return StringUtils.hasText(value)
        ? FunctionAudiencePolicy.filter(FunctionPermissionNormalizer.normalize(List.of(value)), audience)
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
