package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.TokenAuthenticationFilter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class CategoryAttributeRoleGuardApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_admin_role_guard_test")
      .withUsername("zdm_admin")
      .withPassword("zdm_admin_pwd");

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private JdbcTemplate jdbcTemplate;

  @DynamicPropertySource
  static void registerDatasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add(
        "zdm.media.storage-path",
        () -> System.getProperty("java.io.tmpdir") + "/zdm-category-attribute-images-smoke");
  }

  @Test
  void locksUsedRolesByCategoryAndRetainsHistoryWhenUnpublished() throws Exception {
    jdbcTemplate.update("INSERT INTO product_categories (id, scope, name) VALUES (99601, 'finished', '角色保护'), (99602, 'finished', '其他分类')");
    jdbcTemplate.update("INSERT INTO product_attributes (id, scope, name, value_type, status) VALUES (99601, 'shared', '角色保护属性', 'input', 'enabled')");
    jdbcTemplate.update("INSERT INTO category_attributes (id, category_id, attribute_id, attribute_role) VALUES (99601, 99601, 99601, 'product'), (99602, 99602, 99601, 'product')");
    String token = "Bearer " + TokenAuthenticationFilter.createAccountToken(1L);
    String payload = """
        {"categoryId":99601,"attributeId":99601,"attributeRole":"sales","requiredFlag":false,"skuFlag":false}
        """;
    mockMvc.perform(put("/api/admin/category-attributes/99601").header("Authorization", token)
        .contentType("application/json").content(payload)).andExpect(status().isOk());
    mockMvc.perform(put("/api/admin/category-attributes/99601").header("Authorization", token)
        .contentType("application/json").content(payload.replace("sales", "")))
        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.message").value("请选择属性角色"));
    jdbcTemplate.update("INSERT INTO finished_products (id, category_id, name, sku, status) VALUES (99601, 99601, '使用中的商品', 'role-guard-test', 'soldOut')");
    jdbcTemplate.update("INSERT INTO finished_product_attribute_entries (finished_product_id, attribute_id, attribute_name, value) VALUES (99601, 99601, '角色保护属性', '原值')");
    mockMvc.perform(put("/api/admin/category-attributes/99601").header("Authorization", token)
        .contentType("application/json").content(payload.replace("sales", "product")))
        .andExpect(status().isBadRequest());
    mockMvc.perform(put("/api/admin/category-attributes/99602").header("Authorization", token)
        .contentType("application/json").content(payload.replace("\"categoryId\":99601", "\"categoryId\":99602")))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/category-attributes/99601").header("Authorization", token))
        .andExpect(status().isBadRequest());
    mockMvc.perform(put("/api/admin/category-attributes/99601/unpublish").header("Authorization", token))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.publishStatus").value("unpublished"))
        .andExpect(jsonPath("$.data.usageCount").value(1));
    mockMvc.perform(put("/api/admin/category-attributes/99601").header("Authorization", token)
        .contentType("application/json").content(payload.replace("sales", "product")))
        .andExpect(status().isBadRequest());
    assertThat(jdbcTemplate.queryForObject("SELECT value FROM finished_product_attribute_entries WHERE finished_product_id = 99601", String.class)).isEqualTo("原值");
    assertThat(jdbcTemplate.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'category_attributes' AND column_name = 'retired_flag'", Integer.class)).isZero();
    assertThat(jdbcTemplate.queryForObject("SELECT status FROM product_attributes WHERE id = 99601", String.class)).isEqualTo("enabled");
  }

  @Test
  void detectsSalesAttributeUsage() throws Exception {
    jdbcTemplate.update("INSERT INTO product_categories (id, scope, name) VALUES (99611, 'finished', '销售角色保护')");
    jdbcTemplate.update("INSERT INTO product_attributes (id, scope, name, value_type, status) VALUES (99611, 'shared', '销售保护属性', 'input', 'enabled')");
    jdbcTemplate.update("INSERT INTO category_attributes (id, category_id, attribute_id, attribute_role) VALUES (99611, 99611, 99611, 'sales')");
    jdbcTemplate.update("INSERT INTO finished_products (id, category_id, name, sku) VALUES (99611, 99611, '销售测试商品', 'sales-role-guard-test')");
    jdbcTemplate.update("INSERT INTO finished_product_variants (finished_product_id, variant_key, variant_label, sales_attributes) VALUES (99611, 'one', '规格', ?)", "{\"attribute_99611\":\"大号\"}");
    mockMvc.perform(put("/api/admin/category-attributes/99611")
        .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
        .contentType("application/json").content("{\"categoryId\":99611,\"attributeId\":99611,\"attributeRole\":\"product\"}"))
        .andExpect(status().isBadRequest());
  }

}
