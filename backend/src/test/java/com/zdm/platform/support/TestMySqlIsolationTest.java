package com.zdm.platform.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.DriverManager;
import org.junit.jupiter.api.Test;

class TestMySqlIsolationTest {
  @Test
  void databasesAccountsAndTransactionsRemainIsolated() throws Exception {
    try (var first = MySqlTestDatabase.create().withDatabaseName("same_name").withUsername("test").withPassword("test");
        var second = MySqlTestDatabase.create().withDatabaseName("same_name").withUsername("test").withPassword("test")) {
      if ("schema".equals(System.getProperty("zdm.test.mysql.mode", "schema"))) {
        assertThatThrownBy(() -> MySqlTestDatabase.create().withEnv("MYSQL_SQL_MODE", "custom"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> MySqlTestDatabase.create().withCommand("mysqld", "--custom"))
            .isInstanceOf(UnsupportedOperationException.class);
      }
      first.start(); second.start();
      try (var a = DriverManager.getConnection(first.getJdbcUrl(), first.getUsername(), first.getPassword());
          var b = DriverManager.getConnection(second.getJdbcUrl(), second.getUsername(), second.getPassword());
          var statement = a.createStatement(); var other = b.createStatement()) {
        statement.execute("CREATE TABLE isolation_marker(id INT PRIMARY KEY)");
        a.setAutoCommit(false);
        statement.executeUpdate("INSERT INTO isolation_marker VALUES(1)");
        a.rollback();
        try (var rows = statement.executeQuery("SELECT COUNT(*) FROM isolation_marker")) {
          assertThat(rows.next()).isTrue(); assertThat(rows.getInt(1)).isZero();
        }
        assertThatThrownBy(() -> other.executeQuery("SELECT * FROM isolation_marker"))
            .isInstanceOf(java.sql.SQLException.class);
        if ("schema".equals(System.getProperty("zdm.test.mysql.mode", "schema"))) {
          assertThat(first.getContainerId()).isEqualTo(second.getContainerId());
          assertThat(first.getDatabaseName()).isNotEqualTo(second.getDatabaseName());
          assertThat(first.getUsername()).isNotEqualTo(second.getUsername());
          assertThatThrownBy(() -> other.executeQuery("SELECT * FROM `" + first.getDatabaseName() + "`.isolation_marker"))
              .isInstanceOf(java.sql.SQLException.class);
        } else { assertThat(first.getContainerId()).isNotEqualTo(second.getContainerId()); }
      }
    }
  }
}
