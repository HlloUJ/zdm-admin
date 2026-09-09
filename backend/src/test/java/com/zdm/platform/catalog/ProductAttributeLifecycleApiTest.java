package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.hasItem;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
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
import org.springframework.test.web.servlet.MvcResult;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class ProductAttributeLifecycleApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_attribute_lifecycle_test")
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
  void productAttributeAndValueCreationPersistsCreatorAndCreationTime() throws Exception {
    String creatorName = jdbcTemplate.queryForObject(
        """
        SELECT name
        FROM employees
        WHERE account_id = 1
          AND status = 'enabled'
        ORDER BY id DESC
        LIMIT 1
        """,
        String.class);
    String suffix = Long.toString(System.nanoTime());
    String token = TokenAuthenticationFilter.createAccountToken(1L);

    MvcResult attributeResult = mockMvc.perform(post("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"shared",
                  "name":"创建信息测试属性-%s",
                  "valueType":"select",
                  "attributeRole":"basic",
                  "status":"enabled",
                  "createdByName":"不应覆盖",
                  "createdByAccountId":999
                }
                """.formatted(suffix)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    String attributeId = com.jayway.jsonpath.JsonPath.read(
        attributeResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    MvcResult valueResult = mockMvc.perform(post("/api/admin/product-attribute-values")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "attributeId":%s,
                  "scope":"shared",
                  "value":"创建信息测试属性值-%s",
                  "code":"creator-metadata-%s",
                  "status":"enabled",
                  "createdByName":"不应覆盖",
                  "createdByAccountId":999
                }
                """.formatted(attributeId, suffix, suffix)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    String valueId = com.jayway.jsonpath.JsonPath.read(
        valueResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM product_attributes WHERE id = ?",
        String.class,
        Long.valueOf(attributeId))).isEqualTo(creatorName);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM product_attribute_values WHERE id = ?",
        String.class,
        Long.valueOf(valueId))).isEqualTo(creatorName);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_account_id FROM product_attributes WHERE id = ?",
        Long.class,
        Long.valueOf(attributeId))).isEqualTo(1L);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_account_id FROM product_attribute_values WHERE id = ?",
        Long.class,
        Long.valueOf(valueId))).isEqualTo(1L);

    mockMvc.perform(delete("/api/admin/product-attribute-values/{id}", valueId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", attributeId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("physical"));
  }

  @Test
  void productAttributeDeletionReturnsBusinessMessagesForExistingReferences() throws Exception {
    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name)
        VALUES (9880, 'finished', '属性删除保护测试分类', 1, 0, 'enabled', '韩健')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status)
        VALUES
          (9880, 'finished', '分类模板引用属性', 'text', 'basic', 'enabled'),
          (9881, 'finished', '属性值引用属性', 'select', 'basic', 'enabled'),
          (9882, 'finished', '无引用属性', 'text', 'basic', 'enabled'),
          (9883, 'finished', '未售完商品引用属性', 'text', 'basic', 'enabled'),
          (9884, 'finished', '已售完商品历史属性', 'select', 'basic', 'enabled')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO category_template_versions (category_id, content, created_by_name)
        VALUES (9880, JSON_ARRAY(JSON_OBJECT('attributeId', 9880, 'options', JSON_ARRAY())), '测试人员')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attribute_values
          (attribute_id, scope, value, code, status)
        VALUES
          (9881, 'finished', '物理删除属性值', 'attribute-physical-delete', 'enabled'),
          (9884, 'finished', '历史保留属性值', 'attribute-business-delete', 'enabled')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO finished_products
          (id, category_id, name, sku, total_stock, status)
        VALUES
          (9883, 9880, '未售完属性删除保护商品', 'ATTRIBUTE-DELETE-ACTIVE-9883', 1, 'warehouse'),
          (9884, 9880, '已售完属性业务删除商品', 'ATTRIBUTE-DELETE-SOLD-9884', 0, 'soldOut')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO finished_product_attribute_entries
          (finished_product_id, attribute_id, attribute_name, value)
        VALUES
          (9883, 9883, '未售完商品引用属性', '仍在使用'),
          (9884, 9884, '已售完商品历史属性', '历史快照')
        """);
    String token = TokenAuthenticationFilter.createAccountToken(1L);

    mockMvc.perform(delete("/api/admin/product-attributes/{id}", 9880)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message")
            .value("该属性已被分类属性模板使用，不能删除，请先前往“分类属性模板-成品现货模板tab”移除该属性。"));

    mockMvc.perform(delete("/api/admin/product-attributes/{id}", 9881)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("physical"))
        .andExpect(jsonPath("$.data.attributeValueCount").value(1));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attributes WHERE id = 9881",
        Integer.class)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attribute_values WHERE attribute_id = 9881",
        Integer.class)).isZero();

    mockMvc.perform(delete("/api/admin/product-attributes/{id}", 9882)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("physical"))
        .andExpect(jsonPath("$.data.attributeValueCount").value(0));

    mockMvc.perform(get("/api/admin/product-attributes/{id}/delete-preview", 9883)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("blocked"))
        .andExpect(jsonPath("$.data.unfinishedProductCount").value(1))
        .andExpect(jsonPath("$.data.message")
            .value("该属性仍被未售完商品使用，不能删除，请先处理关联商品。"));
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", 9883)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message")
            .value("该属性仍被未售完商品使用，不能删除，请先处理关联商品。"));

    mockMvc.perform(get("/api/admin/product-attributes/{id}/delete-preview", 9884)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("business"))
        .andExpect(jsonPath("$.data.soldOutProductCount").value(1))
        .andExpect(jsonPath("$.data.attributeValueCount").value(1));
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", 9884)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletionMode").value("business"))
        .andExpect(jsonPath("$.data.attributeValueCount").value(1));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attributes WHERE id = 9884 AND deleted_at IS NOT NULL",
        Integer.class)).isEqualTo(1);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attribute_values WHERE attribute_id = 9884 AND status = 'disabled'",
        Integer.class)).isEqualTo(1);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM finished_product_attribute_entries WHERE attribute_id = 9884",
        Integer.class)).isEqualTo(1);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 9884)]").isEmpty());
  }

}
