package com.zdm.platform.auth;

import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.config.SecurityProperties;
import com.zdm.platform.security.SessionTokenService;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

@Service
public class AuthService {
  private final AuthAccountMapper authAccountMapper;
  private final SessionTokenService sessionTokenService;
  private final SecurityProperties securityProperties;

  public AuthService(
      AuthAccountMapper authAccountMapper,
      SessionTokenService sessionTokenService,
      SecurityProperties securityProperties) {
    this.authAccountMapper = authAccountMapper;
    this.sessionTokenService = sessionTokenService;
    this.securityProperties = securityProperties;
  }

  public LoginResponse login(LoginRequest request) {
    if (!validVerificationCode(request.verifyCode())) {
      throw new IllegalArgumentException("验证码错误");
    }
    AuthAccount account = authAccountMapper.findByPhone(request.phone());
    if (account == null || !"enabled".equals(account.getStatus())) {
      throw new IllegalArgumentException("账号不存在或已停用");
    }

    return responseFor(account);
  }

  public List<IdentityContextResponse> listContexts(Long accountId) {
    return authAccountMapper.findAllEnabledByAccountId(accountId).stream()
        .map(account -> new IdentityContextResponse(
            account.getIdentityId(),
            account.getIdentityType(),
            account.getTenantId(),
            account.getStoreId(),
            account.getTenantName(),
            account.getStoreName(),
            account.getStoreType()))
        .toList();
  }

  public LoginResponse switchIdentity(Long accountId, Long identityId) {
    AuthAccount account = authAccountMapper.findByIdentityId(identityId);
    if (account == null || !accountId.equals(account.getId())) {
      throw new IllegalArgumentException("目标业务身份不存在或已停用");
    }
    return responseFor(account);
  }

  private LoginResponse responseFor(AuthAccount account) {
    List<String> roles = resolveRoles(account);
    if (roles.isEmpty()) {
      throw new IllegalArgumentException("账号未开通管理后台权限");
    }
    List<String> permissions = resolvePermissions(account);
    List<String> roleNames = resolveRoleNames(account);
    var user = new LoginResponse.LoginUser(
        account.getId(),
        account.getIdentityId(),
        account.getIdentityType(),
        account.getDisplayName(),
        account.getPhone(),
        roles,
        roleNames,
        permissions,
        account.getEmployeeId(),
        account.getTenantId(),
        account.getStoreId(),
        account.getTenantName(),
        account.getStoreName(),
        account.getStoreType(),
        account.getDataPermission());
    return new LoginResponse(sessionTokenService.issue(account), user);
  }

  private List<String> resolveRoles(AuthAccount account) {
    return switch (identityType(account)) {
      case "platform_admin" -> List.of("SUPER_ADMIN");
      case "tenant_admin" -> List.of("TENANT_ADMIN");
      case "store_admin" -> List.of("STORE_ADMIN");
      default -> authAccountMapper.findAdminRoleCodes(account.getId(), account.getIdentityId());
    };
  }

  private List<String> resolveRoleNames(AuthAccount account) {
    return switch (identityType(account)) {
      case "platform_admin" -> List.of("平台超级管理员");
      case "tenant_admin" -> List.of("租户管理员");
      case "store_admin" -> List.of("门店管理员");
      default -> authAccountMapper.findAdminRoleNames(account.getId(), account.getIdentityId());
    };
  }

  private List<String> resolvePermissions(AuthAccount account) {
    return switch (identityType(account)) {
      case "platform_admin" -> List.of("all");
      case "tenant_admin" -> List.of();
      case "store_admin" -> {
        String terminalPermissions = authAccountMapper.findTerminalPermissionValue(account.getStoreType());
        yield StringUtils.hasText(terminalPermissions)
            ? expandPermissionValues(List.of(terminalPermissions))
            : List.of();
      }
      default -> expandPermissionValues(
          authAccountMapper.findAdminPermissionValues(account.getId(), account.getIdentityId()));
    };
  }

  private String identityType(AuthAccount account) {
    return StringUtils.hasText(account.getIdentityType()) ? account.getIdentityType() : "employee";
  }

  private List<String> expandPermissionValues(List<String> permissionValues) {
    return FunctionPermissionNormalizer.normalize(permissionValues);
  }

  private boolean validVerificationCode(String candidate) {
    String expected = securityProperties.getVerificationCode();
    return StringUtils.hasText(expected)
        && MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            candidate.getBytes(StandardCharsets.UTF_8));
  }
}
