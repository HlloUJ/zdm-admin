package com.zdm.platform.employee;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.ManagedClientScope;
import com.zdm.platform.security.PermissionGuard;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmployeeInviteService extends ServiceImpl<EmployeeInviteMapper, EmployeeInvite> {
  private static final String ACTIVE = "active";
  private static final String EXPIRED = "expired";
  private static final String USED = "used";
  private static final String DEV_VERIFY_CODE = "888888";
  private static final SecureRandom RANDOM = new SecureRandom();

  private final EmployeeService employeeService;
  private final CurrentIdentityProvider identityProvider;

  private final PermissionGuard permissionGuard;
  private final EmployeeInviteAccess inviteAccess;
  private final org.springframework.jdbc.core.JdbcTemplate jdbcTemplate;

  public EmployeeInviteService(EmployeeService employeeService, CurrentIdentityProvider identityProvider, PermissionGuard permissionGuard, EmployeeInviteAccess inviteAccess, org.springframework.jdbc.core.JdbcTemplate jdbcTemplate) {
    this.permissionGuard = permissionGuard;
    this.inviteAccess = inviteAccess;
    this.jdbcTemplate = jdbcTemplate;
    this.employeeService = employeeService;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public EmployeeInviteResponse createInvite(String clientCode) {
    CurrentIdentity identity = identityProvider.require();
    String client = ManagedClientScope.resolve(identity, clientCode);
    permissionGuard.requirePermission(EmployeeService.permissionPrefix(client) + ".create");
    if ((identity.tenantId() == null) != (identity.storeId() == null)) {
      throw new AccessDeniedException("请先切换到具体门店身份");
    }
    EmployeeInvite invite = new EmployeeInvite();
    invite.setToken(generateToken());
    invite.setClientCode(client);
    invite.setTenantId(identity.tenantId());
    invite.setStoreId(identity.storeId());
    invite.setCreatedByAccountId(identity.accountId());
    invite.setCreatedByIdentityId(identity.identityId());
    invite.setCreatedByName(identity.displayName());
    invite.setStatus(ACTIVE);
    LocalDateTime createdAt = LocalDateTime.now().withNano(0);
    invite.setCreatedAt(createdAt);
    invite.setExpiresAt(createdAt.plusMinutes(5));
    save(invite);
    return new EmployeeInviteResponse(invite.getToken(), invite.getExpiresAt(), invite.getClientCode());
  }

  public EmployeeInviteResponse inspectInvite(String token) {
    EmployeeInvite invite = requireActiveInvite(token);
    inviteAccess.requireValidIssuer(invite);
    return new EmployeeInviteResponse(invite.getToken(), invite.getExpiresAt(), invite.getClientCode());
  }

  public Boolean requestCode(String token, RequestInviteCodeRequest request) {
    EmployeeInvite invite = requireActiveInvite(token);
    inviteAccess.requireValidIssuer(invite);
    return true;
  }

  @Transactional
  public EmployeeInviteVerifyResponse verifyCode(String token, VerifyInviteCodeRequest request) {
    EmployeeInvite invite = lockActiveInvite(token);
    requireDevCode(request.verifyCode());
    inviteAccess.requireValidIssuer(invite);
    if (!employeeService.hasAccount(request.phone())) {
      return new EmployeeInviteVerifyResponse(true, null);
    }
    EmployeeInviteRegisterResponse response = employeeService.registerInvitedEmployee(invite,
        new EmployeeInviteRegisterRequest(request.phone(), request.verifyCode(), null, null));
    recordAcceptance(invite, response);
    return new EmployeeInviteVerifyResponse(false, response);
  }

  @Transactional
  public EmployeeInviteRegisterResponse register(String token, EmployeeInviteRegisterRequest request) {
    EmployeeInvite invite = lockActiveInvite(token);
    requireDevCode(request.verifyCode());
    inviteAccess.requireValidIssuer(invite);
    EmployeeInviteRegisterResponse response = employeeService.registerInvitedEmployee(invite, request);
    recordAcceptance(invite, response);
    return response;
  }

  private EmployeeInvite lockActiveInvite(String token) {
    return validateActiveInvite(lambdaQuery().eq(EmployeeInvite::getToken, token).last("FOR UPDATE").one());
  }

  private void recordAcceptance(EmployeeInvite invite, EmployeeInviteRegisterResponse response) {
    // One audit record per person; retries neither overwrite the first result nor extend the link.
    jdbcTemplate.update("""
        INSERT INTO employee_invite_acceptances
          (invite_id, account_id, employee_id, employee_status, existing_employee)
        VALUES (?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE id = id
        """, invite.getId(), invite.getAcceptedAccountId(), response.employeeId(),
        response.status(), response.existingEmployee());
  }

  private EmployeeInvite requireActiveInvite(String token) {
    EmployeeInvite invite = lambdaQuery().eq(EmployeeInvite::getToken, token).one();
    return validateActiveInvite(invite);
  }

  private EmployeeInvite validateActiveInvite(EmployeeInvite invite) {
    if (invite == null) {
      throw new IllegalArgumentException("邀请链接不存在");
    }
    if (USED.equals(invite.getStatus())) {
      throw new IllegalArgumentException("邀请链接已使用");
    }
    if (!ACTIVE.equals(invite.getStatus()) || !invite.getExpiresAt().isAfter(LocalDateTime.now())) {
      if (!EXPIRED.equals(invite.getStatus())) {
        invite.setStatus(EXPIRED);
        updateById(invite);
      }
      throw new IllegalArgumentException("邀请链接已过期");
    }
    return invite;
  }

  private void requireDevCode(String verifyCode) {
    if (!DEV_VERIFY_CODE.equals(verifyCode)) {
      throw new IllegalArgumentException("验证码错误");
    }
  }

  private String generateToken() {
    byte[] bytes = new byte[24];
    RANDOM.nextBytes(bytes);
    return HexFormat.of().formatHex(bytes);
  }
}
