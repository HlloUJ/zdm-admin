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
        a.phone,
        e.name AS displayName,
        a.status,
        e.id AS employeeId,
        e.tenant_id AS tenantId,
        e.store_id AS storeId,
        e.data_permission AS dataPermission
      FROM accounts a
      JOIN account_identities ai
        ON ai.account_id = a.id
       AND ai.client_code = 'admin'
       AND ai.identity_type = 'employee'
       AND ai.status = 'enabled'
      JOIN employees e
        ON e.id = ai.subject_id
       AND e.account_id = a.id
       AND e.status = 'enabled'
      WHERE a.phone = #{phone}
        AND a.status = 'enabled'
      ORDER BY e.id DESC
      LIMIT 1
      """)
  AuthAccount findByPhone(@Param("phone") String phone);

  @Select("""
      SELECT DISTINCT r.code
      FROM account_roles ar
      JOIN account_identities ai
        ON ai.account_id = ar.account_id
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
  List<String> findAdminRoleCodes(@Param("accountId") Long accountId);

  @Select("""
      SELECT DISTINCT r.name
      FROM account_roles ar
      JOIN account_identities ai
        ON ai.account_id = ar.account_id
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
  List<String> findAdminRoleNames(@Param("accountId") Long accountId);

  @Select("""
      SELECT DISTINCT r.function_permissions
      FROM account_roles ar
      JOIN account_identities ai
        ON ai.account_id = ar.account_id
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
      """)
  List<String> findAdminPermissionValues(@Param("accountId") Long accountId);
}
