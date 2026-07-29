package com.zdm.platform.employee;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class EmployeeService extends ServiceImpl<EmployeeMapper, Employee> {
  private static final Long DEFAULT_TENANT_ID = 1L;
  private static final Long DEFAULT_STORE_ID = 1L;

  private final JdbcTemplate jdbcTemplate;
  private final SimpleJdbcInsert accountInsert;

  public EmployeeService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
    this.accountInsert = new SimpleJdbcInsert(jdbcTemplate)
        .withTableName("accounts")
        .usingColumns("phone", "display_name", "account_type", "status")
        .usingGeneratedKeyColumns("id");
  }

  public List<Employee> listForCurrentAdmin() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return list();
    }
    Employee currentEmployee = lambdaQuery()
        .eq(Employee::getAccountId, accountId)
        .eq(Employee::getStatus, "enabled")
        .orderByDesc(Employee::getId)
        .last("LIMIT 1")
        .one();
    if (currentEmployee == null) {
      return List.of();
    }
    if ("all".equals(currentEmployee.getDataPermission())) {
      return list();
    }
    if (!StringUtils.hasText(currentEmployee.getName())) {
      return List.of();
    }
    return lambdaQuery().eq(Employee::getCreatedByName, currentEmployee.getName()).list();
  }

  @Transactional
  public Employee createEmployee(Employee employee) {
    normalizeScope(employee);
    Long accountId = findOrCreateAccount(employee.getPhone(), employee.getName());
    employee.setAccountId(accountId);
    if (!StringUtils.hasText(employee.getCreatedByName())) {
      employee.setCreatedByName(currentEmployeeName());
    }
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
  public boolean deleteEmployee(Long id) {
    Employee existing = getById(id);
    if (existing == null) {
      return false;
    }
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
    Employee duplicate = lambdaQuery()
        .eq(Employee::getAccountId, accountId)
        .eq(Employee::getTenantId, invite.getTenantId())
        .eq(Employee::getStoreId, invite.getStoreId())
        .one();
    if (duplicate != null) {
      throw new IllegalArgumentException(
          "enabled".equals(duplicate.getStatus())
              ? "该手机号已是当前组织员工"
              : "该手机号已提交员工注册，请等待超级管理员审核");
    }

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
    List<Long> ids = jdbcTemplate.query(
        "SELECT id FROM accounts WHERE phone = ? LIMIT 1",
        (rs, rowNum) -> rs.getLong("id"),
        phone);
    if (!ids.isEmpty()) {
      return ids.get(0);
    }

    Map<String, Object> values = new HashMap<>();
    values.put("phone", phone);
    values.put("display_name", displayName);
    values.put("account_type", "person");
    values.put("status", "enabled");
    return accountInsert.executeAndReturnKey(values).longValue();
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

  private Long currentAccountId() {
    Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
    if (authentication == null || authentication.getPrincipal() == null) {
      return null;
    }
    String principal = String.valueOf(authentication.getPrincipal());
    if (!principal.startsWith("account:")) {
      return null;
    }
    try {
      return Long.parseLong(principal.substring("account:".length()));
    } catch (NumberFormatException ex) {
      return null;
    }
  }

  private String currentEmployeeName() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return null;
    }
    return lambdaQuery()
        .eq(Employee::getAccountId, accountId)
        .eq(Employee::getStatus, "enabled")
        .orderByDesc(Employee::getId)
        .last("LIMIT 1")
        .list()
        .stream()
        .map(Employee::getName)
        .filter(StringUtils::hasText)
        .findFirst()
        .orElse(null);
  }
}
