package com.zdm.platform.storeexit;

import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/** Parent identifiers are captured before deletion, so validation cannot lose orphan children. */
public record StoreExitScope(long storeId, long tenantId, Map<String, List<Long>> parentIds) {
  public StoreExitScope {
    parentIds = Map.copyOf(parentIds);
  }

  public static StoreExitScope capture(JdbcTemplate jdbc, long storeId, long tenantId) {
    Map<String, List<Long>> ids = new java.util.LinkedHashMap<>();
    for (String table : List.of("store_customers", "store_finished_products", "store_accessory_products",
        "account_identities", "roles", "employee_invites", "suppliers",
        "store_finished_operation_logs", "store_accessory_operation_logs")) {
      ids.put(table, List.copyOf(jdbc.queryForList("SELECT id FROM " + table + " WHERE store_id=? ORDER BY id",
          Long.class, storeId)));
    }
    ids.put("store_selection_batches", List.copyOf(jdbc.queryForList(
        "SELECT id FROM store_selection_batches WHERE tenant_id=? AND store_id=? ORDER BY id",
        Long.class, tenantId, storeId)));
    ids.put("store_customer_followups", List.copyOf(jdbc.queryForList("""
        SELECT f.id FROM store_customer_followups f JOIN store_customers c ON c.id=f.customer_id
        WHERE c.store_id=? ORDER BY f.id
        """, Long.class, storeId)));
    return new StoreExitScope(storeId, tenantId, ids);
  }

  public List<Long> ids(String table) {
    return parentIds.getOrDefault(table, List.of());
  }
}
