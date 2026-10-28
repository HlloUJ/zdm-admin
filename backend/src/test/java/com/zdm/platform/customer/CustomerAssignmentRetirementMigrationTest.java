package com.zdm.platform.customer;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class CustomerAssignmentRetirementMigrationTest {
  @Container
  private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("customer_assignment_retirement_test");

  @Test
  void removesExactRetiredGrantsWithoutGrantingEditOrChangingCustomerData() throws Exception {
    Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
        .target("161").load().migrate();
    try (var connection = DriverManager.getConnection(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
        var statement = connection.createStatement()) {
      String daily = "store.customer-management.daily.assign";
      String archived = "store.customer-management.archived.assign";
      String retained = "store.customer-management.daily.batch-assign,store.customer-management.archived.batch-assign,store.customer-management.daily.edit,other.module.assign";
      int customers = count(statement, "SELECT COUNT(*) FROM store_customers");
      int accounts = count(statement, "SELECT COUNT(*) FROM accounts");
      statement.executeUpdate("INSERT INTO roles(id,name,code,client_code,created_by_account_id,function_permissions) VALUES(991162,'保留角色','customer-retire-keep','admin',1,'" + daily + "," + archived + "," + daily + "," + retained + "'),(991163,'清空角色','customer-retire-empty','admin',1,'" + daily + "," + archived + "')");
      statement.executeUpdate("INSERT INTO permissions(code,client_code,name,module) VALUES('" + daily + "','admin','退役一','customer-retire'),('" + archived + "','admin','退役二','customer-retire'),('other.module.assign','admin','保留','customer-retire')");
      statement.executeUpdate("INSERT INTO role_permissions(role_id,permission_code) VALUES(991162,'" + daily + "'),(991162,'" + archived + "'),(991162,'other.module.assign')");
      statement.executeUpdate("UPDATE terminal_function_policies SET function_permissions='" + retained + "," + daily + "," + archived + "' WHERE terminal='store'");
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
          .target("162").load().migrate();
      assertThat(value(statement, "SELECT function_permissions FROM roles WHERE id=991162")).isEqualTo(retained);
      assertThat(value(statement, "SELECT function_permissions FROM roles WHERE id=991163")).isEmpty();
      assertThat(value(statement, "SELECT function_permissions FROM terminal_function_policies WHERE terminal='store'")).isEqualTo(retained);
      assertThat(count(statement, "SELECT COUNT(*) FROM permissions WHERE code IN ('" + daily + "','" + archived + "')")).isZero();
      assertThat(count(statement, "SELECT COUNT(*) FROM role_permissions WHERE role_id=991162")).isEqualTo(1);
      assertThat(count(statement, "SELECT COUNT(*) FROM store_customers")).isEqualTo(customers);
      assertThat(count(statement, "SELECT COUNT(*) FROM accounts")).isEqualTo(accounts);
    }
  }

  private static int count(java.sql.Statement statement, String sql) throws Exception {
    return Integer.parseInt(value(statement, sql));
  }

  private static String value(java.sql.Statement statement, String sql) throws Exception {
    try (var rows = statement.executeQuery(sql)) {
      rows.next();
      return rows.getString(1);
    }
  }
}
