package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class TemplateRetirementMigrationTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("template_retirement_test");

  @Test
  void upgradePreservesAttributeSnapshotsAndRemovesSpecificationDependencies() throws Exception {
    Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword())
        .target("107").load().migrate();
    try (var connection = DriverManager.getConnection(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
        var statement = connection.createStatement()) {
      statement.executeUpdate("INSERT INTO product_categories(id, scope, name, status) VALUES(990001, 'finished', '迁移验证', 'enabled')");
      statement.executeUpdate("INSERT INTO category_template_versions(id, category_id, kind, version_no, state, content, created_by_name, published_by_name, published_at) VALUES(990001, 990001, 'attributes', 1, 'published', JSON_ARRAY(JSON_OBJECT('attributeId', 123, 'attributeRole', 'sales', 'sortOrder', 1)), '创建人', '发布人', '2026-09-09 10:00:00')");
      statement.executeUpdate("INSERT INTO category_template_versions(id, category_id, kind, state, content, created_by_name) VALUES(990002, 990001, 'attributes', 'draft', JSON_ARRAY(), '草稿创建人')");
      statement.executeUpdate("INSERT INTO category_template_versions(id, category_id, kind, attribute_version_id, version_no, state, content, created_by_name) VALUES(990003, 990001, 'sku', 990001, 1, 'published', JSON_ARRAY(123), '规格创建人')");
      statement.executeUpdate("INSERT INTO category_template_versions(id, category_id, kind, attribute_version_id, base_version_id, state, content, created_by_name) VALUES(990004, 990001, 'sku', 990001, 990003, 'draft', JSON_ARRAY(123), '规格草稿创建人')");
      String before;
      try (var rows = statement.executeQuery("SELECT CAST(JSON_OBJECT('content', content, 'creator', created_by_name, 'publisher', published_by_name, 'publishedAt', published_at, 'version', version_no, 'revision', revision) AS CHAR) FROM category_template_versions WHERE id = 990001")) {
        rows.next();
        before = rows.getString(1);
      }
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword()).load().migrate();
      try (var rows = statement.executeQuery("SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN ('category_attributes', 'category_attribute_value_bindings')")) {
        rows.next();
        assertThat(rows.getInt(1)).isZero();
      }

      try (var rows = statement.executeQuery("SELECT CAST(JSON_OBJECT('content', content, 'creator', created_by_name, 'publisher', published_by_name, 'publishedAt', published_at, 'version', version_no, 'revision', revision) AS CHAR) FROM category_template_versions WHERE id = 990001")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getString(1)).isEqualTo(before);
      }
      try (var rows = statement.executeQuery("SELECT id, state FROM category_template_versions WHERE category_id = 990001 ORDER BY id")) {
        assertThat(rows.next()).isTrue();
        assertThat(rows.getLong(1)).isEqualTo(990001);
        assertThat(rows.next()).isTrue();
        assertThat(rows.getLong(1)).isEqualTo(990002);
        assertThat(rows.getString(2)).isEqualTo("draft");
        assertThat(rows.next()).isFalse();
      }
    }
  }
}
