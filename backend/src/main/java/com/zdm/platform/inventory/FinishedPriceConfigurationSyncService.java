package com.zdm.platform.inventory;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class FinishedPriceConfigurationSyncService {
  private final JdbcTemplate jdbc;
  public FinishedPriceConfigurationSyncService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

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
        """, configuration.getPriceCoefficient(), configuration.getPriceCoefficient(), configuration.getId());
  }

  public int backfillMissingPrices(FinishedMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbc.update("""
        INSERT INTO finished_product_prices
          (finished_product_id, variant_key, variant_label, store_level_id, store_level_name,
           price_coefficient, cost_price, price, price_source, source_configuration_id)
        SELECT guide.finished_product_id, guide.variant_key, guide.variant_label,
               configuration.store_level_id, level.name, configuration.price_coefficient,
               guide.cost_price, ROUND(guide.cost_price * configuration.price_coefficient, 2),
               'auto', configuration.id
        FROM finished_product_guide_prices guide
        INNER JOIN finished_markup_configurations configuration ON configuration.id = ?
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        LEFT JOIN finished_product_prices price ON price.finished_product_id = guide.finished_product_id
          AND price.variant_key = guide.variant_key AND price.store_level_id = configuration.store_level_id
        WHERE price.id IS NULL
        """, configuration.getId());
  }
}
