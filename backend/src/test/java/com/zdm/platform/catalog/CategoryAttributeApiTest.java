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
        .andExpect(jsonPath("$.data.status").value("disabled"))
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
                  "status":"enabled",
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

  @Test
  void categoryAttributeModuleIgnoresSelfDataScopeAndSupportsBatchBinding() throws Exception {
    long accountId = 9920L;
    long employeeId = 9920L;
    long roleId = 9920L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629920",
        "模板绑定操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '模板绑定操作员', '15926629920', 'enabled', 'self', '韩健')
        """,
        employeeId,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')
        """,
        accountId,
        employeeId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '类目属性模板操作角色', 'CATEGORY_ATTRIBUTE_OPERATOR_TEST', 'operation-platform',
          'admin', 'self', 'enabled',
          'admin.product-data-center.category-attribute-template.view,'
          'admin.product-data-center.category-attribute-template.create,'
          'admin.product-data-center.category-attribute-template.edit,'
          'admin.product-data-center.category-attribute-template.delete', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name)
        VALUES (9920, 'finished', '数据权限豁免测试分类', 1, 0, 'enabled', '其他创建人')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status)
        VALUES
          (9920, 'shared', '已绑定测试属性', 'select', 'basic', 'enabled'),
          (9921, 'shared', '批量绑定属性一', 'select', 'basic', 'enabled'),
          (9922, 'finished', '批量绑定属性二', 'number', 'basic', 'enabled')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO category_attributes
          (category_id, attribute_id, required_flag, sku_flag, sort_order, status, created_by_name)
        VALUES (9920, 9920, 1, 0, 1, 'enabled', '其他绑定人')
        """);
    Long otherCreatorBindingId = jdbcTemplate.queryForObject(
        "SELECT id FROM category_attributes WHERE category_id = 9920 AND attribute_id = 9920",
        Long.class);
    String token = TokenAuthenticationFilter.createAccountToken(accountId);

    mockMvc.perform(get("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == %s)].createdByName".formatted(otherCreatorBindingId))
            .value(hasItem("其他绑定人")));

    mockMvc.perform(post("/api/admin/category-attributes/batch")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeIds":[9921,9922]
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(2))
        .andExpect(jsonPath("$.data[*].createdByName").value(hasItem("模板绑定操作员")))
        .andExpect(jsonPath("$.data[*].requiredFlag").value(hasItem(false)))
        .andExpect(jsonPath("$.data[*].skuFlag").value(hasItem(false)))
        .andExpect(jsonPath("$.data[0].status").value("disabled"))
        .andExpect(jsonPath("$.data[1].status").value("disabled"));

    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM category_attributes WHERE category_id = 9920",
        Integer.class)).isEqualTo(3);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9920,
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":1,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value("其他绑定人"))
        .andExpect(jsonPath("$.data.skuFlag").value(true));

    mockMvc.perform(delete("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }
}
