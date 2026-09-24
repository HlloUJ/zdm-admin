package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreFinishedPriceConfigurationService {
  public record RoleOption(Long id, String name, String status) {}
  public record Configuration(Long id, Long roleId, String roleName, BigDecimal priceCoefficient,
      String status, String createdByName, java.time.LocalDateTime createdAt) {}

  private final JdbcTemplate jdbc;
  private final CityPartnerStoreScope scopes;

  public StoreFinishedPriceConfigurationService(JdbcTemplate jdbc, CityPartnerStoreScope scopes) {
    this.jdbc = jdbc;
    this.scopes = scopes;
  }

  public List<RoleOption> roles() {
    var store = scopes.require();
    return jdbc.query("""
        SELECT id, name, status FROM roles
        WHERE tenant_id = ? AND store_id = ? AND client_code = 'admin'
        ORDER BY created_at DESC, id DESC
        """, (row, index) -> new RoleOption(row.getLong("id"), row.getString("name"),
        row.getString("status")), store.tenantId(), store.storeId());
  }

  public List<Configuration> list() {
    var store = scopes.require();
    return jdbc.query("""
        SELECT config.id, config.role_id, role.name AS role_name, config.price_coefficient,
          config.status, account.display_name AS created_by_name, config.created_at
        FROM store_finished_role_price_configurations config
        JOIN roles role ON role.id = config.role_id
        LEFT JOIN accounts account ON account.id = config.created_by_account_id
        WHERE config.tenant_id = ? AND config.store_id = ?
        ORDER BY config.created_at DESC, config.id DESC
        """, (row, index) -> new Configuration(row.getLong("id"), row.getLong("role_id"),
        row.getString("role_name"), row.getBigDecimal("price_coefficient"), row.getString("status"),
        row.getString("created_by_name"), row.getTimestamp("created_at").toLocalDateTime()),
        store.tenantId(), store.storeId());
  }

  @Transactional
  public Configuration create(Long roleId, BigDecimal coefficient) {
    var store = scopes.require();
    validateCoefficient(coefficient);
    requireRole(store, roleId);
    Long duplicate = jdbc.queryForObject("""
        SELECT COUNT(*) FROM store_finished_role_price_configurations
        WHERE store_id = ? AND role_id = ?
        """, Long.class, store.storeId(), roleId);
    if (duplicate != null && duplicate > 0) {
      throw new IllegalArgumentException("该角色已有价格配置");
    }
    jdbc.update("""
        INSERT INTO store_finished_role_price_configurations
          (tenant_id, store_id, role_id, price_coefficient, created_by_account_id)
        VALUES (?, ?, ?, ?, ?)
        """, store.tenantId(), store.storeId(), roleId, coefficient, store.accountId());
    return list().stream().filter(item -> roleId.equals(item.roleId())).findFirst().orElseThrow();
  }

  @Transactional
  public Configuration update(Long id, BigDecimal coefficient) {
    var store = scopes.require();
    validateCoefficient(coefficient);
    requireConfiguration(store, id);
    jdbc.update("""
        UPDATE store_finished_role_price_configurations SET price_coefficient = ?
        WHERE id = ? AND tenant_id = ? AND store_id = ?
        """, coefficient, id, store.tenantId(), store.storeId());
    return list().stream().filter(item -> id.equals(item.id())).findFirst().orElseThrow();
  }

  @Transactional
  public Configuration setStatus(Long id, String status) {
    var store = scopes.require();
    if (!List.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("价格配置状态不正确");
    }
    requireConfiguration(store, id);
    jdbc.update("""
        UPDATE store_finished_role_price_configurations SET status = ?
        WHERE id = ? AND tenant_id = ? AND store_id = ?
        """, status, id, store.tenantId(), store.storeId());
    return list().stream().filter(item -> id.equals(item.id())).findFirst().orElseThrow();
  }

  @Transactional
  public void delete(Long id) {
    var store = scopes.require();
    Configuration configuration = requireConfiguration(store, id);
    Long references = jdbc.queryForObject("""
        SELECT COUNT(*) FROM store_finished_role_price_overrides override_price
        JOIN store_finished_products listing ON listing.id = override_price.listing_id
        WHERE listing.store_id = ? AND override_price.role_id = ?
        """, Long.class, store.storeId(), configuration.roleId());
    if (references != null && references > 0) {
      throw new IllegalArgumentException("该配置已有商品手工价格，请先停用");
    }
    jdbc.update("""
        DELETE FROM store_finished_role_price_configurations
        WHERE id = ? AND tenant_id = ? AND store_id = ?
        """, id, store.tenantId(), store.storeId());
  }

  private Configuration requireConfiguration(CityPartnerStoreScope.Store store, Long id) {
    return list().stream().filter(item -> id.equals(item.id())).findFirst()
        .orElseThrow(() -> new IllegalArgumentException("本门店价格配置不存在"));
  }

  private void requireRole(CityPartnerStoreScope.Store store, Long roleId) {
    Long count = jdbc.queryForObject("""
        SELECT COUNT(*) FROM roles
        WHERE id = ? AND tenant_id = ? AND store_id = ? AND client_code = 'admin' AND status = 'enabled'
        """, Long.class, roleId, store.tenantId(), store.storeId());
    if (count == null || count == 0) {
      throw new AccessDeniedException("只能配置本门店已启用角色");
    }
  }

  private static void validateCoefficient(BigDecimal coefficient) {
    if (coefficient == null || coefficient.scale() > 4 || coefficient.signum() < 0
        || coefficient.compareTo(new BigDecimal("999")) > 0) {
      throw new IllegalArgumentException("请输入正确的价格系数");
    }
  }
}
