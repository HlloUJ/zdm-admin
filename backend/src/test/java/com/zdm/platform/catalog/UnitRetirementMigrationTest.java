package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class UnitRetirementMigrationTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("unit_retirement_test");

  @Test
  void upgradeRemovesOnlyRetiredUnitsAndTheirGrants() throws Exception {
    Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
        .target("158").load().migrate();
    try (var connection = DriverManager.getConnection(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
        var statement = connection.createStatement()) {
      assertThat(count(statement, "SELECT COUNT(*) FROM master_data")).isPositive();
      int categories = count(statement, "SELECT COUNT(*) FROM product_categories");
      int suppliers = count(statement, "SELECT COUNT(*) FROM suppliers");
      String old = "admin.product-data-center.master-data.view";
      String retained = "migration.keep.view";
      statement.executeUpdate("INSERT INTO roles(id,name,code,client_code,created_by_account_id) VALUES(991159,'保留角色','unit-retirement-test','admin',1)");
      statement.executeUpdate("INSERT INTO permissions(code,client_code,name,module) VALUES('" + old + "','admin','退役测试','retired'),('" + retained + "','admin','保留测试','keep')");
      statement.executeUpdate("INSERT INTO role_permissions(role_id,permission_code) VALUES(991159,'" + old + "'),(991159,'" + retained + "')");
      statement.executeUpdate("UPDATE roles SET function_permissions='" + old + "," + old + "," + retained + "' WHERE id=991159");
      statement.executeUpdate("UPDATE terminal_function_policies SET function_permissions='" + retained + "," + old + "' WHERE terminal='store'");
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword()).load().migrate();
      assertThat(count(statement, "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='master_data'")).isZero();
      assertThat(count(statement, "SELECT COUNT(*) FROM permissions WHERE code='" + old + "'")).isZero();
      assertThat(count(statement, "SELECT COUNT(*) FROM role_permissions WHERE permission_code='" + old + "'")).isZero();
      assertThat(count(statement, "SELECT COUNT(*) FROM role_permissions WHERE role_id=991159 AND permission_code='" + retained + "'")).isEqualTo(1);
      try (var rows = statement.executeQuery("SELECT function_permissions FROM roles WHERE id=991159 UNION ALL SELECT function_permissions FROM terminal_function_policies WHERE terminal='store'")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString(1)).isEqualTo(retained);
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString(1)).isEqualTo(retained);
      }
      assertThat(count(statement, "SELECT COUNT(*) FROM product_categories")).isEqualTo(categories);
      assertThat(count(statement, "SELECT COUNT(*) FROM suppliers")).isEqualTo(suppliers);
    }
  }

  private static int count(java.sql.Statement statement, String sql) throws Exception {
    try (var rows = statement.executeQuery(sql)) {
      rows.next();
      return rows.getInt(1);
    }
  }
}
