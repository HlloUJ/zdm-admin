package com.zdm.platform.employee;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
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
  private static final String PERMISSION_PREFIX = "admin.permission-management.employee-management";

  private final JdbcTemplate jdbcTemplate;
  private final SimpleJdbcInsert accountInsert;
  private final CurrentIdentityProvider identityProvider;
  private final PermissionGuard permissionGuard;
  private final CreatorOwnershipGuard ownershipGuard;

  public EmployeeService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      PermissionGuard permissionGuard,
      CreatorOwnershipGuard ownershipGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.permissionGuard = permissionGuard;
    this.ownershipGuard = ownershipGuard;
    this.accountInsert = new SimpleJdbcInsert(jdbcTemplate)
        .withTableName("accounts")
        .usingColumns("phone", "display_name", "account_type", "status")
        .usingGeneratedKeyColumns("id");
  }

  public List<Employee> listForCurrentAdmin() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.storeId() == null) {
      return lambdaQuery().isNull(Employee::getTenantId).isNull(Employee::getStoreId).list();
    }
    return lambdaQuery()
        .eq(Employee::getTenantId, identity.tenantId())
        .eq(Employee::getStoreId, identity.storeId())
        .list();
  }

  @Transactional
  public Employee createEmployee(Employee employee) {
    authorizeCreate(employee);
    applyCurrentOrganizationScope(employee);
    Long accountId = findOrCreateAccount(employee.getPhone(), employee.getName());
    employee.setAccountId(accountId);
    employee.setCreatedByName(currentEmployeeName());
    employee.setCreatedByAccountId(ownershipGuard.currentAccountId());
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

    if (payload.getStoreId() != null && !Objects.equals(payload.getStoreId(), existing.getStoreId())) {
      throw new AccessDeniedException("不能将员工转移到其他门店");
    }
    payload.setId(id);
    payload.setAccountId(existing.getAccountId());
    if (!StringUtils.hasText(payload.getPhone())) {
      payload.setPhone(existing.getPhone());
    }
    payload.setTenantId(existing.getTenantId());
    payload.setStoreId(existing.getStoreId());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
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
    employee.setCreatedByAccountId(invite.getCreatedByAccountId());
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

  private void applyCurrentOrganizationScope(Employee employee) {
    CurrentIdentity identity = identityProvider.require();
    if (employee.getStoreId() != null && !Objects.equals(employee.getStoreId(), identity.storeId())) {
      throw new AccessDeniedException("不能为其他门店创建员工");
    }
    if (employee.getTenantId() != null && !Objects.equals(employee.getTenantId(), identity.tenantId())) {
      throw new AccessDeniedException("不能为其他租户创建员工");
    }
    employee.setTenantId(identity.tenantId());
    employee.setStoreId(identity.storeId());
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
    for (Long roleId : parseRoleIds(employee.getRoleIds())) {
      if (employee.getStoreId() != null) {
        throw new AccessDeniedException("门店角色请在对应用户端维护");
      }
      Integer roleCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM roles WHERE id = ?",
          Integer.class,
          roleId);
      if (roleCount == null || roleCount == 0) {
        throw new AccessDeniedException("只能配置运营管理平台角色");
      }
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
          AND tenant_id <=> ?
          AND store_id <=> ?
        """,
        employee.getAccountId(),
        employee.getTenantId(),
        employee.getStoreId());
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
    if (!Objects.equals(employee.getTenantId(), identity.tenantId())
        || !Objects.equals(employee.getStoreId(), identity.storeId())) {
      throw new AccessDeniedException("当前组织无权操作该员工");
    }
    ownershipGuard.requireCreator(employee.getCreatedByAccountId(), employee.getCreatedByName());
  }

  private String currentEmployeeName() {
    return identityProvider.current().map(CurrentIdentity::displayName).orElse(null);
  }
}
