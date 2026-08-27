package com.zdm.platform.inventory;

import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SlabPriceConfigurationSyncService {
  private final JdbcTemplate jdbcTemplate;

  public SlabPriceConfigurationSyncService(JdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public long countAutoReferences(Long configurationId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_prices WHERE source_configuration_id = ? AND price_source = 'auto'",
        Long.class,
        configurationId);
    return count == null ? 0L : count;
  }

  public long countManualPrices(Long storeLevelId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_prices WHERE store_level_id = ? AND price_source = 'manual'",
        Long.class,
        storeLevelId);
    return count == null ? 0L : count;
  }

  public int backfillMissingPrices(SlabMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbcTemplate.update(
        """
        INSERT INTO slab_prices
          (slab_id, store_level_id, store_level_name, price_coefficient, cost_price, price,
           price_source, source_configuration_id)
        SELECT inventory.id, configuration.store_level_id, level.name,
               configuration.price_coefficient, inventory.cost_price,
               ROUND(inventory.cost_price * configuration.price_coefficient, 2),
               'auto', configuration.id
        FROM slab_inventory inventory
        INNER JOIN slab_markup_configurations configuration ON configuration.id = ?
        INNER JOIN store_levels level ON level.id = configuration.store_level_id
        LEFT JOIN slab_prices price
          ON price.slab_id = inventory.id AND price.store_level_id = configuration.store_level_id
        WHERE inventory.cost_price IS NOT NULL AND price.id IS NULL
        """,
        configuration.getId());
  }

  public int refreshAutoPrices(SlabMarkupConfiguration configuration) {
    if (!"enabled".equals(configuration.getStatus())) {
      return 0;
    }
    return jdbcTemplate.update(
        """
        UPDATE slab_prices price
        INNER JOIN slab_inventory inventory ON inventory.id = price.slab_id
        INNER JOIN store_levels level ON level.id = price.store_level_id
        SET price.store_level_name = level.name,
            price.price_coefficient = ?,
            price.cost_price = inventory.cost_price,
            price.price = ROUND(inventory.cost_price * ?, 2)
        WHERE price.source_configuration_id = ?
          AND price.price_source = 'auto'
          AND inventory.cost_price IS NOT NULL
        """,
        configuration.getPriceCoefficient(),
        configuration.getPriceCoefficient(),
        configuration.getId());
  }

  public List<Long> listAutoReferencedSlabIds(Long configurationId) {
    return jdbcTemplate.queryForList(
        "SELECT slab_id FROM slab_prices WHERE source_configuration_id = ? AND price_source = 'auto'",
        Long.class,
        configurationId);
  }
}
