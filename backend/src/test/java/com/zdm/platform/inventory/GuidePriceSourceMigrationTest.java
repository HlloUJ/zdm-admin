package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class GuidePriceSourceMigrationTest {
  @Container static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("guide_source_migration").withUsername("test").withPassword("test");
  @Test void oldGuideRecordsBecomeManualWithoutChangingAnyPriceData() throws Exception {
    var config=Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());
    config.target("166").load().migrate();
    try(var connection=DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());var statement=connection.createStatement()) {
      for(String prefix:new String[]{"finished","accessory"}) {
        statement.executeUpdate("INSERT INTO "+prefix+"_products(id,name,sku) VALUES(998901,'旧指导价','old-guide-source')");
        statement.executeUpdate("INSERT INTO "+prefix+"_product_variants(id,"+prefix+"_product_id,variant_label,stock,cost_price) VALUES(998911,998901,'旧规格',1,10)");
        statement.executeUpdate("INSERT INTO "+prefix+"_product_guide_prices(id,"+prefix+"_product_id,sku_id,variant_label,price_coefficient,cost_price,price) VALUES(998921,998901,998911,'旧规格',2.3456,10,23.46)");
      }
      config.target("167").load().migrate();
      for(String prefix:new String[]{"finished","accessory"}) {
        try(var result=statement.executeQuery("SELECT id,"+prefix+"_product_id,sku_id,variant_label,price_coefficient,cost_price,price,price_source FROM "+prefix+"_product_guide_prices WHERE id=998921")) {
          assertThat(result.next()).isTrue();
          assertThat(result.getLong("id")).isEqualTo(998921L);
          assertThat(result.getLong(prefix+"_product_id")).isEqualTo(998901L);
          assertThat(result.getLong("sku_id")).isEqualTo(998911L);
          assertThat(result.getString("variant_label")).isEqualTo("旧规格");
          assertThat(result.getBigDecimal("price_coefficient")).isEqualByComparingTo("2.3456");
          assertThat(result.getBigDecimal("cost_price")).isEqualByComparingTo("10");
          assertThat(result.getBigDecimal("price")).isEqualByComparingTo("23.46");
          assertThat(result.getString("price_source")).isEqualTo("manual");
        }
      }
    }
  }
}
