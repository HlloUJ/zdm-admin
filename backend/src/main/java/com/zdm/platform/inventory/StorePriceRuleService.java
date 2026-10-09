package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Automatic price calculation settings; does not rewrite product prices. */
@Service
public class StorePriceRuleService {
  public record Rule(Long id, String scope, Long categoryId, Long roleId, String targetName, BigDecimal coefficient,
      String status, String createdByName, LocalDateTime createdAt) {}
  public record CategoryOption(Long id, Long parentId, String scope, String name, String status,
      BigDecimal effectiveCoefficient, String sourceName) {}
  public record RoleOption(Long id, String name, String status) {}

  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;

  public StorePriceRuleService(JdbcTemplate jdbc, CityPartnerStoreScope scopes) {
    this.jdbc = jdbc;
    this.scopes = scopes;
  }

  public List<Rule> list(String kind, String scope) {
    requireKind(kind);
    requireScope(scope);
    var store = scopes.require();
    return jdbc.query("""
        SELECT rule.*, category.name AS category_name, role.name AS role_name,
          account.display_name AS creator_name
        FROM store_price_rules rule
        LEFT JOIN store_categories category ON category.id = rule.category_id AND category.store_id = rule.store_id
        LEFT JOIN roles role ON role.id = rule.role_id AND role.store_id = rule.store_id
        LEFT JOIN accounts account ON account.id = rule.created_by_account_id
        WHERE rule.tenant_id = ? AND rule.store_id = ? AND rule.kind = ? AND rule.scope = ?
        ORDER BY rule.category_id IS NULL DESC, rule.created_at DESC, rule.id DESC
        """, (row, index) -> new Rule(row.getLong("id"), row.getString("scope"), row.getObject("category_id", Long.class),
        row.getObject("role_id", Long.class), "discount".equals(kind) ? row.getString("role_name")
          : row.getString("category_name"),
        row.getBigDecimal("coefficient"), row.getString("status"), row.getString("creator_name"),
        row.getObject("created_at", LocalDateTime.class)), store.tenantId(), store.storeId(), kind, scope);
  }

