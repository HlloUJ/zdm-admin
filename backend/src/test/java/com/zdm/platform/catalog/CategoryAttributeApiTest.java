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
        .andExpect(status().isOk());
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
    jdbcTemplate.update(
        """
        INSERT INTO product_attribute_values
          (id, attribute_id, scope, value, code, status)
        VALUES
          (9901, 9901, 'shared', '测试选项一', 'category-template-option-1', 'enabled'),
          (9902, 9901, 'shared', '测试选项二', 'category-template-option-2', 'disabled')
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
                  "publishStatus":"published",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andExpect(jsonPath("$.data.publishStatus").value("unpublished"))
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
    assertThat(jdbcTemplate.queryForObject(
        "SELECT publish_status FROM category_attributes WHERE id = ?",
        String.class,
        categoryAttributeId)).isEqualTo("unpublished");

    mockMvc.perform(put("/api/admin/category-attributes/{id}", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9901,
                  "attributeId":9901,
                  "attributeRole":"sales",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":2,
                  "status":"enabled",
                  "publishStatus":"published",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.attributeRole").value("sales"))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andExpect(jsonPath("$.data.publishStatus").value("unpublished"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先绑定选项值"));

    mockMvc.perform(get("/api/admin/category-attributes/{id}/values", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(1))
        .andExpect(jsonPath("$.data[0].selected").value(false));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/values", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {"valueIds":[9902]}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("只能绑定该属性下已启用的选项值"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/values", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {"valueIds":[9901]}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].selected").value(true));

    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == 9901)].templateCount")
            .value(hasItem(1)));
    mockMvc.perform(get("/api/admin/product-attribute-values")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == 9901)].useCount")
            .value(hasItem(1)));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.publishStatus").value("published"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/values", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {"valueIds":[9901]}
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先取消发布后再修改属性配置"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9901,
                  "attributeId":9901,
                  "attributeRole":"product",
                  "requiredFlag":false,
                  "skuFlag":false,
                  "sortOrder":2,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先取消发布后再修改属性配置"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/unpublish", categoryAttributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.publishStatus").value("unpublished"));

    mockMvc.perform(get("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %s)].createdByName".formatted(categoryAttributeId))
            .value(hasItem(creatorName)))
        .andExpect(jsonPath(
            "$.data[?(@.id == %s)].optionCount".formatted(categoryAttributeId))
            .value(hasItem(1)));

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
  void categoryAllowsAtMostFourSkuAttributes() throws Exception {
    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name)
        VALUES (9930, 'finished', 'SKU属性上限测试分类', 1, 0, 'enabled', '韩健')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status)
        VALUES
          (9930, 'shared', 'SKU属性一', 'select', 'basic', 'enabled'),
          (9931, 'shared', 'SKU属性二', 'select', 'basic', 'enabled'),
          (9932, 'shared', 'SKU属性三', 'select', 'basic', 'enabled'),
          (9933, 'shared', 'SKU属性四', 'select', 'basic', 'enabled'),
          (9934, 'shared', 'SKU属性五', 'select', 'basic', 'enabled')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO category_attributes
          (category_id, attribute_id, attribute_role, required_flag, sku_flag, sort_order, status, created_by_name)
        VALUES
          (9930, 9930, 'sales', 0, 1, 1, 'enabled', '韩健'),
          (9930, 9931, 'sales', 0, 1, 2, 'enabled', '韩健'),
          (9930, 9932, 'sales', 0, 1, 3, 'enabled', '韩健'),
          (9930, 9933, 'sales', 0, 1, 4, 'enabled', '韩健')
        """);
    String token = TokenAuthenticationFilter.createAccountToken(1L);

    mockMvc.perform(post("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9930,
                  "attributeId":9934,
                  "attributeRole":"product",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":5,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("只有销售属性才能参与SKU组合"));

    mockMvc.perform(post("/api/admin/category-attributes")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9930,
                  "attributeId":9934,
                  "attributeRole":"sales",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":5,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("参与SKU组合的属性最多只能开启4个"));

    jdbcTemplate.update(
        """
        INSERT INTO category_attributes
          (category_id, attribute_id, required_flag, sku_flag, sort_order, status, created_by_name,
           created_by_account_id)
        VALUES (9930, 9934, 0, 0, 5, 'enabled', '超级管理员', 1)
        """);
    Long fifthBindingId = jdbcTemplate.queryForObject(
        "SELECT id FROM category_attributes WHERE category_id = 9930 AND attribute_id = 9934",
        Long.class);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", fifthBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9930,
                  "attributeId":9934,
                  "attributeRole":"sales",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":5,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("参与SKU组合的属性最多只能开启4个"));

    assertThat(jdbcTemplate.queryForObject(
        "SELECT sku_flag FROM category_attributes WHERE id = ?",
        Boolean.class,
        fifthBindingId)).isFalse();
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
        VALUES (?, ?, NULL, NULL, '模板绑定操作员', '15926629920', 'enabled', 'self', '韩健')
        """,
        employeeId,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, NULL, NULL, 'enabled')
        """,
        accountId,
        employeeId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '类目属性模板操作角色', 'CATEGORY_ATTRIBUTE_OPERATOR_TEST', 'self', 'enabled',
          'admin.product-data-center.category-attribute-template.finished.view,'
          'admin.product-data-center.category-attribute-template.finished.create,'
          'admin.product-data-center.category-attribute-template.finished.delete', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', NULL, NULL)
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
        INSERT INTO product_attribute_values
          (id, attribute_id, scope, value, code, status)
        VALUES (9921, 9921, 'shared', '批量绑定选项', 'batch-binding-option', 'enabled')
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
        .andExpect(jsonPath("$.data[1].status").value("disabled"))
        .andExpect(jsonPath("$.data[0].publishStatus").value("unpublished"))
        .andExpect(jsonPath("$.data[1].publishStatus").value("unpublished"));

    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM category_attributes WHERE category_id = 9920",
        Integer.class)).isEqualTo(3);

    Long batchBindingId = jdbcTemplate.queryForObject(
        "SELECT id FROM category_attributes WHERE category_id = 9920 AND attribute_id = 9921",
        Long.class);
    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = CONCAT(function_permissions,
          ',admin.product-data-center.category-attribute-template.finished.toggle-publish')
        WHERE id = ?
        """,
        roleId);

    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先选择属性角色"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}", batchBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9921,
                  "attributeRole":"product",
                  "requiredFlag":false,
                  "skuFlag":false,
                  "sortOrder":2,
                  "status":"disabled"
                }
                """))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = CONCAT(function_permissions,
          ',admin.product-data-center.category-attribute-template.finished.attribute-role')
        WHERE id = ?
        """,
        roleId);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", batchBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9921,
                  "attributeRole":"product",
                  "requiredFlag":false,
                  "skuFlag":false,
                  "sortOrder":2,
                  "status":"disabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.attributeRole").value("product"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先绑定选项值"));

    mockMvc.perform(get("/api/admin/category-attributes/{id}/values", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].selected").value(false));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/values", batchBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"valueIds":[9921]}
                """))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = CONCAT(function_permissions,
          ',admin.product-data-center.category-attribute-template.finished.bind-values')
        WHERE id = ?
        """,
        roleId);

    mockMvc.perform(put("/api/admin/category-attributes/{id}/values", batchBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"valueIds":[9921]}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[0].selected").value(true));

    mockMvc.perform(put("/api/admin/category-attributes/{id}/publish", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.publishStatus").value("published"));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT publish_status FROM category_attributes WHERE id = ?",
        String.class,
        batchBindingId)).isEqualTo("published");

    mockMvc.perform(put("/api/admin/category-attributes/{id}/unpublish", batchBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.publishStatus").value("unpublished"));

    mockMvc.perform(put("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9920,
                  "attributeRole":"sales",
                  "requiredFlag":true,
                  "skuFlag":true,
                  "sortOrder":1,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = CONCAT(function_permissions,
          ',admin.product-data-center.category-attribute-template.finished.sku-combination')
        WHERE id = ?
        """,
        roleId);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9920,
                  "attributeRole":"sales",
                  "requiredFlag":true,
                  "skuFlag":true,
                  "sortOrder":1,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.skuFlag").value(true));

    mockMvc.perform(put("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9920,
                  "attributeRole":"sales",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":1,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = CONCAT(function_permissions,
          ',admin.product-data-center.category-attribute-template.finished.required')
        WHERE id = ?
        """,
        roleId);

    mockMvc.perform(put("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "categoryId":9920,
                  "attributeId":9920,
                  "attributeRole":"sales",
                  "requiredFlag":false,
                  "skuFlag":true,
                  "sortOrder":1,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.requiredFlag").value(false));

    mockMvc.perform(delete("/api/admin/category-attributes/{id}", otherCreatorBindingId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }
}
