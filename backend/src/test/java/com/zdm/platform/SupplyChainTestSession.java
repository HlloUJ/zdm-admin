package com.zdm.platform;

import com.zdm.platform.auth.AuthAccountMapper;
import com.zdm.platform.security.SessionTokenService;
import java.util.ArrayList;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;

/** A separate employee identity on the existing test account, with real terminal and role grants. */
public final class SupplyChainTestSession {
  private SupplyChainTestSession() {}
  public static String create(JdbcTemplate jdbc, AuthAccountMapper accounts, SessionTokenService sessions) {
    List<String> permissions=new ArrayList<>();
    for(String module:List.of("slab-management","finished-stock-management")) {
      String prefix="supply-chain."+module;
      permissions.add(prefix+".operation-log.view");
      for(String tab:List.of("warehouse","selling","off-shelf","sold-out","recycle")) permissions.add(prefix+"."+tab+".view");
      for(String action:List.of("publish","edit","shelf","batch-shelf","delete")) permissions.add(prefix+".warehouse."+action);
      for(String action:List.of("publish","edit","off-shelf","batch-off-shelf")) permissions.add(prefix+".selling."+action);
      for(String action:List.of("detail","restore","batch-restore","delete")) permissions.add(prefix+".off-shelf."+action);
      for(String action:List.of("restore","batch-restore","purge","batch-purge","clear")) permissions.add(prefix+".recycle."+action);
    }
    for(String action:List.of("view","create","edit","delete","toggle-status")) permissions.add("admin.supplier-management."+action);
    String grants=String.join(",",permissions);
    String name=jdbc.queryForObject("SELECT name FROM employees WHERE account_id=1 AND client_code='admin' ORDER BY id DESC LIMIT 1",String.class);
    jdbc.update("UPDATE terminal_function_policies SET function_permissions=? WHERE terminal='supply-chain'",grants);
    jdbc.update("INSERT INTO employees (id,account_id,client_code,name,phone,status,data_permission) VALUES (990000,1,'supply-chain',?,'13900990000','enabled','all') ON DUPLICATE KEY UPDATE status='enabled' ",name);
    jdbc.update("INSERT INTO roles (id,client_code,name,code,status,function_permissions,data_scope) VALUES (990000,'supply-chain','供应链测试角色','SCM_TEST','enabled',?,'all') ON DUPLICATE KEY UPDATE function_permissions=VALUES(function_permissions)",grants);
    jdbc.update("INSERT INTO account_identities (id,account_id,client_code,identity_type,subject_id,status) VALUES (990000,1,'supply-chain','employee',990000,'enabled') ON DUPLICATE KEY UPDATE status='enabled'");
    jdbc.update("INSERT INTO account_roles (account_id,role_id,client_code) SELECT 1,990000,'supply-chain' WHERE NOT EXISTS (SELECT 1 FROM account_roles WHERE account_id=1 AND role_id=990000 AND client_code='supply-chain')");
    return sessions.issue(accounts.findByIdentityId(990000L));
  }
}
