package com.zdm.platform.employee;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class EmployeeService extends ServiceImpl<EmployeeMapper, Employee> {
  private static final Long DEFAULT_TENANT_ID = 1L;
  private static final Long DEFAULT_STORE_ID = 1L;
  private static final String PERMISSION_PREFIX = "admin.permission-management.employee-management";

  private final JdbcTemplate jdbcTemplate;
  private final SimpleJdbcInsert accountInsert;
  private final CurrentIdentityProvider identityProvider;
  private final PermissionGuard permissionGuard;

  public EmployeeService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      PermissionGuard permissionGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.permissionGuard = permissionGuard;
    this.accountInsert = new SimpleJdbcInsert(jdbcTemplate)
        .withTableName("accounts")
        .usingColumns("phone", "display_name", "account_type", "status")
        .usingGeneratedKeyColumns("id");
  }

  public List<Employee> listForCurrentAdmin() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.isSuperAdmin() || "all".equals(identity.dataPermission())) {
      return list();
    }
    if (!StringUtils.hasText(identity.displayName())) {
      return List.of();
    }
    return lambdaQuery().eq(Employee::getCreatedByName, identity.displayName()).list();
  }

  @Transactional
  public Employee createEmployee(Employee employee) {
    authorizeCreate(employee);
    normalizeScope(employee);
    Long accountId = findOrCreateAccount(employee.getPhone(), employee.getName());
    employee.setAccountId(accountId);
    employee.setCreatedByName(currentEmployeeName());
    validateBeforeEnabled(employee);
    save(employee);
    syncAdminIdentity(employee);
    syncAdminRoles(employee);
    return employee;
  }

  @Transactional
  public Employee updateEmployee(Long id, Employee payload) {
    Employee existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("员工不存在");
    }
    requireAccessibleEmployee(existing);

    payload.setId(id);
    payload.setAccountId(existing.getAccountId());
    if (!StringUtils.hasText(payload.getPhone())) {
      payload.setPhone(existing.getPhone());
    }
    if (payload.getTenantId() == null) {
      payload.setTenantId(existing.getTenantId());
    }
    if (payload.getStoreId() == null) {
      payload.setStoreId(existing.getStoreId());
    }
    if (!StringUtils.hasText(payload.getCreatedByName())) {
      payload.setCreatedByName(existing.getCreatedByName());
    }
    normalizeScope(payload);
    authorizeUpdate(existing, payload);

    if (payload.getAccountId() == null) {
      payload.setAccountId(findOrCreateAccount(payload.getPhone(), payload.getName()));
    }

    validateBeforeEnabled(payload);
    updateById(payload);
    syncAdminIdentity(payload);
    syncAdminRoles(payload);
    updateAccountDisplayName(payload);
    return getById(id);
  }

  @Transactional
  public Employee updatePermissions(Long id, EmployeePermissionUpdateRequest request) {
    Employee existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("员工不存在");
    }
    requireAccessibleEmployee(existing);
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".permission");

    existing.setRoleIds(request.roleIds());
    existing.setDataPermission(request.dataPermission());
    validateBeforeEnabled(existing);
    updateById(existing);
    syncAdminRoles(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteEmployee(Long id) {
    Employee existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireAccessibleEmployee(existing);
    removeAdminRoles(existing);
    jdbcTemplate.update(
        """
        UPDATE account_identities
        SET status = 'disabled'
        WHERE account_id = ?
          AND client_code = 'admin'
          AND identity_type = 'employee'
          AND subject_id = ?
        """,
        existing.getAccountId(),
        existing.getId());
    return removeById(id);
  }

  @Transactional
  public EmployeeInviteRegisterResponse registerInvitedEmployee(
      EmployeeInvite invite,
      EmployeeInviteRegisterRequest request) {
    Long accountId = findOrCreateAccount(request.phone(), request.name().trim());
    requireNoExistingEmployee(invite, accountId);

    Employee employee = new Employee();
    employee.setAccountId(accountId);
    employee.setTenantId(invite.getTenantId());
    employee.setStoreId(invite.getStoreId());
    employee.setName(request.name().trim());
    employee.setGender(request.gender());
    employee.setPhone(request.phone());
    employee.setStatus("disabled");
    employee.setCreatedByName(invite.getCreatedByName());
    save(employee);
    syncAdminIdentity(employee);
    return new EmployeeInviteRegisterResponse(employee.getId(), employee.getStatus());
  }

  public void validateInvitedEmployeePhone(EmployeeInvite invite, String phone) {
    findAccountId(phone).ifPresent(accountId -> requireNoExistingEmployee(invite, accountId));
  }

  private void requireNoExistingEmployee(EmployeeInvite invite, Long accountId) {
    Employee duplicate = lambdaQuery()
        .eq(Employee::getAccountId, accountId)
        .eq(Employee::getTenantId, invite.getTenantId())
        .eq(Employee::getStoreId, invite.getStoreId())
        .last("LIMIT 1")
        .one();
    if (duplicate != null) {
      throw new IllegalArgumentException(
          "enabled".equals(duplicate.getStatus())
              ? "该手机号已是当前组织员工"
              : "该手机号已提交员工注册，请等待超级管理员审核");
    }
  }

  private void normalizeScope(Employee employee) {
    if (employee.getTenantId() == null) {
      employee.setTenantId(DEFAULT_TENANT_ID);
    }
    if (employee.getStoreId() == null) {
      employee.setStoreId(DEFAULT_STORE_ID);
    }
  }

  private void validateBeforeEnabled(Employee employee) {
    if (!"enabled".equals(employee.getStatus())) {
      return;
    }
    if (!StringUtils.hasText(employee.getRoleIds())) {
      throw new IllegalArgumentException("请先为员工配置角色后再启用");
    }
    if (!StringUtils.hasText(employee.getDataPermission())) {
      throw new IllegalArgumentException("请先为员工配置数据权限后再启用");
    }
  }

  private Long findOrCreateAccount(String phone, String displayName) {
    Optional<Long> existingAccountId = findAccountId(phone);
    if (existingAccountId.isPresent()) {
      return existingAccountId.get();
    }

    Map<String, Object> values = new HashMap<>();
    values.put("phone", phone);
    values.put("display_name", displayName);
    values.put("account_type", "person");
    values.put("status", "enabled");
    return accountInsert.executeAndReturnKey(values).longValue();
  }

  private Optional<Long> findAccountId(String phone) {
    List<Long> ids = jdbcTemplate.query(
        "SELECT id FROM accounts WHERE phone = ? LIMIT 1",
        (rs, rowNum) -> rs.getLong("id"),
        phone);
    return ids.stream().findFirst();
  }

  private void updateAccountDisplayName(Employee employee) {
    jdbcTemplate.update(
        "UPDATE accounts SET display_name = ? WHERE id = ?",
        employee.getName(),
        employee.getAccountId());
  }

  private void syncAdminIdentity(Employee employee) {
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          tenant_id = VALUES(tenant_id),
          store_id = VALUES(store_id),
          status = VALUES(status)
        """,
        employee.getAccountId(),
        employee.getId(),
        employee.getTenantId(),
        employee.getStoreId(),
        employee.getStatus());
  }

  private void syncAdminRoles(Employee employee) {
    removeAdminRoles(employee);
    if (!"enabled".equals(employee.getStatus())) {
      return;
    }
    for (Long roleId : parseRoleIds(employee.getRoleIds())) {
      jdbcTemplate.update(
          """
          INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
          VALUES (?, ?, 'admin', ?, ?)
          """,
          employee.getAccountId(),
          roleId,
          employee.getTenantId(),
          employee.getStoreId());
    }
  }

  private void removeAdminRoles(Employee employee) {
    if (employee.getAccountId() == null) {
      return;
    }
    jdbcTemplate.update(
        """
        DELETE FROM account_roles
        WHERE account_id = ?
          AND client_code = 'admin'
          AND tenant_id = ?
          AND store_id = ?
        """,
        employee.getAccountId(),
        Objects.requireNonNullElse(employee.getTenantId(), DEFAULT_TENANT_ID),
        Objects.requireNonNullElse(employee.getStoreId(), DEFAULT_STORE_ID));
  }

  private List<Long> parseRoleIds(String value) {
    return Arrays.stream(value.split(","))
        .map(String::trim)
        .filter(StringUtils::hasText)
        .map(roleId -> {
          try {
            return Long.parseLong(roleId);
          } catch (NumberFormatException ex) {
            throw new IllegalArgumentException("角色数据格式错误");
          }
        })
        .toList();
  }

  private void authorizeCreate(Employee employee) {
    if (StringUtils.hasText(employee.getRoleIds())
        || StringUtils.hasText(employee.getDataPermission())) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".permission");
    }
    if ("enabled".equals(employee.getStatus())) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    }
  }

  private void authorizeUpdate(Employee existing, Employee payload) {
    boolean profileChanged = !Objects.equals(existing.getTenantId(), payload.getTenantId())
        || !Objects.equals(existing.getStoreId(), payload.getStoreId())
        || !Objects.equals(existing.getName(), payload.getName())
        || !Objects.equals(existing.getGender(), payload.getGender())
        || !Objects.equals(existing.getPhone(), payload.getPhone())
        || !Objects.equals(existing.getRemark(), payload.getRemark());
    boolean permissionChanged = !Objects.equals(existing.getRoleIds(), payload.getRoleIds())
        || !Objects.equals(existing.getDataPermission(), payload.getDataPermission());
    boolean statusChanged = !Objects.equals(existing.getStatus(), payload.getStatus());

    if (profileChanged || (!permissionChanged && !statusChanged)) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".edit");
    }
    if (permissionChanged) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".permission");
    }
    if (statusChanged) {
      permissionGuard.requirePermission(PERMISSION_PREFIX + ".toggle-status");
    }
  }

  private void requireAccessibleEmployee(Employee employee) {
    CurrentIdentity identity = identityProvider.require();
    if (!identity.isSuperAdmin()
        && !"all".equals(identity.dataPermission())
        && !Objects.equals(employee.getCreatedByName(), identity.displayName())) {
      throw new AccessDeniedException("当前数据权限不允许操作该员工");
    }
  }

  private String currentEmployeeName() {
    return identityProvider.current().map(CurrentIdentity::displayName).orElse(null);
  }
}
