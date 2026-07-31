package com.zdm.platform.auth;

import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.TokenAuthenticationFilter;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
  private final AuthAccountMapper authAccountMapper;

  public AuthService(AuthAccountMapper authAccountMapper) {
    this.authAccountMapper = authAccountMapper;
  }

  public LoginResponse login(LoginRequest request) {
    if (!"888888".equals(request.verifyCode())) {
      throw new IllegalArgumentException("验证码错误");
    }
    AuthAccount account = authAccountMapper.findByPhone(request.phone());
    if (account == null || !"enabled".equals(account.getStatus())) {
      throw new IllegalArgumentException("账号不存在或已停用");
    }

    List<String> roles = authAccountMapper.findAdminRoleCodes(account.getId());
    if (roles.isEmpty()) {
      throw new IllegalArgumentException("账号未开通管理后台权限");
    }

    List<String> permissions = expandPermissionValues(authAccountMapper.findAdminPermissionValues(account.getId()));
    List<String> roleNames = authAccountMapper.findAdminRoleNames(account.getId());
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
    return new LoginResponse(TokenAuthenticationFilter.createAccountToken(account.getId()), user);
  }

  private List<String> expandPermissionValues(List<String> permissionValues) {
    return FunctionPermissionNormalizer.normalize(permissionValues);
  }
}
