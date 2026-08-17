package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class RoleService extends ServiceImpl<RoleMapper, Role> {
  private static final String SUPER_ADMIN_CODE = "SUPER_ADMIN";
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String ROLE_PERMISSION_PREFIX = "admin.permission-management.role-management";
  private static final String EMPLOYEE_ASSIGN_PERMISSION =
      "admin.permission-management.employee-management.permission";

  private record AffectedEmployee(Long id, Long accountId, Long tenantId, Long storeId) {}

  private final JdbcTemplate jdbcTemplate;
  private final CurrentIdentityProvider identityProvider;
  private final PermissionGuard permissionGuard;
  private final CreatorOwnershipGuard ownershipGuard;

  public RoleService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      PermissionGuard permissionGuard,
      CreatorOwnershipGuard ownershipGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.permissionGuard = permissionGuard;
    this.ownershipGuard = ownershipGuard;
  }

  public List<Role> listForCurrentAdmin() {
    CurrentIdentity identity = identityProvider.require();
    boolean canAssignEmployeeRole = permissionGuard.hasPermission(EMPLOYEE_ASSIGN_PERMISSION);
    boolean canViewLegacyRolePage = permissionGuard.hasPermission(ROLE_PERMISSION_PREFIX + ".view");
    boolean canViewAnyRoleCategory = canViewLegacyRolePage
        || List.of("operation-platform", "partner-store", "supplier-store")
        .stream()
        .anyMatch(category -> permissionGuard.hasView(rolePermissionPrefix(category)));
    if (!identity.isSuperAdmin() && !canAssignEmployeeRole && !canViewAnyRoleCategory) {
      throw new AccessDeniedException("无权访问角色数据");
    }

    return list().stream()
        .filter(role -> visibleRole(role, identity, canAssignEmployeeRole, canViewLegacyRolePage))
        .toList();
  }

  @Transactional
  public boolean createRole(Role role) {
    requireCategory(role.getCategory());
    requireRoleAction(role.getCategory(), "create");
    role.setId(null);
    role.setStoreId("terminal-policy".equals(role.getCategory()) ? null : requireStoreId());
    normalizeAndValidateRoleName(role, null);
    role.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(role.getFunctionPermissions()));
    role.setCreatedByName(resolveCreatedByName());
    role.setCreatedByAccountId(ownershipGuard.currentAccountId());
    return save(role);
  }

  @Transactional
  public boolean updateRole(Long id, Role payload) {
    Role existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireAccessibleRole(existing);
    authorizeUpdate(existing, payload);

    payload.setId(id);
    payload.setCode(existing.getCode());
    payload.setCategory(existing.getCategory());
    payload.setClientCode(existing.getClientCode());
    payload.setStoreId(existing.getStoreId());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
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
    requireAccessibleRole(existing);
    requireRoleAction(existing.getCategory(), "delete");
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

  private boolean visibleRole(
      Role role,
      CurrentIdentity identity,
      boolean canAssignEmployeeRole,
      boolean canViewLegacyRolePage) {
    if ("terminal-policy".equals(role.getCategory())) {
      return identity.isSuperAdmin();
    }
    return canAssignEmployeeRole
        || canViewLegacyRolePage
        || permissionGuard.hasView(rolePermissionPrefix(role.getCategory()));
  }

  private void authorizeUpdate(Role existing, Role payload) {
    if ("terminal-policy".equals(existing.getCategory())) {
      permissionGuard.requireSuperAdmin();
      return;
    }

    boolean profileChanged = !Objects.equals(existing.getName(), payload.getName())
        || !Objects.equals(existing.getDataScope(), payload.getDataScope())
        || !Objects.equals(existing.getStatus(), payload.getStatus())
        || !Objects.equals(existing.getRemark(), payload.getRemark());
    boolean permissionChanged = !Objects.equals(
        FunctionPermissionNormalizer.normalizeCsv(existing.getFunctionPermissions()),
        FunctionPermissionNormalizer.normalizeCsv(payload.getFunctionPermissions()));

    if (profileChanged || !permissionChanged) {
      requireRoleAction(existing.getCategory(), "edit");
    }
    if (permissionChanged) {
      requireRoleAction(existing.getCategory(), "permission");
    }
  }

  private void requireRoleAction(String category, String action) {
    if ("terminal-policy".equals(category)) {
      permissionGuard.requireSuperAdmin();
      return;
    }
    permissionGuard.requireAnyPermission(
        rolePermissionPrefix(category) + "." + action,
        ROLE_PERMISSION_PREFIX + "." + action);
  }

  private String rolePermissionPrefix(String category) {
    return ROLE_PERMISSION_PREFIX + "." + category;
  }

  private void requireAccessibleRole(Role role) {
    ownershipGuard.requireCreator(role.getCreatedByAccountId(), role.getCreatedByName());
    if ("terminal-policy".equals(role.getCategory())) {
      permissionGuard.requireSuperAdmin();
    }
  }

  private void normalizeAndValidateRoleName(Role role, Long excludedRoleId) {
    requireCategory(role.getCategory());

    String roleName = role.getName().trim();
    role.setName(roleName);
    var duplicateQuery = lambdaQuery();
    if (role.getStoreId() == null) {
      duplicateQuery.isNull(Role::getStoreId);
    } else {
      duplicateQuery.eq(Role::getStoreId, role.getStoreId());
    }
    duplicateQuery.eq(Role::getCategory, role.getCategory()).eq(Role::getName, roleName);
    if (excludedRoleId != null) {
      duplicateQuery.ne(Role::getId, excludedRoleId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException("当前用户端已存在同名角色");
    }
  }

  private void requireCategory(String category) {
    if (!StringUtils.hasText(category)) {
      throw new IllegalArgumentException("角色所属用户端不能为空");
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
    return identityProvider.current()
        .map(CurrentIdentity::displayName)
        .filter(StringUtils::hasText)
        .orElse(DEFAULT_CREATED_BY_NAME);
  }

  private Long requireStoreId() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.storeId() == null) {
      throw new AccessDeniedException("当前身份未关联门店");
    }
    return identity.storeId();
  }
}
