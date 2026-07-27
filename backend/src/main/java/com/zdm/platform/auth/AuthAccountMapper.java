package com.zdm.platform.auth;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

@Mapper
public interface AuthAccountMapper {
  @Select("""
      SELECT id, phone, display_name AS displayName, status
      FROM accounts
      WHERE phone = #{phone}
      LIMIT 1
      """)
  AuthAccount findByPhone(@Param("phone") String phone);

  @Select("""
      SELECT DISTINCT r.code
      FROM account_roles ar
      JOIN roles r ON r.id = ar.role_id
      WHERE ar.account_id = #{accountId}
        AND ar.client_code = 'admin'
        AND r.status = 'enabled'
      """)
  List<String> findAdminRoleCodes(@Param("accountId") Long accountId);

  @Select("""
      SELECT DISTINCT rp.permission_code
      FROM account_roles ar
      JOIN role_permissions rp ON rp.role_id = ar.role_id
      JOIN permissions p ON p.code = rp.permission_code
      WHERE ar.account_id = #{accountId}
        AND ar.client_code = 'admin'
        AND p.client_code = 'admin'
        AND p.status = 'enabled'
      """)
  List<String> findAdminPermissionCodes(@Param("accountId") Long accountId);
}