  public List<CategoryOption> categories(String scope) {
    var store = scopes.require();
    requireScope(scope);
    var rules = list("price", scope).stream().filter(rule -> "enabled".equals(rule.status())).toList();
    var categories = jdbc.query("""
        SELECT id, parent_id, scope, name, status FROM store_categories WHERE store_id = ? AND scope = ?
        ORDER BY scope, sort_order, id
        """, (row, index) -> new CategoryOption(row.getLong("id"), row.getObject("parent_id", Long.class),
        row.getString("scope"), row.getString("name"), row.getString("status"), null, null), store.storeId(), scope);
    return categories.stream().map(category -> {
      Long current = category.id();
      Rule effective = null;
      // Store categories have at most three levels; bound traversal defensively.
      for (int depth = 0; current != null && depth < 3; depth++) {
        Long target = current;
        effective = rules.stream().filter(rule -> target.equals(rule.categoryId())).findFirst().orElse(null);
        if (effective != null) { break; }
        var parent = categories.stream().filter(item -> target.equals(item.id())).findFirst().orElse(null);
        current = parent == null ? null : parent.parentId();
      }
      return new CategoryOption(category.id(), category.parentId(), category.scope(), category.name(),
          category.status(), effective == null ? null : effective.coefficient(),
          effective == null ? "未配置" : effective.targetName());
    }).toList();
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
  public Rule save(String kind, String scope, Long id, Long categoryId, Long roleId, BigDecimal coefficient) {
    requireKind(kind);
    requireScope(scope);
    var store = scopes.require();
    if (coefficient == null || coefficient.scale() > 2 || coefficient.signum() <= 0
        || coefficient.compareTo(new BigDecimal("999")) > 0) {
      throw new IllegalArgumentException("请输入大于0且不超过999的系数，最多两位小数");
    }
    if ("price".equals(kind)) {
      if (roleId != null) { throw new IllegalArgumentException("价格系数按门店分类配置"); }
      if (categoryId == null || categories(scope).stream()
          .noneMatch(category -> categoryId.equals(category.id()) && "enabled".equals(category.status()))) {
        throw new IllegalArgumentException("请选择本门店已启用分类");
      }
    } else if (categoryId != null || roleId == null || roles().stream()
        .noneMatch(role -> roleId.equals(role.id()) && "enabled".equals(role.status()))) {
      throw new IllegalArgumentException("请选择本门店已启用角色");
    }
    if (id != null) {
      Rule existing = requireRule(kind, scope, id);
      if (!Objects.equals(categoryId, existing.categoryId()) || !Objects.equals(roleId, existing.roleId())) {
        throw new IllegalArgumentException("编辑时不能改变配置对象");
      }
    }
    try {
      if (id == null) {
        jdbc.update("""
            INSERT INTO store_price_rules (tenant_id, store_id, kind, category_id, role_id,
              coefficient, created_by_account_id, target_key, scope) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, store.tenantId(), store.storeId(), kind, categoryId, roleId, coefficient, store.accountId(),
            "price".equals(kind) ? categoryId : roleId, scope);
      } else {
        jdbc.update("""
            UPDATE store_price_rules SET coefficient = ? WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = ? AND scope = ?
            """, coefficient, id, store.tenantId(), store.storeId(), kind, scope);
      }
    } catch (DuplicateKeyException error) {
      throw new IllegalArgumentException("该对象已有配置，请编辑现有配置", error);
    }
    return list(kind, scope).stream().filter(rule -> Objects.equals(categoryId, rule.categoryId())
        && Objects.equals(roleId, rule.roleId())).findFirst().orElseThrow();
  }

  @Transactional
  public Rule status(String kind, String scope, Long id, String status) {
    var store = scopes.require();
    requireRule(kind, scope, id);
    if (!List.of("enabled", "disabled").contains(Objects.toString(status, ""))) {
      throw new IllegalArgumentException("配置状态不正确");
    }
    jdbc.update("UPDATE store_price_rules SET status = ? WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = ? AND scope = ?",
        status, id, store.tenantId(), store.storeId(), kind, scope);
    return requireRule(kind, scope, id);
  }

  @Transactional
  public void delete(String kind, String scope, Long id) {
    var store = scopes.require();
    requireRule(kind, scope, id);
    jdbc.update("DELETE FROM store_price_rules WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = ? AND scope = ?",
        id, store.tenantId(), store.storeId(), kind, scope);
  }

  private Rule requireRule(String kind, String scope, Long id) {
    return list(kind, scope).stream().filter(rule -> id.equals(rule.id())).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("本门店配置不存在"));
  }

  @Transactional
  public List<Rule> saveBatch(String scope, List<Long> categoryIds, BigDecimal coefficient) {
    requireScope(scope);
    if (categoryIds == null || categoryIds.isEmpty() || categoryIds.size() > 200
        || categoryIds.stream().anyMatch(Objects::isNull)
        || categoryIds.stream().distinct().count() != categoryIds.size()) {
      throw new IllegalArgumentException("请选择1至200个不同的分类");
    }
    var allowed = categories(scope).stream().filter(category -> "enabled".equals(category.status()))
        .map(CategoryOption::id).toList();
    if (!allowed.containsAll(categoryIds)) { throw new IllegalArgumentException("请选择本门店当前类型的已启用分类"); }
    var existing = list("price", scope);
    for (Long categoryId : categoryIds) {
      var rule = existing.stream().filter(item -> categoryId.equals(item.categoryId())).findFirst().orElse(null);
      save("price", scope, rule == null ? null : rule.id(), categoryId, null, coefficient);
    }
    return list("price", scope);
  }

  private void requireScope(String scope) {
    if (!List.of("finished", "accessory").contains(Objects.toString(scope, ""))) {
      throw new IllegalArgumentException("商品类型不正确");
    }
  }

  private void requireKind(String kind) {
    if (!List.of("price", "discount").contains(Objects.toString(kind, ""))) {
      throw new IllegalArgumentException("配置类型不正确");
    }
  }
}
