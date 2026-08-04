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
class CategoryAttributeApiTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_admin_category_attribute_test")
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
        "zdm.craft-image.storage-path",
        () -> System.getProperty("java.io.tmpdir") + "/zdm-category-attribute-images-smoke");
  }

  @Test
  void categoryAttributeCrudPersistsCreatorMetadataInDatabase() throws Exception {
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM category_attributes WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class)).isZero();

    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name)
        VALUES (9901, 'finished', '类目属性模板测试分类', 1, 0, 'enabled', '韩健')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status)
        VALUES (9901, 'shared', '类目属性模板测试属性', 'select', 'basic', 'enabled')
        """);

    String creatorName = jdbcTemplate.queryForObject(
        "SELECT display_name FROM accounts WHERE id = 1",
        String.class);
    MvcResult createdResult = mockMvc.perform(post("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9901,
                  "attributeId":9901,
                  "requiredFlag":true,
                  "skuFlag":false,
                  "sortOrder":1,
                  "status":"enabled",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    String categoryAttributeId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM category_attributes WHERE id = ?",
        String.class,
        categoryAttributeId)).isEqualTo(creatorName);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9901,
                  "attributeId":9901,
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":2,
                  "status":"disabled",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(get("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %s)].createdByName".formatted(categoryAttributeId))
            .value(hasItem(creatorName)));

    mockMvc.perform(delete("/api/admin/category-attributes/{id}", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM category_attributes WHERE id = ?",
        Integer.class,
        categoryAttributeId)).isZero();
  }
}
