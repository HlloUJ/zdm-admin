package com.zdm.platform.auth;

import com.zdm.platform.config.SecurityProperties;
import com.zdm.platform.security.EffectivePermissionResolver;
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
  private final EffectivePermissionResolver effectivePermissionResolver;

  public AuthService(
      AuthAccountMapper authAccountMapper,
      SessionTokenService sessionTokenService,
      SecurityProperties securityProperties,
      EffectivePermissionResolver effectivePermissionResolver) {
    this.authAccountMapper = authAccountMapper;
    this.sessionTokenService = sessionTokenService;
    this.securityProperties = securityProperties;
    this.effectivePermissionResolver = effectivePermissionResolver;
  }

  public LoginResponse login(LoginRequest request) {
    if (!validVerificationCode(request.verifyCode())) {
      throw new IllegalArgumentException("验证码错误");
    }
    AuthAccount account = authAccountMapper.findByPhone(request.phone());
    if (account == null || !"enabled".equals(account.getStatus())) {
      if (authAccountMapper.countDisabledTenantIdentitiesByPhone(request.phone()) > 0) {
        throw new IllegalArgumentException("所属租户已归档，请联系平台运营");
      }
      if (authAccountMapper.countArchivedStoreIdentitiesByPhone(request.phone()) > 0) {
        throw new IllegalArgumentException("该门店已停止运营");
      }
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
      if (authAccountMapper.countDisabledTenantIdentity(accountId, identityId) > 0) {
        throw new IllegalArgumentException("所属租户已归档，请联系平台运营");
      }
      if (authAccountMapper.countArchivedStoreIdentity(accountId, identityId) > 0) {
        throw new IllegalArgumentException("该门店已停止运营");
      }
      throw new IllegalArgumentException("目标业务身份不存在或已停用");
    }
    return responseFor(account);
  }

  private LoginResponse responseFor(AuthAccount account) {
    List<String> roles = resolveRoles(account);
    if (roles.isEmpty()) {
      throw new IllegalArgumentException("账号未开通管理后台权限");
    }
    List<String> permissions = effectivePermissionResolver.resolve(account);
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

  private String identityType(AuthAccount account) {
    return StringUtils.hasText(account.getIdentityType()) ? account.getIdentityType() : "employee";
  }

  private boolean validVerificationCode(String candidate) {
    String expected = securityProperties.getVerificationCode();
    return StringUtils.hasText(expected)
        && MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            candidate.getBytes(StandardCharsets.UTF_8));
  }
}
