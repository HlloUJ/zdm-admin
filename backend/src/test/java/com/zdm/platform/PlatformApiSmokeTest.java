package com.zdm.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
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
import org.springframework.mock.web.MockMultipartFile;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class PlatformApiSmokeTest {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_admin_test")
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
        () -> System.getProperty("java.io.tmpdir") + "/zdm-craft-images-smoke");
  }

  @Test
  void flywayMigrationsSeedSuperAdmin() {
    Integer migrationCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1",
        Integer.class);
    Integer superAdminCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE phone = '15926626945' AND status = 'enabled'",
        Integer.class);
    Integer emptyTerminalPolicyCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM roles
        WHERE category = 'terminal-policy'
          AND code IN ('TERMINAL_STORE_POLICY', 'TERMINAL_SUPPLIER_POLICY')
          AND COALESCE(function_permissions, '') = ''
        """,
        Integer.class);
    Integer legacyReadPermissionCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM roles
        WHERE COALESCE(function_permissions, '') REGEXP '\\\\.(query|reset|查询|重置)(,|$)'
        """,
        Integer.class);
    String adminManagerPermissions = jdbcTemplate.queryForObject(
        "SELECT function_permissions FROM roles WHERE code = 'ADMIN_MANAGER'",
        String.class);
    Integer craftWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM crafts WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class);
    Integer categoryWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_categories WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class);
    Integer slabVarietyWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_varieties WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class);
    Integer sampleProductAttributeCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM product_attributes
        WHERE (id = 1 AND scope = 'shared' AND name = '材质')
          OR (id = 2 AND scope = 'finished' AND name = '尺寸')
          OR (id = 3 AND scope = 'accessory' AND name = '颜色')
        """,
        Integer.class);
    Integer productAttributeWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attributes WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class);
    Integer productAttributeGlobalUniqueIndexCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'product_attributes'
          AND index_name = 'uk_product_attributes_name'
          AND non_unique = 0
          AND column_name = 'name'
        """,
        Integer.class);
    Integer legacyProductAttributeUniqueIndexCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = 'product_attributes'
          AND index_name = 'uk_product_attributes_scope_name'
        """,
        Integer.class);

    assertThat(migrationCount).isGreaterThanOrEqualTo(33);
    assertThat(superAdminCount).isEqualTo(1);
    assertThat(emptyTerminalPolicyCount).isEqualTo(2);
    assertThat(legacyReadPermissionCount).isZero();
    assertThat(craftWithoutCreatorCount).isZero();
    assertThat(categoryWithoutCreatorCount).isZero();
    assertThat(slabVarietyWithoutCreatorCount).isZero();
    assertThat(sampleProductAttributeCount).isZero();
    assertThat(productAttributeWithoutCreatorCount).isZero();
    assertThat(productAttributeGlobalUniqueIndexCount).isEqualTo(1);
    assertThat(legacyProductAttributeUniqueIndexCount).isZero();
    assertThat(adminManagerPermissions)
        .contains("admin.permission-management.employee-management.view")
        .contains("admin.permission-management.role-management.view");
  }

  @Test
  void productAttributeCrudPersistsToDatabaseAndReturnsTemplateCount() throws Exception {
    String attributeName = "数据库直连属性-" + System.nanoTime();
    String creatorName = jdbcTemplate.queryForObject(
        "SELECT display_name FROM accounts WHERE id = 1",
        String.class);
    MvcResult createdResult = mockMvc.perform(post("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "scope":"accessory",
                  "name":"%s",
                  "valueType":"select",
                  "attributeRole":"basic",
                  "status":"enabled"
                }
                """.formatted(attributeName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    Integer attributeId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id");

    Integer persistedCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attributes WHERE id = ? AND name = ?",
        Integer.class,
        attributeId,
        attributeName);
    assertThat(persistedCount).isEqualTo(1);
    String persistedCreatorName = jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM product_attributes WHERE id = ?",
        String.class,
        attributeId);
    assertThat(persistedCreatorName).isEqualTo(creatorName);

    mockMvc.perform(post("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "scope":"shared",
                  "name":"  %s  ",
                  "valueType":"text",
                  "attributeRole":"basic",
                  "status":"enabled"
                }
                """.formatted(attributeName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("属性名称已存在"));

    jdbcTemplate.update(
        """
        INSERT INTO category_attributes
          (category_id, attribute_id, required_flag, sku_flag, sort_order, status)
        VALUES (4, ?, 0, 0, 1, 'enabled')
        """,
        attributeId);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].templateCount".formatted(attributeId),
            hasItem(1)));

    mockMvc.perform(patch("/api/admin/product-attributes/{id}/status", attributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "status":"disabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));
    String persistedName = jdbcTemplate.queryForObject(
        "SELECT name FROM product_attributes WHERE id = ?",
        String.class,
        attributeId);
    assertThat(persistedName).isEqualTo(attributeName);

    jdbcTemplate.update("DELETE FROM category_attributes WHERE attribute_id = ?", attributeId);
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", attributeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
    Integer deletedCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attributes WHERE id = ?",
        Integer.class,
        attributeId);
    assertThat(deletedCount).isZero();
  }

  @Test
  void productAttributeIgnoresDataScopeAndEnforcesOnlyFunctionPermissions() throws Exception {
    long accountId = 9061L;
    long employeeId = 9061L;
    long roleId = 9061L;
    long globalAttributeId = 9061L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629061",
        "属性库操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '属性库操作员', '15926629061', 'enabled', 'self', '韩健')
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
        VALUES (?, '属性库全局操作测试角色', 'ATTRIBUTE_GLOBAL_OPERATOR_TEST', 'operation-platform',
          'admin', 'self', 'enabled',
          'admin.product-data-center.attribute.view,'
          'admin.product-data-center.attribute.create,'
          'admin.product-data-center.attribute.toggle-status,'
          'admin.product-data-center.attribute.delete', '集成测试')
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
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status, created_by_name)
        VALUES (?, 'accessory', '其他管理员创建的全局属性', 'text', 'basic', 'enabled', '其他管理员')
        """,
        globalAttributeId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].createdByName".formatted(globalAttributeId),
            hasItem("其他管理员")));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"shared",
                  "name":"全局权限新增属性",
                  "valueType":"select",
                  "attributeRole":"basic",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andReturn();
    Integer createdAttributeId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id");

    mockMvc.perform(patch("/api/admin/product-attributes/{id}/status", createdAttributeId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", createdAttributeId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    jdbcTemplate.update(
        "UPDATE roles SET function_permissions = ? WHERE id = ?",
        "admin.product-data-center.attribute.view",
        roleId);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].id".formatted(globalAttributeId),
            hasItem((int) globalAttributeId)));
    mockMvc.perform(post("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"shared",
                  "name":"无新增权限属性",
                  "valueType":"text",
                  "attributeRole":"basic",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(patch("/api/admin/product-attributes/{id}/status", globalAttributeId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", globalAttributeId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
  }

  @Test
  void protectedAdminApiRequiresAuthentication() throws Exception {
    mockMvc.perform(get("/api/admin/tenants"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void productCategoryListIsNewestFirstAndPersistsCreator() throws Exception {
    String creatorName = jdbcTemplate.queryForObject(
        "SELECT display_name FROM accounts WHERE id = 1",
        String.class);
    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name, created_at)
        VALUES
          (9201, 'accessory', '排序测试旧分类', 1, 0, 'enabled', '韩健', '2026-01-01 09:00:00'),
          (9202, 'accessory', '排序测试新分类', 2, 0, 'enabled', '韩健', '2026-01-02 09:00:00')
        """);

    MvcResult listResult = mockMvc.perform(get("/api/admin/product-categories")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andReturn();
    java.util.List<Integer> categoryIds = com.jayway.jsonpath.JsonPath.read(
        listResult.getResponse().getContentAsString(),
        "$.data[*].id");
    assertThat(categoryIds.indexOf(9202)).isLessThan(categoryIds.indexOf(9201));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/product-categories")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "scope":"accessory",
                  "name":"创建人集成测试分类",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();
    String categoryId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/product-categories/{id}", categoryId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "scope":"accessory",
                  "name":"创建人集成测试分类-已编辑",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled",
                  "createdByName":"不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));

    mockMvc.perform(delete("/api/admin/product-categories/{id}", categoryId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void productCategoryManagementConsumesScopedTabActionPermissions() throws Exception {
    long accountId = 9021L;
    long employeeId = 9021L;
    long roleId = 9021L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629021",
        "成品分类操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '成品分类操作员', '15926629021', 'enabled', 'self', '韩健')
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
        VALUES (?, '成品分类操作角色', 'FINISHED_CATEGORY_OPERATOR_TEST', 'operation-platform',
          'admin', 'all', 'enabled',
          'admin.product-data-center.category.finished.view,'
          'admin.product-data-center.category.finished.create-root,'
          'admin.product-data-center.category.finished.disable,'
          'admin.product-data-center.category.finished.enable,'
          'admin.product-data-center.category.finished.delete', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/product-categories").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].scope", not(hasItem("accessory"))))
        .andExpect(jsonPath("$.data[*].createdByName", hasItem("韩健")));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/product-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"finished",
                  "name":"权限范围测试分类",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andReturn();
    String categoryId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(post("/api/admin/product-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "parentId":1,
                  "scope":"finished",
                  "name":"无权新增下级分类",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isForbidden());

    mockMvc.perform(put("/api/admin/product-categories/{id}", categoryId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"finished",
                  "name":"权限范围测试分类",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"disabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(put("/api/admin/product-categories/{id}", categoryId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "scope":"finished",
                  "name":"无权编辑分类名称",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"disabled"
                }
                """))
        .andExpect(status().isForbidden());

    mockMvc.perform(delete("/api/admin/product-categories/{id}", categoryId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void productCategoryRejectsDuplicateSiblingNamesAndCrossScopeParents() throws Exception {
    mockMvc.perform(post("/api/admin/product-categories")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "scope":"finished",
                  "name":" 家具 ",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("同级分类名称不能重复"));

    mockMvc.perform(post("/api/admin/product-categories")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "parentId":4,
                  "scope":"finished",
                  "name":"错误跨类型分类",
                  "sortOrder":1,
                  "productCount":0,
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("上级分类与当前分类类型不一致"));
  }

  @Test
  void productCategoryDeleteReturnsClearBusinessErrors() throws Exception {
    mockMvc.perform(delete("/api/admin/product-categories/1")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该分类包含下级分类，请先删除或转移下级分类"));

    mockMvc.perform(delete("/api/admin/product-categories/3")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该分类已关联商品，不能删除，请先停用该分类"));

    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name)
        VALUES (9203, 'finished', '模板引用删除测试分类', 1, 0, 'enabled', '韩健')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status, created_by_name)
        VALUES (9204, 'finished', '模板引用删除测试属性', 'select', 'basic', 'enabled', '韩健')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO category_attributes
          (category_id, attribute_id, required_flag, sku_flag, sort_order, status)
        VALUES (9203, 9204, 0, 0, 1, 'enabled')
        """);

    mockMvc.perform(delete("/api/admin/product-categories/9203")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该分类已配置发布属性模板，不能删除，请先移除模板配置"));
  }

  @Test
  void slabVarietyDeleteReturnsBusinessErrorWhenReferencedByInventory() throws Exception {
    mockMvc.perform(delete("/api/admin/slab-varieties/1")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value(400))
        .andExpect(jsonPath("$.message")
            .value("该品种已被大板库存引用，不能删除，请先停用该品种"));

    Integer pandoraCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_varieties WHERE id = 1 AND name = '潘多拉'",
        Integer.class);
    assertThat(pandoraCount).isEqualTo(1);
  }

  @Test
  void slabVarietyNameMustBeUniqueWhenCreatingAndEditing() throws Exception {
    mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":" 潘多拉 ",
                  "code":"duplicate-pandora",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("品种名称已存在"));

    String varietyName = "重名编辑测试品种-" + System.nanoTime();
    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "code":"duplicate-edit-test-%d",
                  "status":"enabled"
                }
                """.formatted(varietyName, System.nanoTime())))
        .andExpect(status().isOk())
        .andReturn();
    String varietyId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/slab-varieties/{id}", varietyId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":"潘多拉",
                  "code":"duplicate-edit-test-%d",
                  "status":"enabled"
                }
                """.formatted(System.nanoTime())))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("品种名称已存在"));

    mockMvc.perform(delete("/api/admin/slab-varieties/{id}", varietyId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk());
  }

  @Test
  void slabVarietyManagementPersistsCreatedByName() throws Exception {
    String varietyName = "创建人集成测试品种-" + System.nanoTime();
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

    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "code":"creator-test-%d",
                  "status":"enabled",
                  "createdByName":"不应覆盖"
                }
                """.formatted(varietyName, System.nanoTime())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();
    String varietyId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/slab-varieties/{id}", varietyId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "name":"%s-已编辑",
                  "code":"creator-test-updated-%d",
                  "status":"disabled",
                  "createdByName":"不应覆盖"
                }
                """.formatted(varietyName, System.nanoTime())))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("enabled"));

    mockMvc.perform(patch("/api/admin/slab-varieties/{id}/status", varietyId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(delete("/api/admin/slab-varieties/{id}", varietyId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void slabVarietyManagementAppliesSelfDataScopeToListsAndOperations() throws Exception {
    long accountId = 9031L;
    long employeeId = 9031L;
    long roleId = 9031L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629031",
        "大板品种自有操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '大板品种自有操作员', '15926629031', 'enabled', 'self', '韩健')
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
        VALUES (?, '大板品种自有操作角色', 'SLAB_VARIETY_SELF_TEST', 'operation-platform',
          'admin', 'self', 'enabled',
          'admin.product-data-center.slab-variety.view,'
          'admin.product-data-center.slab-variety.create,'
          'admin.product-data-center.slab-variety.edit,'
          'admin.product-data-center.slab-variety.toggle-status,'
          'admin.product-data-center.slab-variety.delete', '集成测试')
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
        INSERT INTO slab_varieties (id, name, code, status, created_by_name)
        VALUES
          (9031, '本人创建的大板品种', 'self-owned-variety', 'enabled', '大板品种自有操作员'),
          (9032, '他人创建的大板品种', 'other-owned-variety', 'enabled', '韩健')
        """);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/slab-varieties").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].name", hasItem("本人创建的大板品种")))
        .andExpect(jsonPath("$.data[*].name", not(hasItem("他人创建的大板品种"))));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"本人新增的大板品种",
                  "code":"self-created-variety",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value("大板品种自有操作员"))
        .andReturn();
    String createdVarietyId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/slab-varieties/9032")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"越权编辑的大板品种",
                  "code":"other-owned-variety",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(patch("/api/admin/slab-varieties/9032/status")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(delete("/api/admin/slab-varieties/9032")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
    mockMvc.perform(delete("/api/admin/slab-varieties/{id}", createdVarietyId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void slabVarietyManagementSeparatesEditAndStatusPermissions() throws Exception {
    long accountId = 9011L;
    long employeeId = 9011L;
    long roleId = 9011L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629011",
        "品种查看员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '品种查看员', '15926629011', 'enabled', 'all', '韩健')
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
        VALUES (?, '品种编辑角色', 'SLAB_VARIETY_EDITOR_TEST', 'operation-platform',
          'admin', 'all', 'enabled',
          'admin.product-data-center.slab-variety.view,admin.product-data-center.slab-variety.edit', '集成测试')
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
        INSERT INTO slab_varieties (id, name, code, status, created_by_name)
        VALUES (9011, '权限集成测试品种', 'permission-test-variety', 'enabled', '集成测试')
        """);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/slab-varieties").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"无权新增品种","code":"forbidden-create","status":"enabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(put("/api/admin/slab-varieties/9011")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"权限集成测试品种-已编辑","code":"permission-test-variety","status":"disabled"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("权限集成测试品种-已编辑"))
        .andExpect(jsonPath("$.data.status").value("enabled"));
    mockMvc.perform(patch("/api/admin/slab-varieties/9011/status")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isForbidden());

    jdbcTemplate.update(
        """
        UPDATE roles
        SET function_permissions = ?
        WHERE id = ?
        """,
        "admin.product-data-center.slab-variety.view,admin.product-data-center.slab-variety.toggle-status",
        roleId);
    mockMvc.perform(put("/api/admin/slab-varieties/9011")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"无权编辑品种","code":"pandora","status":"enabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(patch("/api/admin/slab-varieties/9011/status")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));
    mockMvc.perform(delete("/api/admin/slab-varieties/9011")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
  }

  @Test
  void superAdminCanLoginAndAccessTenantApi() throws Exception {
    MvcResult loginResult = mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926626945",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.token").isString())
        .andExpect(jsonPath("$.data.user.phone").value("15926626945"))
        .andReturn();

    String sessionToken = com.jayway.jsonpath.JsonPath.read(
        loginResult.getResponse().getContentAsString(),
        "$.data.token");
    assertThat(sessionToken).doesNotStartWith("dev-token");
    Integer storedSessionCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM auth_sessions WHERE token_hash <> ? AND CHAR_LENGTH(token_hash) = 64",
        Integer.class,
        sessionToken);
    assertThat(storedSessionCount).isGreaterThanOrEqualTo(1);

    mockMvc.perform(get("/api/admin/tenants")
            .header("Authorization", "Bearer " + sessionToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.length()", greaterThanOrEqualTo(1)));

    mockMvc.perform(post("/api/admin/auth/logout")
            .header("Authorization", "Bearer " + sessionToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    mockMvc.perform(get("/api/admin/tenants")
            .header("Authorization", "Bearer " + sessionToken))
        .andExpect(status().isUnauthorized());

    Integer logoutAuditCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM security_audit_logs
        WHERE account_id = 1
          AND request_method = 'POST'
          AND request_path = '/api/admin/auth/logout'
          AND result = 'success'
        """,
        Integer.class);
    assertThat(logoutAuditCount).isGreaterThanOrEqualTo(1);
  }

  @Test
  void ordinaryRoleWithoutPermissionCannotAccessTenantApi() throws Exception {
    long accountId = 9010L;
    long employeeId = 9010L;
    jdbcTemplate.update(
        """
        INSERT INTO accounts (id, phone, display_name, account_type, status)
        VALUES (?, '15900009010', '无租户权限员工', 'person', 'enabled')
        """,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '无租户权限员工', '15900009010', 'enabled', 'all', '韩健')
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
          (name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES ('无租户权限角色', 'NO_TENANT_PERMISSION_ROLE', 'operation-platform',
          'admin', 'all', 'enabled',
          'admin.permission-management.employee-management.view', '韩健')
        """);
    Long roleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'NO_TENANT_PERMISSION_ROLE'",
        Long.class);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    mockMvc.perform(get("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value(403));
  }

  @Test
  void craftManagementPersistsUploadedImageAndHandlesBusinessErrors() throws Exception {
    String craftName = "集成测试工艺-" + System.nanoTime();
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
    MockMultipartFile image = new MockMultipartFile(
        "file",
        "craft.png",
        "image/png",
        new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47});

    MvcResult uploadResult = mockMvc.perform(multipart("/api/admin/crafts/images")
            .file(image)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.url").isNotEmpty())
        .andReturn();
    String imageUrl = com.jayway.jsonpath.JsonPath.read(
        uploadResult.getResponse().getContentAsString(),
        "$.data.url");

    mockMvc.perform(get(imageUrl))
        .andExpect(status().isOk())
        .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers
            .content().contentType("image/png"));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/crafts")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "name": "%s",
                  "type": "边工艺",
                  "width": "12",
                  "imageUrl": "%s",
                  "remark": "新增备注",
                  "status": "enabled",
                  "createdByName": "不应覆盖"
                }
                """.formatted(craftName, imageUrl)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.imageUrl").value(imageUrl))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();
    String craftId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(post("/api/admin/crafts")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "%s",
                  "type": "边工艺",
                  "status": "enabled"
                }
                """.formatted(craftName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("工艺名称已存在"));

    mockMvc.perform(post("/api/admin/crafts")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "%s-非法宽度",
                  "type": "边工艺",
                  "width": "12mm",
                  "status": "enabled"
                }
                """.formatted(craftName)))
        .andExpect(status().isBadRequest());

    mockMvc.perform(put("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "%s",
                  "type": "面工艺",
                  "width": "18",
                  "imageUrl": "%s",
                  "remark": "编辑备注",
                  "status": "enabled",
                  "createdByName": "不应覆盖"
                }
                """.formatted(craftName, imageUrl)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.imageUrl").value(imageUrl))
        .andExpect(jsonPath("$.data.remark").value("编辑备注"))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));

    mockMvc.perform(patch("/api/admin/crafts/{id}/status", craftId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {"status": "disabled"}
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andExpect(jsonPath("$.data.imageUrl").value(imageUrl))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));

    mockMvc.perform(put("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "%s",
                  "type": "面工艺",
                  "remark": "%s",
                  "status": "disabled"
                }
                """.formatted(craftName, "测".repeat(101))))
        .andExpect(status().isBadRequest());

    mockMvc.perform(delete("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void craftManagementEnforcesViewAndOperationPermissions() throws Exception {
    long accountId = 9001L;
    long roleId = 9001L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629001",
        "工艺查看员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '工艺查看员', '15926629001', 'enabled', 'all', '韩健')
        """,
        accountId,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')
        """,
        accountId,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '工艺查看角色', 'CRAFT_VIEWER_TEST', 'operation-platform', 'admin', 'all', 'enabled', ?, '集成测试')
        """,
        roleId,
        "admin.product-data-center.finished-stock-craft.view");
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    Long craftId = jdbcTemplate.queryForObject("SELECT id FROM crafts ORDER BY id LIMIT 1", Long.class);

    mockMvc.perform(get("/api/admin/crafts").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/admin/crafts")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name": "无权新增工艺",
                  "type": "边工艺",
                  "status": "enabled"
                }
                """))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value(403));
    mockMvc.perform(put("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name": "无权编辑工艺",
                  "type": "边工艺",
                  "status": "enabled"
                }
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(patch("/api/admin/crafts/{id}/status", craftId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isForbidden());
    mockMvc.perform(delete("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
  }

  @Test
  void craftManagementAppliesCurrentEmployeeDataPermission() throws Exception {
    long accountId = 9003L;
    long employeeId = 9003L;
    long roleId = 9003L;
    String employeeName = "工艺范围测试员工";
    String ownCraftName = "本人创建的范围工艺-" + System.nanoTime();
    String otherCraftName = "他人创建的范围工艺-" + System.nanoTime();

    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, account_type, status) VALUES (?, '15900009003', ?, 'person', 'enabled')",
        accountId,
        employeeName);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, ?, '15900009003', 'enabled', 'self', '韩健')
        """,
        employeeId,
        accountId,
        employeeName);
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
        VALUES (?, '工艺范围测试角色', 'CRAFT_SCOPE_TEST', 'operation-platform', 'admin', 'all', 'enabled', ?, '集成测试')
        """,
        roleId,
        "admin.product-data-center.finished-stock-craft.view");
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);
    jdbcTemplate.update(
        "INSERT INTO crafts (name, type, status, created_by_name) VALUES (?, '边工艺', 'enabled', ?)",
        ownCraftName,
        employeeName);
    jdbcTemplate.update(
        "INSERT INTO crafts (name, type, status, created_by_name) VALUES (?, '边工艺', 'enabled', '韩健')",
        otherCraftName);

    mockMvc.perform(get("/api/admin/crafts")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.name == '%s')].createdByName".formatted(ownCraftName))
            .value(hasItem(employeeName)))
        .andExpect(jsonPath("$.data[?(@.name == '%s')]".formatted(otherCraftName)).isEmpty());

    mockMvc.perform(get("/api/admin/crafts")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.name == '%s')].createdByName".formatted(ownCraftName))
            .value(hasItem(employeeName)))
        .andExpect(jsonPath("$.data[?(@.name == '%s')].createdByName".formatted(otherCraftName))
            .value(hasItem("韩健")));
  }

  @Test
  void roleManagementUsesRealRolesAndCreatedByName() throws Exception {
    mockMvc.perform(get("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.code == 'SUPER_ADMIN')].createdByName").value(hasItem("韩健")))
        .andExpect(jsonPath("$.data[?(@.code == 'ADMIN_MANAGER')].createdByName").value(hasItem("韩健")))
        .andExpect(jsonPath("$.data[?(@.code == 'OPERATOR')].createdByName").value(hasItem("韩健")))
        .andExpect(jsonPath("$.data[?(@.status == 'enabled')].code").value(not(hasItem("CUSTOMER_SERVICE"))));

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
    MvcResult createdResult = mockMvc.perform(post("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L))
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试角色",
                  "code": "INTEGRATION_TEST_ROLE",
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "API smoke",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();

    String roleId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/roles/{id}", roleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试角色-已更新",
                  "code": "INTEGRATION_TEST_ROLE",
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "API smoke updated",
                  "functionPermissions": "",
                  "createdByName": "不应覆盖"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));

    jdbcTemplate.update(
        "INSERT INTO role_permissions (role_id, permission_code) VALUES (?, 'admin:role:manage')",
        Long.valueOf(roleId));
    long affectedAccountId = 9101L;
    long affectedEmployeeId = 9101L;
    Long companionRoleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'ADMIN_MANAGER'",
        Long.class);
    jdbcTemplate.update(
        """
        INSERT INTO accounts (id, phone, display_name, account_type, status)
        VALUES (?, '15900009101', '待停用角色用户', 'person', 'enabled')
        """,
        affectedAccountId);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '待停用角色用户', '15900009101', 'enabled', ?, 'all', '韩健')
        """,
        affectedEmployeeId,
        affectedAccountId,
        roleId + "," + companionRoleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')
        """,
        affectedAccountId,
        affectedEmployeeId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES
          (?, ?, 'admin', 1, 1),
          (?, ?, 'admin', 1, 1)
        """,
        affectedAccountId,
        Long.valueOf(roleId),
        affectedAccountId,
        companionRoleId);

    mockMvc.perform(delete("/api/admin/roles/{id}", roleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    Integer deletedRoleCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM roles WHERE id = ?",
        Integer.class,
        Long.valueOf(roleId));
    Integer deletedRolePermissionCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM role_permissions WHERE role_id = ?",
        Integer.class,
        Long.valueOf(roleId));
    Integer affectedAccountRoleCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM account_roles WHERE account_id = ? AND client_code = 'admin'",
        Integer.class,
        affectedAccountId);
    String affectedEmployeeStatus = jdbcTemplate.queryForObject(
        "SELECT status FROM employees WHERE id = ?",
        String.class,
        affectedEmployeeId);
    String affectedEmployeeRoleIds = jdbcTemplate.queryForObject(
        "SELECT role_ids FROM employees WHERE id = ?",
        String.class,
        affectedEmployeeId);
    String affectedIdentityStatus = jdbcTemplate.queryForObject(
        """
        SELECT status
        FROM account_identities
        WHERE account_id = ?
          AND client_code = 'admin'
          AND identity_type = 'employee'
          AND subject_id = ?
        """,
        String.class,
        affectedAccountId,
        affectedEmployeeId);
    String unifiedAccountStatus = jdbcTemplate.queryForObject(
        "SELECT status FROM accounts WHERE id = ?",
        String.class,
        affectedAccountId);

    assertThat(deletedRoleCount).isZero();
    assertThat(deletedRolePermissionCount).isZero();
    assertThat(affectedAccountRoleCount).isZero();
    assertThat(affectedEmployeeStatus).isEqualTo("disabled");
    assertThat(affectedEmployeeRoleIds).isNull();
    assertThat(affectedIdentityStatus).isEqualTo("disabled");
    assertThat(unifiedAccountStatus).isEqualTo("enabled");

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15900009101",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("账号不存在或已停用"));

    Integer companionRoleCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM roles WHERE id = ?",
        Integer.class,
        companionRoleId);
    assertThat(companionRoleCount).isEqualTo(1);

    mockMvc.perform(post("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试回退角色",
                  "code": "INTEGRATION_TEST_FALLBACK_ROLE",
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "API smoke fallback",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value(creatorName));
  }

  @Test
  void roleManagementAppliesCurrentEmployeeDataPermission() throws Exception {
    long accountId = 9002L;
    long employeeId = 9002L;
    String employeeName = "角色范围测试员工";

    jdbcTemplate.update(
        """
        INSERT INTO accounts (id, phone, display_name, account_type, status)
        VALUES (?, '15900009002', ?, 'person', 'enabled')
        """,
        accountId,
        employeeName);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, ?, '15900009002', 'enabled', 'self', '韩健')
        """,
        employeeId,
        accountId,
        employeeName);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')
        """,
        accountId,
        employeeId);
    Long adminManagerRoleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'ADMIN_MANAGER'",
        Long.class);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        adminManagerRoleId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES
          ('本人创建的范围角色', 'SELF_SCOPE_ROLE', 'operation-platform', 'admin', 'all', 'enabled', '', ?),
          ('他人创建的范围角色', 'OTHER_SCOPE_ROLE', 'operation-platform', 'admin', 'all', 'enabled', '', '韩健')
        """,
        employeeName);

    mockMvc.perform(get("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.code == 'SELF_SCOPE_ROLE')].name").value(hasItem("本人创建的范围角色")))
        .andExpect(jsonPath("$.data[?(@.code == 'OTHER_SCOPE_ROLE')]").isEmpty())
        .andExpect(jsonPath("$.data[?(@.code == 'SUPER_ADMIN')]").isEmpty());

    mockMvc.perform(get("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(1L)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.code == 'SELF_SCOPE_ROLE')].name").value(hasItem("本人创建的范围角色")))
        .andExpect(jsonPath("$.data[?(@.code == 'OTHER_SCOPE_ROLE')].name").value(hasItem("他人创建的范围角色")));
  }

  @Test
  void roleNameMustBeUniqueWithinItsCategory() throws Exception {
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (name, code, category, client_code, data_scope, status, remark, function_permissions)
        VALUES
          ('同名角色', 'DUPLICATE_NAME_OPERATION', 'operation-platform', 'admin', 'all', 'enabled', '', ''),
          ('同名角色', 'DUPLICATE_NAME_PARTNER', 'partner-store', 'store', 'store', 'enabled', '', ''),
          ('待重命名角色', 'ROLE_TO_RENAME', 'operation-platform', 'admin', 'all', 'enabled', '', '')
        """);

    mockMvc.perform(post("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": " 同名角色 ",
                  "code": "DUPLICATE_NAME_CREATE",
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("当前用户端已存在同名角色"));

    Long roleToRenameId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'ROLE_TO_RENAME'",
        Long.class);
    mockMvc.perform(put("/api/admin/roles/{id}", roleToRenameId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "同名角色",
                  "code": "ROLE_TO_RENAME",
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("当前用户端已存在同名角色"));

    Integer crossCategoryCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM roles WHERE name = '同名角色'",
        Integer.class);
    assertThat(crossCategoryCount).isEqualTo(2);
  }

  @Test
  void employeePermissionUpdateDoesNotRequireProfileEditPermission() throws Exception {
    long managerAccountId = 9041L;
    long managerEmployeeId = 9041L;
    long targetAccountId = 9042L;
    long targetEmployeeId = 9042L;
    long managerRoleId = 9041L;

    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        managerAccountId,
        "15926629041",
        "权限配置员");
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        targetAccountId,
        "15926629042",
        "待配置员工");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids,
           data_permission, created_by_name)
        VALUES
          (?, ?, 1, 1, '权限配置员', '15926629041', 'enabled', ?, 'self', '韩健'),
          (?, ?, 1, 1, '待配置员工', '15926629042', 'enabled', '2', 'all', '权限配置员')
        """,
        managerEmployeeId,
        managerAccountId,
        String.valueOf(managerRoleId),
        targetEmployeeId,
        targetAccountId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES
          (?, 'admin', 'employee', ?, 1, 1, 'enabled'),
          (?, 'admin', 'employee', ?, 1, 1, 'enabled')
        """,
        managerAccountId,
        managerEmployeeId,
        targetAccountId,
        targetEmployeeId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '员工权限配置测试角色', 'EMPLOYEE_PERMISSION_MANAGER_TEST', 'operation-platform',
          'admin', 'self', 'enabled',
          'admin.permission-management.employee-management.view,'
          'admin.permission-management.employee-management.permission', '集成测试')
        """,
        managerRoleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1), (?, 2, 'admin', 1, 1)
        """,
        managerAccountId,
        managerRoleId,
        targetAccountId);

    mockMvc.perform(patch("/api/admin/employees/{id}/permissions", targetEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "roleIds": "2",
                  "dataPermission": "self"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.roleIds").value("2"))
        .andExpect(jsonPath("$.data.dataPermission").value("self"))
        .andExpect(jsonPath("$.data.gender").doesNotExist())
        .andExpect(jsonPath("$.data.remark").doesNotExist());
  }

  @Test
  void employeeInviteRegistrationRequiresAdminActivation() throws Exception {
    MvcResult inviteResult = mockMvc.perform(post("/api/admin/employee-invites")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.token").isString())
        .andReturn();

    String token = com.jayway.jsonpath.JsonPath.read(
        inviteResult.getResponse().getContentAsString(),
        "$.data.token");

    mockMvc.perform(post("/api/open/employee-invites/{token}/request-code", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926626945"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该手机号已是当前组织员工"));

    mockMvc.perform(post("/api/open/employee-invites/{token}/request-code", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    mockMvc.perform(post("/api/open/employee-invites/{token}/verify-code", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "123456"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("验证码错误"));

    MvcResult registerResult = mockMvc.perform(post("/api/open/employee-invites/{token}/register", token)
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888",
                  "name": "待审核员工",
                  "gender": "male"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andReturn();

    String employeeId = com.jayway.jsonpath.JsonPath.read(
        registerResult.getResponse().getContentAsString(),
        "$.data.employeeId")
        .toString();

    mockMvc.perform(get("/api/admin/employees")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.phone == '15926629999')].createdByName").value(hasItem("韩健")));

    String createdByName = jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM employees WHERE id = ?",
        String.class,
        Long.valueOf(employeeId));
    assertThat(createdByName).isEqualTo("韩健");

    mockMvc.perform(get("/api/open/employee-invites/{token}", token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("邀请链接已使用"));

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isBadRequest());

    mockMvc.perform(put("/api/admin/employees/{id}", employeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "待审核员工",
                  "gender": "male",
                  "phone": "15926629999",
                  "status": "enabled",
                  "roleIds": "",
                  "dataPermission": "",
                  "remark": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请先为员工配置角色后再启用"));

    mockMvc.perform(put("/api/admin/employees/{id}", employeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "待审核员工",
                  "gender": "male",
                  "phone": "15926629999",
                  "status": "enabled",
                  "roleIds": "1",
                  "dataPermission": "all",
                  "remark": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("enabled"));

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.phone").value("15926629999"));
  }

  @Test
  void tenantCrudPersistsThroughApi() throws Exception {
    MvcResult createResult = mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试租户",
                  "contactName": "测试联系人",
                  "contactPhone": "15926626946",
                  "status": "enabled",
                  "businessTypes": "cityPartner",
                  "remark": "API smoke"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value(0))
        .andExpect(jsonPath("$.data.id").isNumber())
        .andReturn();

    String tenantId = com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();

    mockMvc.perform(put("/api/admin/tenants/{id}", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "集成测试租户-已更新",
                  "contactName": "测试联系人",
                  "contactPhone": "15926626946",
                  "status": "enabled",
                  "businessTypes": "cityPartner",
                  "remark": "API smoke updated"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("集成测试租户-已更新"));
  }

  @Test
  void tenantValidationReturnsBadRequest() throws Exception {
    mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "",
                  "contactName": "测试联系人",
                  "contactPhone": "123",
                  "status": "enabled"
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value(400));
  }
}
