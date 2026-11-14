package com.zdm.platform.storeexit;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public final class StoreExitRegistry {
  public static final Map<String, String> STATE_ACTIVITY_PARENTS = Map.of(
      "store-finished/store", "store_finished_products", "store-accessory/store", "store_accessory_products");
  private final List<StoreExitModule> modules;

  public StoreExitRegistry(List<StoreExitModule> extensions) {
    List<StoreExitModule> all = new ArrayList<>();
    all.add(indirect("selection-batch-items", "store_selection_batch_items", "batch_id", "store_selection_batches"));
    all.add(new SqlModule("selection", List.of("store_selection_items", "store_selection_batches"),
        List.of("selection-batch-items"), scope -> new Clause("tenant_id=? AND store_id=?",
            new Object[]{scope.tenantId(), scope.storeId()})));
    all.add(sql("payment", List.of("store_payment_name_events", "store_payment_names")));
    all.add(indirect("customer-followups", "store_customer_followups", "customer_id", "store_customers"));
    all.add(sql("customers", List.of("store_customers"), List.of("customer-followups")));
    all.add(indirect("finished-prices", "store_finished_sale_prices", "listing_id", "store_finished_products"));
    all.add(sql("finished-listings", List.of("store_finished_products"), List.of("finished-prices", "store-product-state")));
    all.add(indirect("accessory-prices", "store_accessory_sale_prices", "listing_id", "store_accessory_products"));
    all.add(sql("accessory-listings", List.of("store_accessory_products"), List.of("accessory-prices", "store-product-state")));
    all.add(new SqlModule("store-product-state", List.of("product_state_activity"), List.of(), scope -> {
      List<Object> args = new ArrayList<>();
      List<String> predicates = new ArrayList<>();
      STATE_ACTIVITY_PARENTS.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
        List<Long> ids = scope.ids(entry.getValue());
        if (!ids.isEmpty()) {
          predicates.add("(kind=? AND record_id IN (" + String.join(",", java.util.Collections.nCopies(ids.size(), "?")) + "))");
          args.add(entry.getKey().substring(0, entry.getKey().indexOf('/'))); args.addAll(ids);
        }
      });
      return new Clause(predicates.isEmpty() ? "1=0" : "business_client_code='store' AND (" + String.join(" OR ", predicates) + ")", args.toArray());
    }));
    all.add(sql("product-logs", List.of("store_finished_operation_logs", "store_accessory_operation_logs")));
    all.add(indirect("sessions", "auth_sessions", "identity_id", "account_identities"));
    all.add(indirect("invite-history", "employee_invite_acceptances", "invite_id", "employee_invites"));
    all.add(sql("invites", List.of("employee_invites"), List.of("invite-history")));
    all.add(sql("memberships", List.of("account_roles", "employees", "account_identities"), List.of("sessions")));
    all.add(indirect("role-permissions", "role_permissions", "role_id", "roles"));
    all.add(sql("price-rules", List.of("store_price_rules")));
    all.add(sql("roles", List.of("roles"), List.of("memberships", "role-permissions", "price-rules")));
    all.add(indirect("supplier-links", "supplier_supply_type_links", "supplier_id", "suppliers"));
    all.add(sql("suppliers", List.of("suppliers"), List.of("supplier-links")));
    all.add(new SqlModule("categories", List.of("store_categories"), List.of("finished-listings", "accessory-listings", "price-rules"),
        scope -> new Clause("store_id=?", new Object[]{scope.storeId()})) {
      @Override public void execute(JdbcTemplate jdbc, StoreExitScope scope) {
        int removed;
        do {
          removed = jdbc.update("DELETE c FROM store_categories c LEFT JOIN store_categories child ON child.parent_id=c.id "
              + "WHERE c.store_id=? AND child.id IS NULL", scope.storeId());
        } while (removed > 0);
        verify(jdbc, scope);
      }
    });
    all.addAll(extensions);
    modules = order(all);
  }

  public List<StoreExitModule> modules() { return List.copyOf(modules); }

  public Set<String> tables() {
    Set<String> result = new HashSet<>();
    modules.forEach(module -> result.addAll(module.tables()));
    return Set.copyOf(result);
  }

  private static List<StoreExitModule> order(List<StoreExitModule> all) {
    Map<String, StoreExitModule> pending = new LinkedHashMap<>();
    Set<String> tables = new HashSet<>();
    for (StoreExitModule module : all) {
      if (module.id().isBlank() || module.tables().isEmpty() || pending.putIfAbsent(module.id(), module) != null) {
        throw new IllegalStateException("门店退出模块登记重复或为空");
      }
      for (String table : module.tables()) {
        if (!table.matches("[a-z_]+") || !tables.add(table)) {
          throw new IllegalStateException("门店退出数据处理归口重复或非法");
        }
      }
    }
    List<StoreExitModule> sorted = new ArrayList<>();
    Set<String> done = new HashSet<>();
    while (!pending.isEmpty()) {
      var ready = pending.values().stream().filter(m -> done.containsAll(m.dependsOn())).findFirst();
      if (ready.isEmpty()) { throw new IllegalStateException("门店退出模块依赖缺失或循环"); }
      StoreExitModule module = ready.get();
      pending.remove(module.id()); done.add(module.id()); sorted.add(module);
    }
    return List.copyOf(sorted);
  }

  private static StoreExitModule sql(String id, List<String> tables) { return sql(id, tables, List.of()); }
  private static StoreExitModule sql(String id, List<String> tables, List<String> depends) {
    return new SqlModule(id, tables, depends, s -> new Clause("store_id=?", new Object[]{s.storeId()}));
  }
  private static StoreExitModule indirect(String id, String table, String column, String parent) {
    return new SqlModule(id, List.of(table), List.of(), scope -> {
      List<Long> ids = scope.ids(parent);
      return ids.isEmpty() ? new Clause("1=0", new Object[0])
          : new Clause(column + " IN (" + String.join(",", java.util.Collections.nCopies(ids.size(), "?")) + ")", ids.toArray());
    });
  }

  private record Clause(String sql, Object[] args) { }

  private static class SqlModule implements StoreExitModule {
    private final String id;
    private final List<String> tables;
    private final List<String> depends;
    private final Function<StoreExitScope, Clause> clause;
    SqlModule(String id, List<String> tables, List<String> depends, Function<StoreExitScope, Clause> clause) {
      this.id = id; this.tables = List.copyOf(tables); this.depends = List.copyOf(depends); this.clause = clause;
    }
    @Override public String id() { return id; }
    @Override public List<String> tables() { return tables; }
    @Override public List<String> dependsOn() { return depends; }
    @Override public Map<String, Long> inspect(JdbcTemplate jdbc, StoreExitScope scope) {
      Map<String, Long> counts = new LinkedHashMap<>();
      Clause condition = clause.apply(scope);
      tables.forEach(table -> counts.put(table, jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + condition.sql(), Long.class, condition.args())));
      return counts;
    }
    @Override public List<Long> referencedAccounts(JdbcTemplate jdbc, StoreExitScope scope, StoreExitAccountReferences references) {
      java.util.Set<Long> accounts = new java.util.TreeSet<>();
      Clause condition = clause.apply(scope);
      for (String table : tables) {
        for (String field : references.liveFields(table)) {
          if (!field.matches("[a-z_]+")) { throw new IllegalStateException("账号引用字段不合法"); }
          accounts.addAll(jdbc.queryForList("SELECT DISTINCT " + field + " FROM " + table
              + " WHERE (" + condition.sql() + ") AND " + field + " IS NOT NULL AND EXISTS"
              + " (SELECT 1 FROM accounts a WHERE a.id=" + table + "." + field + ")", Long.class, condition.args()));
        }
      }
      return List.copyOf(accounts);
    }
    @Override public void execute(JdbcTemplate jdbc, StoreExitScope scope) {
      Clause condition = clause.apply(scope);
      tables.forEach(table -> jdbc.update("DELETE FROM " + table + " WHERE " + condition.sql(), condition.args()));
    }
    @Override public void verify(JdbcTemplate jdbc, StoreExitScope scope) {
      if (inspect(jdbc, scope).values().stream().anyMatch(count -> count != 0)) {
        throw new IllegalStateException("门店退出残留校验失败：" + id);
      }
    }
  }
}
