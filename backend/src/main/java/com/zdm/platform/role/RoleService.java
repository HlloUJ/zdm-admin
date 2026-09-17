package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.PermissionGuard;
import com.zdm.platform.security.FunctionAudiencePolicy;
import java.util.HashSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
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

  private record AffectedEmployee(Long id, Long accountId, Long tenantId, Long storeId, String clientCode) {}
  private record RoleScope(Long tenantId, Long storeId, String audience, String clientCode) {}

  private final JdbcTemplate jdbcTemplate;
  private final CurrentIdentityProvider identityProvider;
  private final PermissionGuard permissionGuard;

  public RoleService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      PermissionGuard permissionGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.permissionGuard = permissionGuard;
  }

  public List<Role> listForCurrentAdmin() { return listForCurrentAdmin(null); }

  public List<Role> listForCurrentAdmin(String clientCode) {
    RoleScope scope = requireCurrentScope(clientCode);
    boolean canAssignEmployeeRole = permissionGuard.hasPermission(managedPrefix("admin.permission-management.employee-management", scope.clientCode()) + ".permission");
    boolean canViewRolePage = permissionGuard.hasPermission(managedPrefix(ROLE_PERMISSION_PREFIX, scope.clientCode()) + ".view");
    if (!identityProvider.require().isSuperAdmin() && !canAssignEmployeeRole && !canViewRolePage) {
      throw new AccessDeniedException("无权访问当前组织角色数据");
    }

    var query = lambdaQuery().eq(Role::getClientCode, scope.clientCode());
    if (scope.storeId() == null) {
      query.isNull(Role::getTenantId).isNull(Role::getStoreId);
    } else {
      query.eq(Role::getTenantId, scope.tenantId()).eq(Role::getStoreId, scope.storeId());
    }
    query.eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), Role::getCreatedByAccountId,
        identityProvider.require().accountId());
    return query
        .orderByDesc(Role::getCreatedAt)
        .list();
  }

  public RolePermissionScope permissionScopeForCurrentAdmin() { return permissionScopeForCurrentAdmin(null); }

  public RolePermissionScope permissionScopeForCurrentAdmin(String clientCode) {
    RoleScope scope = requireCurrentScope(clientCode);
    boolean canAssignEmployeeRole = permissionGuard.hasPermission(managedPrefix("admin.permission-management.employee-management", scope.clientCode()) + ".permission");
    boolean canManageRolePermission = permissionGuard.hasPermission(managedPrefix(ROLE_PERMISSION_PREFIX, scope.clientCode()) + ".permission");
    if (!identityProvider.require().isSuperAdmin() && !canAssignEmployeeRole && !canManageRolePermission) {
      throw new AccessDeniedException("无权读取当前组织可分配权限");
    }
    return new RolePermissionScope(scope.audience(), availableFunctionPermissions(scope));
  }

  @Transactional
  public boolean createRole(Role role) {
    RoleScope scope = requireCurrentScope(role.getClientCode());
    requireRoleAction("create",scope.clientCode());
    role.setClientCode(scope.clientCode());
    role.setId(null);
    role.setTenantId(scope.tenantId());
    role.setStoreId(scope.storeId());
    role.setDataScope("all");
    normalizeAndValidateRoleName(role, null);
    role.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(role.getFunctionPermissions()));
    requireAllowedRolePermissions(role, scope);
    if (SUPER_ADMIN_CODE.equals(role.getCode())) {
      throw new IllegalArgumentException("超级管理员是系统内置角色");
    }
    role.setCreatedByName(resolveCreatedByName());
    role.setCreatedByAccountId(identityProvider.require().accountId());
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

    payload.setClientCode(existing.getClientCode());
    payload.setId(id);
    payload.setCode(existing.getCode());
    payload.setTenantId(existing.getTenantId());
    payload.setStoreId(existing.getStoreId());
    payload.setDataScope("all");
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    if (isSuperAdminRole(existing)) {
      payload.setCode(SUPER_ADMIN_CODE);
      payload.setDataScope("all");
      payload.setStatus("enabled");
      payload.setFunctionPermissions("all");
    } else {
      payload.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(payload.getFunctionPermissions()));
      requireAllowedRolePermissions(payload, requireCurrentScope(existing.getClientCode()));
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
    requireRoleAction("delete",existing.getClientCode());
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

  private void authorizeUpdate(Role existing, Role payload) {
    boolean profileChanged = !Objects.equals(existing.getName(), payload.getName())
        || !Objects.equals(existing.getRemark(), payload.getRemark());
    boolean permissionChanged = !Objects.equals(
        FunctionPermissionNormalizer.normalizeCsv(existing.getFunctionPermissions()),
        FunctionPermissionNormalizer.normalizeCsv(payload.getFunctionPermissions()));

    if (profileChanged || !permissionChanged) {
      requireRoleAction("edit",existing.getClientCode());
    }
    if (permissionChanged) {
      requireRoleAction("permission",existing.getClientCode());
    }
  }

  private static String managedPrefix(String prefix, String client) {
    return prefix + ("supply-chain".equals(client) ? ".supply-chain" : "");
  }
  private void requireRoleAction(String action, String client) {
    permissionGuard.requirePermission(managedPrefix(ROLE_PERMISSION_PREFIX,client) + "." + action);
  }

  private void requireAccessibleRole(Role role) {
    com.zdm.platform.security.DataScope.requireAccess(identityProvider.require(), role.getCreatedByAccountId());
    RoleScope scope = requireCurrentScope(role.getClientCode());
    if (!Objects.equals(role.getTenantId(), scope.tenantId())
        || !Objects.equals(role.getStoreId(), scope.storeId())) {
      throw new AccessDeniedException("当前组织无权操作该角色");
    }
  }

  private void normalizeAndValidateRoleName(Role role, Long excludedRoleId) {
    String roleName = role.getName().trim();
    role.setName(roleName);
    var duplicateQuery = lambdaQuery()
        .eq(Role::getName, roleName)
        .eq(Role::getClientCode, role.getClientCode())
        .eq(role.getTenantId() != null, Role::getTenantId, role.getTenantId())
        .isNull(role.getTenantId() == null, Role::getTenantId)
        .eq(role.getStoreId() != null, Role::getStoreId, role.getStoreId())
        .isNull(role.getStoreId() == null, Role::getStoreId);
    if (excludedRoleId != null) {
      duplicateQuery.ne(Role::getId, excludedRoleId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException("当前组织已存在同名角色");
    }
  }

  private RoleScope requireCurrentScope(String clientCode) {
    CurrentIdentity identity = identityProvider.require();
    String client = com.zdm.platform.security.ManagedClientScope.resolve(identity, clientCode);
    if (identity.tenantId() == null && identity.storeId() == null) {
      return new RoleScope(null, null, client, client);
    }
    if (identity.tenantId() == null || identity.storeId() == null) {
      throw new AccessDeniedException("请先切换到具体门店身份");
    }
    String storeType = jdbcTemplate.queryForObject(
        "SELECT type FROM stores WHERE id = ? AND tenant_id = ?",
        String.class,
        identity.storeId(),
        identity.tenantId());
    if ("cityPartner".equals(storeType)) {
      return new RoleScope(identity.tenantId(), identity.storeId(), "store", client);
    }
    if ("slabSupplier".equals(storeType) || "finishedSupplier".equals(storeType)) {
      return new RoleScope(identity.tenantId(), identity.storeId(), "supplier", client);
    }
    throw new AccessDeniedException("当前用户端尚未开通角色维护");
  }

  private String availableFunctionPermissions(RoleScope scope) {
    if (scope.storeId() == null && "admin".equals(scope.clientCode())) {
      return "all";
    }
    String value = jdbcTemplate.queryForObject(
        "SELECT function_permissions FROM terminal_function_policies WHERE terminal = ?",
        String.class,
        scope.audience());
    return String.join(",", FunctionAudiencePolicy.filter(
        FunctionPermissionNormalizer.normalize(List.of(value == null ? "" : value)), scope.audience()));
  }

  private void requireAllowedRolePermissions(Role role, RoleScope scope) {
    List<String> selected = FunctionPermissionNormalizer.normalize(
        List.of(role.getFunctionPermissions() == null ? "" : role.getFunctionPermissions()));
    if (selected.contains("all")) {
      throw new AccessDeniedException("非内置角色不能授予全平台权限");
    }
    if (selected.stream().anyMatch(permission -> !FunctionAudiencePolicy.allows(permission, scope.audience()))) {
      throw new AccessDeniedException("角色权限不适用于当前用户端");
    }
    if ((scope.storeId() == null && "admin".equals(scope.clientCode())) || selected.isEmpty()) {
      return;
    }
    Set<String> available = new HashSet<>(FunctionPermissionNormalizer.normalize(
        List.of(availableFunctionPermissions(scope))));
    if (!available.containsAll(selected)) {
      throw new AccessDeniedException("角色权限不能超出当前用户端功能范围");
    }
  }

  private void clearAffectedEmployeeRolesAndDisableIdentity(Long roleId) {
    List<AffectedEmployee> affectedEmployees = jdbcTemplate.query(
        """
        SELECT DISTINCT e.id, e.account_id, e.tenant_id, e.store_id, e.client_code
        FROM employees e
        WHERE FIND_IN_SET(?, e.role_ids)
           OR EXISTS (
             SELECT 1
             FROM account_roles ar
             WHERE ar.role_id = ?
               AND ar.account_id = e.account_id
               AND ar.client_code = e.client_code
               AND ar.tenant_id <=> e.tenant_id
               AND ar.store_id <=> e.store_id
           )
        """,
        (rs, rowNum) -> new AffectedEmployee(
            rs.getLong("id"),
            rs.getObject("account_id", Long.class),
            rs.getObject("tenant_id", Long.class),
            rs.getObject("store_id", Long.class), rs.getString("client_code")),
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
            AND client_code = ?
            AND identity_type = 'employee'
            AND subject_id = ?
          """,
          employee.accountId(),
          employee.clientCode(),
          employee.id());
      jdbcTemplate.update(
          """
          DELETE FROM account_roles
          WHERE account_id = ?
            AND client_code = ?
            AND tenant_id <=> ?
            AND store_id <=> ?
          """,
          employee.accountId(),
          employee.clientCode(),
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

}
