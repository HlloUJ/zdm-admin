package com.zdm.platform.inventory;

import com.zdm.platform.common.StoreLevelPriceSynchronizer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AccessoryPriceConfigurationSyncService implements StoreLevelPriceSynchronizer {
  private final JdbcTemplate jdbc;
  public AccessoryPriceConfigurationSyncService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @Override
  @Transactional
  public void syncEnabledStoreLevel(Long levelId) {
    var configurations = jdbc.query("""
        SELECT configuration.id, configuration.price_coefficient
        FROM accessory_markup_configurations configuration
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        WHERE level.id = ? AND (level.status = 'enabled'
          OR EXISTS (SELECT 1 FROM stores store WHERE store.store_level_id = level.id))
          AND configuration.status = 'enabled' AND configuration.legacy_seeded = FALSE
          AND configuration.price_coefficient >= 0
        FOR UPDATE
        """, (result, row) -> {
          var configuration = new AccessoryMarkupConfiguration();
          configuration.setId(result.getLong("id"));
          configuration.setPriceCoefficient(result.getBigDecimal("price_coefficient"));
          configuration.setStatus("enabled");
          return configuration;
        }, levelId);
    for (var configuration : configurations) {
      refreshAutoPrices(configuration);
      backfillMissingPrices(configuration);
    }
  }

  public long countAutoReferences(Long id) {
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM accessory_product_prices "
        + "WHERE source_configuration_id = ? AND price_source = 'auto'", Long.class, id);
    return count == null ? 0 : count;
  }

  public int refreshAutoPrices(AccessoryMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbc.update("""
        UPDATE accessory_product_prices price
        INNER JOIN store_levels level ON level.id = price.store_level_id
        SET price.price_coefficient = ?, price.price = ROUND(price.cost_price * ?, 2)
        WHERE price.source_configuration_id = ? AND price.price_source = 'auto'
          AND (level.status = 'enabled'
            OR EXISTS (SELECT 1 FROM stores store WHERE store.store_level_id = level.id))
          AND price.cost_price >= 0
        """, configuration.getPriceCoefficient(), configuration.getPriceCoefficient(), configuration.getId());
  }

  public int backfillMissingPrices(AccessoryMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbc.update("""
        INSERT INTO accessory_product_prices
          (accessory_product_id, sku_id, variant_label, store_level_id, store_level_name,
           price_coefficient, cost_price, price, price_source, source_configuration_id)
        SELECT guide.accessory_product_id, guide.sku_id, guide.variant_label,
               configuration.store_level_id, level.name, configuration.price_coefficient,
               guide.cost_price, ROUND(guide.cost_price * configuration.price_coefficient, 2),
               'auto', configuration.id
        FROM accessory_product_guide_prices guide
        INNER JOIN accessory_markup_configurations configuration ON configuration.id = ?
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        LEFT JOIN accessory_product_prices price ON price.accessory_product_id = guide.accessory_product_id
          AND price.sku_id = guide.sku_id AND price.store_level_id = configuration.store_level_id
        WHERE price.id IS NULL AND guide.cost_price >= 0
          AND (level.status = 'enabled'
            OR EXISTS (SELECT 1 FROM stores store WHERE store.store_level_id = level.id))
          AND configuration.status = 'enabled'
          AND configuration.legacy_seeded = FALSE
        """, configuration.getId());
  }
}
