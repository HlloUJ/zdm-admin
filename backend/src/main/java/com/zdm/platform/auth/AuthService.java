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

    List<String> roles = authAccountMapper.findAdminRoleCodes(account.getId(), account.getIdentityId());
    if (roles.isEmpty()) {
      throw new IllegalArgumentException("账号未开通管理后台权限");
    }

    List<String> permissions = expandPermissionValues(
        authAccountMapper.findAdminPermissionValues(account.getId(), account.getIdentityId()));
    List<String> roleNames = authAccountMapper.findAdminRoleNames(account.getId(), account.getIdentityId());
    var user = new LoginResponse.LoginUser(
        account.getId(),
        account.getDisplayName(),
        account.getPhone(),
        roles,
        roleNames,
        permissions,
        account.getEmployeeId(),
        account.getTenantId(),
        account.getStoreId(),
        account.getDataPermission());
    return new LoginResponse(sessionTokenService.issue(account), user);
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
