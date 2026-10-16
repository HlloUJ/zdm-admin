package com.zdm.platform.role;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Stable semantic identity scoped to a store; numeric role IDs remain local references. */
@Service
public class StoreBuiltinRoleService {
  public static final String MANAGER_KEY = "STORE_MANAGER";
  public static final String MANAGER_NAME = "店长";
  private final JdbcTemplate jdbc;
  public StoreBuiltinRoleService(JdbcTemplate jdbc) { this.jdbc = jdbc; }
  public static boolean isManager(Role role) { return MANAGER_KEY.equals(role.getBuiltinKey()); }
  public void provision(Long storeId, Long tenantId, Long creator) {
    jdbc.update("""
        INSERT INTO roles
          (client_code,tenant_id,store_id,name,code,builtin_key,data_scope,status,
           function_permissions,created_by_account_id,created_by_client_code)
        VALUES ('admin',?,?,?,CONCAT('BUILTIN_STORE_MANAGER_',?),?,'all','enabled','',?,'admin')
        """, tenantId,storeId,MANAGER_NAME,storeId,MANAGER_KEY,creator);
  }
}
