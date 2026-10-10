package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Objects;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Category coefficients support automatic pricing; role coefficients define product discount limits. */
@Service
public class StorePriceRuleService {
  public record Rule(Long id, String scope, Long categoryId, Long roleId, String targetName,
      BigDecimal coefficient, String createdByName, LocalDateTime createdAt, String status) {}
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
        row.getObject("created_at", LocalDateTime.class),
        "discount".equals(kind) ? Objects.toString(row.getString("discount_status"), "enabled") : null), store.tenantId(), store.storeId(), kind, scope);
  }

  public List<CategoryOption> categories(String scope) {
    return categoryOptions(scope, false);
  }

  private List<CategoryOption> categoryOptions(String scope, boolean lock) {
    requireType("price", scope);
    var store = scopes.require();
    return jdbc.query("""
        SELECT id, parent_id, scope, name, status FROM store_categories WHERE store_id = ? AND scope = ?
        ORDER BY sort_order, id
        """ + (lock ? " FOR UPDATE" : ""), (row, index) -> new CategoryOption(row.getLong("id"), row.getObject("parent_id", Long.class),
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
  public List<Rule> createDiscount(String scope, Long roleId, BigDecimal coefficient) {
    requireType("discount", scope);
    var store = scopes.require();
    validateTargets("discount", scope, java.util.Collections.singletonList(roleId));
    validateCoefficient("discount", coefficient);
    try {
      jdbc.update("""
          INSERT INTO store_price_rules (tenant_id,store_id,kind,category_id,role_id,
            coefficient,created_by_account_id,target_key,scope,discount_status) VALUES (?,?,'discount',NULL,?,?,?,?,?,'enabled')
          """, store.tenantId(), store.storeId(), roleId, coefficient, store.accountId(), roleId, scope);
    } catch (org.springframework.dao.DuplicateKeyException exception) {
      throw new IllegalArgumentException("该角色已配置折扣系数，请勿重复新增", exception);
    }
    return list("discount", scope);
  }

  private void validateCoefficient(String kind, BigDecimal coefficient) {
    boolean discount = "discount".equals(kind);
    BigDecimal maximum = discount ? BigDecimal.ONE : new BigDecimal("999");
    if (coefficient == null || coefficient.scale() > 2 || coefficient.signum() <= 0
        || coefficient.compareTo(maximum) > 0) {
      throw new IllegalArgumentException(discount
          ? "请输入0.01至1.00之间的折扣系数，最多两位小数"
          : "请输入大于0且不超过999的系数，最多两位小数");
    }
  }

  private void requireDiscount(Long id, String scope) {
    requireType("discount", scope);
    var store = scopes.require();
    var ids = jdbc.queryForList("""
        SELECT id FROM store_price_rules
        WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = 'discount' AND scope = ? FOR UPDATE
        """, id, store.tenantId(), store.storeId(), scope);
    if (ids.isEmpty()) {
      throw new IllegalArgumentException("折扣配置不存在或已被删除");
    }
  }

  @Transactional
  public List<Rule> updateDiscount(Long id, String scope, Long roleId, BigDecimal coefficient) {
    requireDiscount(id, scope);
    validateTargets("discount", scope, java.util.Collections.singletonList(roleId));
    validateCoefficient("discount", coefficient);
    var store = scopes.require();
    try {
      jdbc.update("""
          UPDATE store_price_rules SET role_id = ?, target_key = ?, coefficient = ?
          WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = 'discount' AND scope = ?
          """, roleId, roleId, coefficient, id, store.tenantId(), store.storeId(), scope);
    } catch (org.springframework.dao.DuplicateKeyException exception) {
      throw new IllegalArgumentException("该角色已配置折扣系数，请勿重复配置", exception);
    }
    return list("discount", scope);
  }

  @Transactional
  public List<Rule> updateDiscountStatus(Long id, String scope, String status) {
    requireDiscount(id, scope);
    if (!List.of("enabled", "disabled").contains(Objects.toString(status, ""))) {
      throw new IllegalArgumentException("配置状态不正确");
    }
    var store = scopes.require();
    jdbc.update("""
        UPDATE store_price_rules SET discount_status = ?
        WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = 'discount' AND scope = ?
        """, status, id, store.tenantId(), store.storeId(), scope);
    return list("discount", scope);
  }

  @Transactional
  public List<Rule> deleteDiscount(Long id, String scope) {
    requireDiscount(id, scope);
    var store = scopes.require();
    jdbc.update("""
        DELETE FROM store_price_rules
        WHERE id = ? AND tenant_id = ? AND store_id = ? AND kind = 'discount' AND scope = ?
        """, id, store.tenantId(), store.storeId(), scope);
    return list("discount", scope);
  }

  @Transactional
  public List<Rule> savePriceBatch(String scope, List<Long> targetIds, BigDecimal coefficient) {
    requireType("price", scope);
    var store = scopes.require();
    validateCoefficient("price", coefficient);
    validateTargets("price", scope, targetIds);
    var arguments = targetIds.stream().map(id -> new Object[] {store.tenantId(), store.storeId(), "price",
        id, null, coefficient, store.accountId(), id, scope, coefficient}).toList();
    jdbc.batchUpdate("""
        INSERT INTO store_price_rules (tenant_id,store_id,kind,category_id,role_id,
          coefficient,created_by_account_id,target_key,scope) VALUES (?,?,?,?,?,?,?,?,?)
        ON DUPLICATE KEY UPDATE coefficient = ?
        """, arguments);
    return list("price", scope);
  }

  @Transactional
  public List<Rule> clearPriceBatch(String scope, List<Long> targetIds) {
    requireType("price", scope);
    var store = scopes.require();
    validateTargets("price", scope, targetIds);
    var arguments = targetIds.stream()
        .map(id -> new Object[] {store.tenantId(), store.storeId(), scope, id}).toList();
    jdbc.batchUpdate("""
        DELETE FROM store_price_rules
        WHERE tenant_id = ? AND store_id = ? AND kind = 'price' AND scope = ? AND category_id = ?
        """, arguments);
    return list("price", scope);
  }

  public record PriceChange(Long categoryId, BigDecimal coefficient) {}

  @Transactional
  public List<Rule> savePrices(String scope, List<PriceChange> changes) {
    requireType("price", scope);
    var store = scopes.require();
    if (changes == null || changes.stream().anyMatch(Objects::isNull)) {
      throw new IllegalArgumentException("请选择需要保存的分类");
    }
    validateTargets("price", scope, changes.stream().map(PriceChange::categoryId).toList());
    for (var change : changes) {
      var coefficient = change.coefficient();
      if (coefficient != null && (coefficient.scale() > 2 || coefficient.signum() <= 0
          || coefficient.compareTo(new BigDecimal("999")) > 0)) {
        throw new IllegalArgumentException("请输入大于0且不超过999的系数，最多两位小数");
      }
    }
    var writes = changes.stream().filter(change -> change.coefficient() != null)
        .map(change -> new Object[] {store.tenantId(), store.storeId(), "price", change.categoryId(), null,
            change.coefficient(), store.accountId(), change.categoryId(), scope, change.coefficient()}).toList();
    if (!writes.isEmpty()) {
      jdbc.batchUpdate("""
          INSERT INTO store_price_rules (tenant_id,store_id,kind,category_id,role_id,
            coefficient,created_by_account_id,target_key,scope) VALUES (?,?,?,?,?,?,?,?,?)
          ON DUPLICATE KEY UPDATE coefficient = ?
          """, writes);
    }
    var clears = changes.stream().filter(change -> change.coefficient() == null)
        .map(change -> new Object[] {store.tenantId(), store.storeId(), scope, change.categoryId()}).toList();
    if (!clears.isEmpty()) {
      jdbc.batchUpdate("""
          DELETE FROM store_price_rules
          WHERE tenant_id = ? AND store_id = ? AND kind = 'price' AND scope = ? AND category_id = ?
          """, clears);
    }
    return list("price", scope);
  }

  private void validateTargets(String kind, String scope, List<Long> targetIds) {
    if (targetIds == null || targetIds.isEmpty() || targetIds.size() > 200
        || targetIds.stream().anyMatch(Objects::isNull)
        || targetIds.stream().distinct().count() != targetIds.size()) {
      throw new IllegalArgumentException("请选择1至200个不同的配置对象");
    }
    boolean price = "price".equals(kind);
    var categoryOptions = price ? categoryOptions(scope, true) : List.<CategoryOption>of();
    List<Long> allowed = price
        ? categoryOptions.stream().filter(item -> "enabled".equals(item.status()))
            .filter(item -> categoryOptions.stream().noneMatch(child -> item.id().equals(child.parentId())))
            .map(CategoryOption::id).toList()
        : roles().stream().filter(item -> "enabled".equals(item.status())).map(RoleOption::id).toList();
    if (!allowed.containsAll(targetIds)) {
      throw new IllegalArgumentException(price ? "请选择本门店当前类型的已启用末级分类"
          : "请选择本门店当前类型的已启用分类或角色");
    }
  }

  private void requireType(String kind, String scope) {
    if (!List.of("price", "discount").contains(Objects.toString(kind, ""))
        || !List.of("finished", "accessory").contains(Objects.toString(scope, ""))) {
      throw new IllegalArgumentException("配置类型或商品类型不正确");
    }
  }
}
