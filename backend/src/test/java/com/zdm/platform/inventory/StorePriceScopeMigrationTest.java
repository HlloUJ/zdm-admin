package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class StorePriceScopeMigrationTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("price_scope_upgrade");

  @Test
  void upgradeDerivesCategoryTypesAndDoesNotAssignHistoricalRoleDiscounts() throws Exception {
    Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
        .target("143").load().migrate();
    try (var connection = DriverManager.getConnection(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
        var statement = connection.createStatement()) {
      statement.executeUpdate("INSERT INTO stores(id,tenant_id,name,type,status) VALUES(991001,1,'迁移定价店','cityPartner','enabled')");
      statement.executeUpdate("INSERT INTO store_categories(id,store_id,scope,name) VALUES(991001,991001,'accessory','迁移配件')");
      statement.executeUpdate("INSERT INTO roles(id,name,code,client_code,tenant_id,store_id) VALUES(991001,'店长','migration-price-role','admin',1,991001)");
      statement.executeUpdate("INSERT INTO store_price_rules(id,tenant_id,store_id,kind,category_id,target_key,coefficient) VALUES(991001,1,991001,'price',991001,991001,2.50)");
      statement.executeUpdate("INSERT INTO store_price_rules(id,tenant_id,store_id,kind,role_id,target_key,coefficient) VALUES(991002,1,991001,'discount',991001,991001,0.80)");
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword()).target("144").load().migrate();
      try (var rows = statement.executeQuery("SELECT scope,coefficient FROM store_price_rules WHERE id=991001")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString("scope")).isEqualTo("accessory");
        assertThat(rows.getBigDecimal("coefficient")).isEqualByComparingTo("2.50");
      }
      try (var rows = statement.executeQuery("SELECT scope,coefficient FROM store_price_rules WHERE id=991002")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString("scope")).isNull();
        assertThat(rows.getBigDecimal("coefficient")).isEqualByComparingTo("0.80");
      }
      statement.executeUpdate("INSERT INTO store_price_rules(tenant_id,store_id,kind,scope,role_id,target_key,coefficient) VALUES(1,991001,'discount','finished',991001,991001,0.70),(1,991001,'discount','accessory',991001,991001,0.90)");
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword()).load().migrate();
      try (var rows = statement.executeQuery("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='store_price_rules' AND column_name='status'")) {
        rows.next();
        assertThat(rows.getInt(1)).isZero();
      }
      try (var rows = statement.executeQuery("SELECT COUNT(*) FROM store_price_rules WHERE role_id=991001")) {
        rows.next();
        assertThat(rows.getInt(1)).isEqualTo(3);
      }
    }
  }
}
