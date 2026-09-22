package com.zdm.platform.inventory;

import com.zdm.platform.common.StoreLevelPriceSynchronizer;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class FinishedPriceConfigurationSyncService implements StoreLevelPriceSynchronizer {
  private final JdbcTemplate jdbc;
  public FinishedPriceConfigurationSyncService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  @Override
  @Transactional
  public void syncEnabledStoreLevel(Long levelId) {
    var configurations = jdbc.query("""
        SELECT configuration.id, configuration.price_coefficient
        FROM finished_markup_configurations configuration
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        WHERE level.id = ? AND level.status = 'enabled'
          AND configuration.status = 'enabled' AND configuration.legacy_seeded = FALSE
          AND configuration.price_coefficient >= 0
        FOR UPDATE
        """, (result, row) -> {
          var configuration = new FinishedMarkupConfiguration();
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
    Long count = jdbc.queryForObject("SELECT COUNT(*) FROM finished_product_prices "
        + "WHERE source_configuration_id = ? AND price_source = 'auto'", Long.class, id);
    return count == null ? 0 : count;
  }

  public int refreshAutoPrices(FinishedMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbc.update("""
        UPDATE finished_product_prices price
        SET price.price_coefficient = ?, price.price = ROUND(price.cost_price * ?, 2)
        WHERE price.source_configuration_id = ? AND price.price_source = 'auto'
          AND price.cost_price >= 0
        """, configuration.getPriceCoefficient(), configuration.getPriceCoefficient(), configuration.getId());
  }

  public int backfillMissingPrices(FinishedMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbc.update("""
        INSERT INTO finished_product_prices
          (finished_product_id, sku_id, variant_label, store_level_id, store_level_name,
           price_coefficient, cost_price, price, price_source, source_configuration_id)
        SELECT guide.finished_product_id, guide.sku_id, guide.variant_label,
               configuration.store_level_id, level.name, configuration.price_coefficient,
               guide.cost_price, ROUND(guide.cost_price * configuration.price_coefficient, 2),
               'auto', configuration.id
        FROM finished_product_guide_prices guide
        INNER JOIN finished_markup_configurations configuration ON configuration.id = ?
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        LEFT JOIN finished_product_prices price ON price.finished_product_id = guide.finished_product_id
          AND price.sku_id = guide.sku_id AND price.store_level_id = configuration.store_level_id
        WHERE price.id IS NULL AND guide.cost_price >= 0
        """, configuration.getId());
  }
}
