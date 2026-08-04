package com.zdm.platform.employee;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.HexFormat;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class EmployeeInviteService extends ServiceImpl<EmployeeInviteMapper, EmployeeInvite> {
  private static final String ACTIVE = "active";
  private static final String EXPIRED = "expired";
  private static final String USED = "used";
  private static final String DEV_VERIFY_CODE = "888888";
  private static final Long DEFAULT_TENANT_ID = 1L;
  private static final Long DEFAULT_STORE_ID = 1L;
  private static final SecureRandom RANDOM = new SecureRandom();

  private final EmployeeService employeeService;
  private final CurrentIdentityProvider identityProvider;

  public EmployeeInviteService(EmployeeService employeeService, CurrentIdentityProvider identityProvider) {
    this.employeeService = employeeService;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public EmployeeInviteResponse createInvite() {
    EmployeeInvite invite = new EmployeeInvite();
    invite.setToken(generateToken());
    invite.setTenantId(DEFAULT_TENANT_ID);
    invite.setStoreId(DEFAULT_STORE_ID);
    CurrentIdentity identity = identityProvider.require();
    invite.setCreatedByAccountId(identity.accountId());
    invite.setCreatedByName(identity.displayName());
    invite.setStatus(ACTIVE);
    invite.setExpiresAt(LocalDateTime.now().plusDays(7));
    save(invite);
    return new EmployeeInviteResponse(invite.getToken(), invite.getExpiresAt());
  }

  public EmployeeInviteResponse inspectInvite(String token) {
    EmployeeInvite invite = requireActiveInvite(token);
    return new EmployeeInviteResponse(invite.getToken(), invite.getExpiresAt());
  }

  public Boolean requestCode(String token, RequestInviteCodeRequest request) {
    EmployeeInvite invite = requireActiveInvite(token);
    employeeService.validateInvitedEmployeePhone(invite, request.phone());
    return true;
  }

  public Boolean verifyCode(String token, VerifyInviteCodeRequest request) {
    requireActiveInvite(token);
    requireDevCode(request.verifyCode());
    return true;
  }

  @Transactional
  public EmployeeInviteRegisterResponse register(String token, EmployeeInviteRegisterRequest request) {
    EmployeeInvite invite = requireActiveInvite(token);
    requireDevCode(request.verifyCode());
    EmployeeInviteRegisterResponse response = employeeService.registerInvitedEmployee(invite, request);
    invite.setStatus(USED);
    invite.setUsedAt(LocalDateTime.now());
    updateById(invite);
    return response;
  }

  private EmployeeInvite requireActiveInvite(String token) {
    EmployeeInvite invite = lambdaQuery().eq(EmployeeInvite::getToken, token).one();
    if (invite == null) {
      throw new IllegalArgumentException("邀请链接不存在");
    }
    if (USED.equals(invite.getStatus())) {
      throw new IllegalArgumentException("邀请链接已使用");
    }
    if (!ACTIVE.equals(invite.getStatus()) || invite.getExpiresAt().isBefore(LocalDateTime.now())) {
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
