package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Explicit category/role coefficients used only as automatic calculation settings. */
@Service
public class StorePriceRuleService {
  public record Rule(Long id, String scope, Long categoryId, Long roleId, String targetName,
      BigDecimal coefficient, String createdByName, LocalDateTime createdAt) {}
  public record CategoryOption(Long id, Long parentId, String scope, String name, String status) {}
  public record RoleOption(Long id, String name, String status) {}

  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;

  public StorePriceRuleService(JdbcTemplate jdbc, CityPartnerStoreScope scopes) {
    this.jdbc = jdbc;
    this.scopes = scopes;
  }

  public List<Rule> list(String kind, String scope) {
    requireType(kind, scope);
    var store = scopes.require();
    return jdbc.query("""
        SELECT rule.*, category.name AS category_name, role.name AS role_name,
          account.display_name AS creator_name
        FROM store_price_rules rule
        LEFT JOIN store_categories category ON category.id = rule.category_id AND category.store_id = rule.store_id
        LEFT JOIN roles role ON role.id = rule.role_id AND role.store_id = rule.store_id
        LEFT JOIN accounts account ON account.id = rule.created_by_account_id
        WHERE rule.tenant_id = ? AND rule.store_id = ? AND rule.kind = ? AND rule.scope = ?
        ORDER BY rule.created_at DESC, rule.id DESC
        """, (row, index) -> new Rule(row.getLong("id"), row.getString("scope"),
        row.getObject("category_id", Long.class), row.getObject("role_id", Long.class),
        "discount".equals(kind) ? row.getString("role_name") : row.getString("category_name"),
        row.getBigDecimal("coefficient"), row.getString("creator_name"),
        row.getObject("created_at", LocalDateTime.class)), store.tenantId(), store.storeId(), kind, scope);
  }

  public List<CategoryOption> categories(String scope) {
    requireType("price", scope);
    var store = scopes.require();
    return jdbc.query("""
        SELECT id, parent_id, scope, name, status FROM store_categories WHERE store_id = ? AND scope = ?
        ORDER BY sort_order, id
        """, (row, index) -> new CategoryOption(row.getLong("id"), row.getObject("parent_id", Long.class),
        row.getString("scope"), row.getString("name"), row.getString("status")), store.storeId(), scope);
  }

  public List<RoleOption> roles() {
    var store = scopes.require();
    return jdbc.query("""
        SELECT id, name, status FROM roles WHERE tenant_id = ? AND store_id = ? AND client_code = 'admin'
        ORDER BY created_at DESC, id DESC
        """, (row, index) -> new RoleOption(row.getLong("id"), row.getString("name"), row.getString("status")),
        store.tenantId(), store.storeId());
  }

  @Transactional
  public List<Rule> saveBatch(String kind, String scope, List<Long> targetIds, BigDecimal coefficient) {
    requireType(kind, scope);
    var store = scopes.require();
    if (targetIds == null || targetIds.isEmpty() || targetIds.size() > 200
        || targetIds.stream().anyMatch(Objects::isNull)
        || targetIds.stream().distinct().count() != targetIds.size()) {
      throw new IllegalArgumentException("请选择1至200个不同的配置对象");
    }
    if (coefficient == null || coefficient.scale() > 2 || coefficient.signum() <= 0
        || coefficient.compareTo(new BigDecimal("999")) > 0) {
      throw new IllegalArgumentException("请输入大于0且不超过999的系数，最多两位小数");
    }
    boolean price = "price".equals(kind);
    List<Long> allowed = price
        ? categories(scope).stream().filter(item -> "enabled".equals(item.status())).map(CategoryOption::id).toList()
        : roles().stream().filter(item -> "enabled".equals(item.status())).map(RoleOption::id).toList();
    if (!allowed.containsAll(targetIds)) {
      throw new IllegalArgumentException("请选择本门店当前类型的已启用分类或角色");
    }
    var arguments = targetIds.stream().map(id -> new Object[] {store.tenantId(), store.storeId(), kind,
        price ? id : null, price ? null : id, coefficient, store.accountId(), id, scope, coefficient}).toList();
    jdbc.batchUpdate("""
        INSERT INTO store_price_rules (tenant_id,store_id,kind,category_id,role_id,
          coefficient,created_by_account_id,target_key,scope) VALUES (?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE coefficient = ?
        """, arguments);
    return list(kind, scope);
  }

  private void requireType(String kind, String scope) {
    if (!List.of("price", "discount").contains(Objects.toString(kind, ""))
        || !List.of("finished", "accessory").contains(Objects.toString(scope, ""))) {
      throw new IllegalArgumentException("配置类型或商品类型不正确");
    }
  }
}
