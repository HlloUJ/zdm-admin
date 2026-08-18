package com.zdm.platform.auth;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AuthAccountMapper {
  @Select("""
      SELECT
        a.id,
        ai.id AS identityId,
        ai.identity_type AS identityType,
        ai.client_code AS clientCode,
        a.phone,
        COALESCE(e.name, a.display_name) AS displayName,
        a.status,
        e.id AS employeeId,
        ai.tenant_id AS tenantId,
        ai.store_id AS storeId,
        COALESCE(e.data_permission, 'all') AS dataPermission,
        t.name AS tenantName,
        s.name AS storeName,
        s.type AS storeType
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id
       AND ai.client_code = 'admin'
       AND ai.status = 'enabled'
      LEFT JOIN employees e
        ON ai.identity_type = 'employee'
       AND e.id = ai.subject_id
       AND e.account_id = a.id
       AND e.status = 'enabled'
      LEFT JOIN tenants t ON t.id = ai.tenant_id
      LEFT JOIN stores s ON s.id = ai.store_id
      WHERE a.phone = #{phone}
        AND a.status = 'enabled'
        AND (ai.identity_type <> 'employee' OR e.id IS NOT NULL)
        AND (ai.tenant_id IS NULL OR t.status = 'enabled')
        AND (ai.store_id IS NULL OR s.status = 'enabled')
      ORDER BY CASE ai.identity_type
        WHEN 'platform_admin' THEN 0
        WHEN 'store_admin' THEN 1
        WHEN 'tenant_admin' THEN 2
        ELSE 3 END,
        ai.id DESC
      LIMIT 1
      """)
  AuthAccount findByPhone(@Param("phone") String phone);

  @Select("""
      SELECT COUNT(*)
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id AND ai.client_code = 'admin' AND ai.status = 'enabled'
      JOIN stores s ON s.id = ai.store_id AND s.status = 'archived'
      LEFT JOIN employees e
        ON ai.identity_type = 'employee' AND e.id = ai.subject_id
       AND e.account_id = a.id AND e.status = 'enabled'
      WHERE a.phone = #{phone}
        AND a.status = 'enabled'
        AND (ai.identity_type <> 'employee' OR e.id IS NOT NULL)
      """)
  int countArchivedStoreIdentitiesByPhone(@Param("phone") String phone);

  @Select("""
      SELECT
        a.id,
        ai.id AS identityId,
        ai.identity_type AS identityType,
        ai.client_code AS clientCode,
        a.phone,
        COALESCE(e.name, a.display_name) AS displayName,
        a.status,
        e.id AS employeeId,
        ai.tenant_id AS tenantId,
        ai.store_id AS storeId,
        COALESCE(e.data_permission, 'all') AS dataPermission,
        t.name AS tenantName,
        s.name AS storeName,
        s.type AS storeType
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id
       AND ai.client_code = 'admin'
       AND ai.status = 'enabled'
      LEFT JOIN employees e
        ON ai.identity_type = 'employee'
       AND e.id = ai.subject_id
       AND e.account_id = a.id
       AND e.status = 'enabled'
      LEFT JOIN tenants t ON t.id = ai.tenant_id
      LEFT JOIN stores s ON s.id = ai.store_id
      WHERE ai.id = #{identityId}
        AND a.status = 'enabled'
        AND (ai.identity_type <> 'employee' OR e.id IS NOT NULL)
        AND (ai.tenant_id IS NULL OR t.status = 'enabled')
        AND (ai.store_id IS NULL OR s.status = 'enabled')
      LIMIT 1
      """)
  AuthAccount findByIdentityId(@Param("identityId") Long identityId);

  @Select("""
      SELECT COUNT(*)
      FROM account_identities ai
      JOIN stores s ON s.id = ai.store_id AND s.status = 'archived'
      WHERE ai.id = #{identityId} AND ai.account_id = #{accountId}
      """)
  int countArchivedStoreIdentity(
      @Param("accountId") Long accountId,
      @Param("identityId") Long identityId);

  @Select("""
      SELECT
        a.id,
        ai.id AS identityId,
        ai.identity_type AS identityType,
        ai.client_code AS clientCode,
        a.phone,
        COALESCE(e.name, a.display_name) AS displayName,
        a.status,
        e.id AS employeeId,
        ai.tenant_id AS tenantId,
        ai.store_id AS storeId,
        COALESCE(e.data_permission, 'all') AS dataPermission,
        t.name AS tenantName,
        s.name AS storeName,
        s.type AS storeType
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id
       AND ai.client_code = 'admin'
       AND ai.status = 'enabled'
      LEFT JOIN employees e
        ON ai.identity_type = 'employee'
       AND e.id = ai.subject_id
       AND e.account_id = a.id
       AND e.status = 'enabled'
      LEFT JOIN tenants t ON t.id = ai.tenant_id
      LEFT JOIN stores s ON s.id = ai.store_id
      WHERE a.id = #{accountId}
        AND a.status = 'enabled'
        AND (ai.identity_type <> 'employee' OR e.id IS NOT NULL)
        AND (ai.tenant_id IS NULL OR t.status = 'enabled')
        AND (ai.store_id IS NULL OR s.status = 'enabled')
      ORDER BY CASE ai.identity_type
        WHEN 'platform_admin' THEN 0
        WHEN 'store_admin' THEN 1
        WHEN 'tenant_admin' THEN 2
        ELSE 3 END,
        ai.id DESC
      LIMIT 1
      """)
  AuthAccount findLatestEnabledByAccountId(@Param("accountId") Long accountId);

  @Select("""
      SELECT
        a.id,
        ai.id AS identityId,
        ai.identity_type AS identityType,
        ai.client_code AS clientCode,
        a.phone,
        COALESCE(e.name, a.display_name) AS displayName,
        a.status,
        e.id AS employeeId,
        ai.tenant_id AS tenantId,
        ai.store_id AS storeId,
        COALESCE(e.data_permission, 'all') AS dataPermission,
        t.name AS tenantName,
        s.name AS storeName,
        s.type AS storeType
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id AND ai.client_code = 'admin' AND ai.status = 'enabled'
      LEFT JOIN employees e
        ON ai.identity_type = 'employee' AND e.id = ai.subject_id
       AND e.account_id = a.id AND e.status = 'enabled'
      LEFT JOIN tenants t ON t.id = ai.tenant_id
      LEFT JOIN stores s ON s.id = ai.store_id
      WHERE a.id = #{accountId} AND a.status = 'enabled'
        AND (ai.identity_type <> 'employee' OR e.id IS NOT NULL)
        AND (ai.tenant_id IS NULL OR t.status = 'enabled')
        AND (ai.store_id IS NULL OR s.status = 'enabled')
        AND NOT (
          ai.identity_type = 'employee'
          AND ai.tenant_id IS NULL
          AND ai.store_id IS NULL
          AND EXISTS (
            SELECT 1 FROM account_identities platform_identity
            WHERE platform_identity.account_id = ai.account_id
              AND platform_identity.identity_type = 'platform_admin'
              AND platform_identity.status = 'enabled'
          )
        )
      ORDER BY ai.tenant_id, ai.store_id, ai.id
      """)
  List<AuthAccount> findAllEnabledByAccountId(@Param("accountId") Long accountId);

  @Select("""
      SELECT function_permissions
      FROM terminal_function_policies
      WHERE terminal = CASE
          WHEN #{storeType} = 'cityPartner' THEN 'store'
          ELSE 'supplier'
        END
      LIMIT 1
      """)
  String findTerminalPermissionValue(@Param("storeType") String storeType);

  @Select("""
      SELECT DISTINCT r.code
      FROM account_roles ar
      JOIN account_identities ai
        ON ai.id = #{identityId}
       AND ai.account_id = ar.account_id
       AND ai.client_code = ar.client_code
       AND ai.identity_type = 'employee'
       AND ai.status = 'enabled'
       AND ((ai.tenant_id = ar.tenant_id) OR (ai.tenant_id IS NULL AND ar.tenant_id IS NULL))
       AND ((ai.store_id = ar.store_id) OR (ai.store_id IS NULL AND ar.store_id IS NULL))
      JOIN roles r ON r.id = ar.role_id
      WHERE ar.account_id = #{accountId}
        AND ar.client_code = 'admin'
        AND r.status = 'enabled'
      """)
  List<String> findAdminRoleCodes(
      @Param("accountId") Long accountId,
      @Param("identityId") Long identityId);

  @Select("""
      SELECT DISTINCT r.name
      FROM account_roles ar
      JOIN account_identities ai
        ON ai.id = #{identityId}
       AND ai.account_id = ar.account_id
       AND ai.client_code = ar.client_code
       AND ai.identity_type = 'employee'
       AND ai.status = 'enabled'
       AND ((ai.tenant_id = ar.tenant_id) OR (ai.tenant_id IS NULL AND ar.tenant_id IS NULL))
       AND ((ai.store_id = ar.store_id) OR (ai.store_id IS NULL AND ar.store_id IS NULL))
      JOIN roles r ON r.id = ar.role_id
      WHERE ar.account_id = #{accountId}
        AND ar.client_code = 'admin'
        AND r.status = 'enabled'
      """)
  List<String> findAdminRoleNames(
      @Param("accountId") Long accountId,
      @Param("identityId") Long identityId);

  @Select("""
      SELECT permission_value
      FROM (
        SELECT DISTINCT r.function_permissions AS permission_value
        FROM account_roles ar
        JOIN account_identities ai
          ON ai.id = #{identityId}
         AND ai.account_id = ar.account_id
         AND ai.client_code = ar.client_code
         AND ai.identity_type = 'employee'
         AND ai.status = 'enabled'
         AND ((ai.tenant_id = ar.tenant_id) OR (ai.tenant_id IS NULL AND ar.tenant_id IS NULL))
         AND ((ai.store_id = ar.store_id) OR (ai.store_id IS NULL AND ar.store_id IS NULL))
        JOIN roles r ON r.id = ar.role_id
        WHERE ar.account_id = #{accountId}
          AND ar.client_code = 'admin'
          AND r.status = 'enabled'
          AND r.function_permissions IS NOT NULL
          AND r.function_permissions <> ''

        UNION

        SELECT DISTINCT rp.permission_code AS permission_value
        FROM account_roles ar
        JOIN account_identities ai
          ON ai.id = #{identityId}
         AND ai.account_id = ar.account_id
         AND ai.client_code = ar.client_code
         AND ai.identity_type = 'employee'
         AND ai.status = 'enabled'
         AND ((ai.tenant_id = ar.tenant_id) OR (ai.tenant_id IS NULL AND ar.tenant_id IS NULL))
         AND ((ai.store_id = ar.store_id) OR (ai.store_id IS NULL AND ar.store_id IS NULL))
        JOIN roles r ON r.id = ar.role_id AND r.status = 'enabled'
        JOIN role_permissions rp ON rp.role_id = r.id
        JOIN permissions p ON p.code = rp.permission_code AND p.status = 'enabled'
        WHERE ar.account_id = #{accountId}
          AND ar.client_code = 'admin'
      ) permission_values
      """)
  List<String> findAdminPermissionValues(
      @Param("accountId") Long accountId,
      @Param("identityId") Long identityId);
}
