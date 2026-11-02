package com.zdm.platform.inventory;

import java.math.BigDecimal;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Each commodity has exactly one platform guide-price configuration. */
@Service
public class GuidePriceConfigurationSyncService {
  public enum Commodity {
    FINISHED("finished"), ACCESSORY("accessory");
    private final String prefix;
    Commodity(String prefix) { this.prefix = prefix; }
  }
  private final JdbcTemplate jdbc;
  public GuidePriceConfigurationSyncService(JdbcTemplate jdbc) { this.jdbc = jdbc; }

  public void sync(Commodity commodity, BigDecimal coefficient) {
    String prefix = commodity.prefix;
    String products = prefix + "_products";
    String guides = prefix + "_product_guide_prices";
    String variants = prefix + "_product_variants";
    String key = prefix + "_product_id";
    jdbc.update("UPDATE " + guides + " guide INNER JOIN " + products + " product ON product.id=guide." + key
        + " SET guide.price_coefficient=?, guide.price=ROUND(guide.cost_price * ?, 2)"
        + " WHERE guide.price_source='auto' AND product.operations_deleted=FALSE", coefficient, coefficient);
    jdbc.update("INSERT INTO " + guides + " (" + key + ",sku_id,variant_label,price_coefficient,cost_price,price,price_source)"
        + " SELECT product.id, variant.id, variant.variant_label, ?, variant.cost_price, ROUND(variant.cost_price * ?,2),'auto'"
        + " FROM " + products + " product INNER JOIN " + variants + " variant ON variant." + key + "=product.id"
        + " LEFT JOIN " + guides + " guide ON guide." + key + "=product.id AND guide.sku_id=variant.id"
        + " WHERE guide.id IS NULL AND product.operations_deleted=FALSE AND product.source_status='selling'"
        + " AND variant.cost_price >= 0", coefficient, coefficient);
    jdbc.update("UPDATE " + products + " product SET product.guide_price=(SELECT guide.price FROM " + guides
        + " guide WHERE guide." + key + "=product.id ORDER BY guide.sku_id LIMIT 1)"
        + " WHERE product.operations_deleted=FALSE AND EXISTS (SELECT 1 FROM " + guides
        + " followed WHERE followed." + key + "=product.id AND followed.price_source='auto')");
  }
}
