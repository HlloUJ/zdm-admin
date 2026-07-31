package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.employee.Employee;
import com.zdm.platform.employee.EmployeeService;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class RoleService extends ServiceImpl<RoleMapper, Role> {
  private static final String SUPER_ADMIN_CODE = "SUPER_ADMIN";
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private record AffectedEmployee(Long id, Long accountId, Long tenantId, Long storeId) {}

  private final EmployeeService employeeService;
  private final JdbcTemplate jdbcTemplate;

  public RoleService(EmployeeService employeeService, JdbcTemplate jdbcTemplate) {
    this.employeeService = employeeService;
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<Role> listForCurrentAdmin() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return list();
    }
    Employee currentEmployee = employeeService.lambdaQuery()
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
    return lambdaQuery().eq(Role::getCreatedByName, currentEmployee.getName()).list();
  }

  @Transactional
  public boolean createRole(Role role) {
    role.setId(null);
    normalizeAndValidateRoleName(role, null);
    role.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(role.getFunctionPermissions()));
    role.setCreatedByName(resolveCreatedByName());
    return save(role);
  }

  @Transactional
  public boolean updateRole(Long id, Role payload) {
    Role existing = getById(id);
    if (existing == null) {
      return false;
    }

    payload.setId(id);
    payload.setCode(existing.getCode());
    payload.setCategory(existing.getCategory());
    payload.setClientCode(existing.getClientCode());
    payload.setCreatedByName(existing.getCreatedByName());
    if (isSuperAdminRole(existing)) {
      payload.setCode(SUPER_ADMIN_CODE);
      payload.setDataScope("all");
      payload.setStatus("enabled");
      payload.setFunctionPermissions("all");
    } else {
      payload.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(payload.getFunctionPermissions()));
    }
    normalizeAndValidateRoleName(payload, id);
    return updateById(payload);
  }

  @Transactional
  public boolean deleteRole(Long id) {
    Role existing = getById(id);
    if (existing == null) {
      return false;
    }
    if (isSuperAdminRole(existing)) {
      throw new IllegalArgumentException("超级管理员角色不可删除");
    }
    clearAffectedEmployeeRolesAndDisableIdentity(id);
    removeRoleAssociations(id);
    return removeById(id);
  }

  private boolean isSuperAdminRole(Role role) {
    return SUPER_ADMIN_CODE.equals(role.getCode());
  }

  private void normalizeAndValidateRoleName(Role role, Long excludedRoleId) {
    if (!StringUtils.hasText(role.getCategory())) {
      throw new IllegalArgumentException("角色所属用户端不能为空");
    }

    String roleName = role.getName().trim();
    role.setName(roleName);
    var duplicateQuery = lambdaQuery()
        .eq(Role::getCategory, role.getCategory())
        .eq(Role::getName, roleName);
    if (excludedRoleId != null) {
      duplicateQuery.ne(Role::getId, excludedRoleId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException("当前用户端已存在同名角色");
    }
  }

  private void clearAffectedEmployeeRolesAndDisableIdentity(Long roleId) {
    List<AffectedEmployee> affectedEmployees = jdbcTemplate.query(
        """
        SELECT DISTINCT e.id, e.account_id, e.tenant_id, e.store_id
        FROM employees e
        WHERE FIND_IN_SET(?, e.role_ids)
           OR EXISTS (
             SELECT 1
             FROM account_roles ar
             WHERE ar.role_id = ?
               AND ar.account_id = e.account_id
               AND ar.client_code = 'admin'
               AND ar.tenant_id <=> e.tenant_id
               AND ar.store_id <=> e.store_id
           )
        """,
        (rs, rowNum) -> new AffectedEmployee(
            rs.getLong("id"),
            rs.getObject("account_id", Long.class),
            rs.getObject("tenant_id", Long.class),
            rs.getObject("store_id", Long.class)),
        roleId,
        roleId);

    for (AffectedEmployee employee : affectedEmployees) {
      jdbcTemplate.update(
          "UPDATE employees SET role_ids = NULL, status = 'disabled' WHERE id = ?",
          employee.id());
      if (employee.accountId() == null) {
        continue;
      }
      jdbcTemplate.update(
          """
          UPDATE account_identities
          SET status = 'disabled'
          WHERE account_id = ?
            AND client_code = 'admin'
            AND identity_type = 'employee'
            AND subject_id = ?
          """,
          employee.accountId(),
          employee.id());
      jdbcTemplate.update(
          """
          DELETE FROM account_roles
          WHERE account_id = ?
            AND client_code = 'admin'
            AND tenant_id <=> ?
            AND store_id <=> ?
          """,
          employee.accountId(),
          employee.tenantId(),
          employee.storeId());
    }
  }

  private void removeRoleAssociations(Long roleId) {
    jdbcTemplate.update("DELETE FROM role_permissions WHERE role_id = ?", roleId);
    jdbcTemplate.update("DELETE FROM account_roles WHERE role_id = ?", roleId);
  }

  private String resolveCreatedByName() {
    Long accountId = currentAccountId();
    if (accountId == null) {
      return DEFAULT_CREATED_BY_NAME;
    }
    return employeeService.lambdaQuery()
        .eq(Employee::getAccountId, accountId)
        .eq(Employee::getStatus, "enabled")
        .orderByDesc(Employee::getId)
        .last("LIMIT 1")
        .list()
        .stream()
        .map(Employee::getName)
        .filter(StringUtils::hasText)
        .findFirst()
        .orElse(DEFAULT_CREATED_BY_NAME);
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
}
