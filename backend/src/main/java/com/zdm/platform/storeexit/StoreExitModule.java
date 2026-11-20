package com.zdm.platform.storeexit;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/** Internal participation contract; never accepts a client-provided organization context. */
public interface StoreExitModule {
  String id();
  List<String> tables();
  default List<String> dependsOn() { return List.of(); }
  Map<String, Long> inspect(JdbcTemplate jdbc, StoreExitScope scope);
  default List<Long> referencedAccounts(JdbcTemplate jdbc, StoreExitScope scope, StoreExitAccountReferences references) {
    if (tables().stream().anyMatch(table -> !references.liveFields(table).isEmpty())) {
      throw new IllegalStateException("门店退出模块缺少账号候选收集：" + id());
    }
    return List.of();
  }
  void execute(JdbcTemplate jdbc, StoreExitScope scope);
  void verify(JdbcTemplate jdbc, StoreExitScope scope);
}
