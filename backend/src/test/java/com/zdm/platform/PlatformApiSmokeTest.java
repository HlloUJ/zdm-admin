package com.zdm.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.containsString;
import static org.hamcrest.Matchers.greaterThanOrEqualTo;
import static org.hamcrest.Matchers.hasItem;
import static org.hamcrest.Matchers.not;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.TokenAuthenticationFilter;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
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
  private static final Path MEDIA_ROOT = Path.of(
      System.getProperty("java.io.tmpdir"), "zdm-media-smoke-" + UUID.randomUUID());

  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_admin_test")
      .withUsername("zdm_admin")
      .withPassword("zdm_admin_pwd");

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private JdbcTemplate jdbcTemplate;

  @BeforeEach
  void exposeAllTerminalFunctionsWithinEachPermissionTest() {
    jdbcTemplate.update(
        "UPDATE terminal_function_policies SET function_permissions = 'all' WHERE terminal IN ('store', 'supplier')");
  }

  @DynamicPropertySource
  static void registerDatasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add(
        "zdm.media.storage-path",
        MEDIA_ROOT::toString);
  }

  @Test
  void expiredTemporaryMediaIsCleanedAndAudited() throws Exception {
    MockMultipartFile image = new MockMultipartFile(
        "file",
        "temporary.png",
        "image/png",
        new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47});
    MvcResult uploadResult = mockMvc.perform(multipart("/api/admin/crafts/images")
            .file(image)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andReturn();
    Integer mediaId = com.jayway.jsonpath.JsonPath.read(
        uploadResult.getResponse().getContentAsString(), "$.data.id");
    String mediaUrl = com.jayway.jsonpath.JsonPath.read(
        uploadResult.getResponse().getContentAsString(), "$.data.url");
    jdbcTemplate.update(
        "UPDATE media_assets SET created_at = DATE_SUB(NOW(), INTERVAL 2 DAY) WHERE id = ?",
        mediaId);

    mockMvc.perform(post("/api/admin/media/cleanup")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.deletedCount", greaterThanOrEqualTo(1)));
    mockMvc.perform(get(mediaUrl)).andExpect(status().is4xxClientError());
    mockMvc.perform(get("/api/admin/media/audit")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.unregisteredPhysicalFiles.length()").value(0))
        .andExpect(jsonPath("$.data.missingPhysicalFiles.length()").value(0));
  }

  @Test
  void slabMediaCanBeUploadedAndRead() throws Exception {
    MockMultipartFile image = new MockMultipartFile(
        "file",
        "slab-main.png",
        "image/png",
        new byte[] {(byte) 0x89, 0x50, 0x4e, 0x47});

    MvcResult uploadResult = mockMvc.perform(multipart("/api/admin/slabs/images")
            .file(image)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.url", containsString("/api/open/media/")))
        .andReturn();
    String imageUrl = com.jayway.jsonpath.JsonPath.read(
        uploadResult.getResponse().getContentAsString(), "$.data.url");

    mockMvc.perform(get(imageUrl))
        .andExpect(status().isOk());

    MockMultipartFile video = new MockMultipartFile(
        "file",
        "slab-video.mp4",
        "video/mp4",
        new byte[] {0x00, 0x00, 0x00, 0x18});
    MvcResult videoUploadResult = mockMvc.perform(multipart("/api/admin/slabs/images")
            .file(video)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.url", containsString("/api/open/media/")))
        .andReturn();
    String videoUrl = com.jayway.jsonpath.JsonPath.read(
        videoUploadResult.getResponse().getContentAsString(), "$.data.url");

    mockMvc.perform(get(videoUrl))
        .andExpect(status().isOk())
        .andExpect(header().string("Content-Type", "video/mp4"));
  }

  @Test
  void flywayMigrationsSeedSuperAdmin() {
    Integer migrationCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM flyway_schema_history WHERE success = 1",
        Integer.class);
    Integer superAdminCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE phone = '15926626945' AND status = 'enabled'",
        Integer.class);
    Integer allTerminalPolicyCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM terminal_function_policies
        WHERE terminal IN ('store', 'supplier')
          AND function_permissions = 'all'
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
    Integer productAttributeValueWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM product_attribute_values WHERE created_by_name IS NULL OR created_by_name = ''",
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
    Integer sampleSupplierCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM suppliers WHERE id IN (1, 2) AND remark = '系统内置供应商'",
        Integer.class);
    Integer sampleSupplierBusinessRecordCount = jdbcTemplate.queryForObject(
        """
        SELECT
          (SELECT COUNT(*) FROM slab_inventory WHERE serial_no = 'SLAB-A001')
          + (SELECT COUNT(*) FROM finished_products WHERE sku = 'FP-PANDORA-TABLE-1800')
        """,
        Integer.class);
    Integer legacyOrderTableCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'platform_orders'
        """,
        Integer.class);
    Integer removedLegacyRoleColumnCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'roles'
          AND column_name IN ('category', 'client_code', 'store_scope_key')
        """,
        Integer.class);
    Integer scopedRoleColumnCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'roles'
          AND column_name IN ('tenant_id', 'store_id', 'role_scope_key')
        """,
        Integer.class);
    Integer legacyRolePermissionCodeCount = jdbcTemplate.queryForObject(
        """
        SELECT
          (SELECT COUNT(*) FROM roles
           WHERE function_permissions REGEXP 'role-management[.](operation-platform|partner-store|supplier-store)[.]')
          + (SELECT COUNT(*) FROM terminal_function_policies
             WHERE function_permissions REGEXP 'role-management[.](operation-platform|partner-store|supplier-store)[.]')
        """,
        Integer.class);
    Integer incorrectlyScopedPlatformIdentityCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM account_identities WHERE identity_type = 'platform_admin' AND (tenant_id IS NOT NULL OR store_id IS NOT NULL)",
        Integer.class);
    Integer tenantBusinessCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenant_businesses WHERE tenant_id = 1 AND business_type = 'cityPartner'",
        Integer.class);
    Integer tenantWithoutCreatorCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenants WHERE created_by_name IS NULL OR created_by_name = ''",
        Integer.class);

    assertThat(migrationCount).isGreaterThanOrEqualTo(58);
    assertThat(superAdminCount).isEqualTo(1);
    assertThat(allTerminalPolicyCount).isEqualTo(2);
    assertThat(legacyReadPermissionCount).isZero();
    assertThat(craftWithoutCreatorCount).isZero();
    assertThat(categoryWithoutCreatorCount).isZero();
    assertThat(slabVarietyWithoutCreatorCount).isZero();
    assertThat(sampleProductAttributeCount).isZero();
    assertThat(productAttributeWithoutCreatorCount).isZero();
    assertThat(productAttributeValueWithoutCreatorCount).isZero();
    assertThat(productAttributeGlobalUniqueIndexCount).isEqualTo(1);
    assertThat(legacyProductAttributeUniqueIndexCount).isZero();
    assertThat(sampleSupplierCount).isZero();
    assertThat(sampleSupplierBusinessRecordCount).isZero();
    assertThat(legacyOrderTableCount).isZero();
    assertThat(removedLegacyRoleColumnCount).isZero();
    assertThat(scopedRoleColumnCount).isEqualTo(3);
    assertThat(legacyRolePermissionCodeCount).isZero();
    assertThat(incorrectlyScopedPlatformIdentityCount).isZero();
    assertThat(tenantBusinessCount).isEqualTo(1);
    assertThat(tenantWithoutCreatorCount).isZero();
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
  void productAttributeValueCrudIgnoresDataScopeAndTracksCreator() throws Exception {
    long accountId = 9071L;
    long employeeId = 9071L;
    long roleId = 9071L;
    long attributeId = 9071L;
    long otherValueId = 9071L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629071",
        "属性值操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '属性值操作员', '15926629071', 'enabled', 'self', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '属性值全局操作测试角色', 'ATTRIBUTE_VALUE_GLOBAL_OPERATOR_TEST', 'all', 'enabled',
          'admin.product-data-center.attribute-value.shared.view,'
          'admin.product-data-center.attribute-value.shared.create,'
          'admin.product-data-center.attribute-value.shared.toggle-status,'
          'admin.product-data-center.attribute-value.shared.delete', '集成测试')
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
        VALUES (?, 'shared', '属性值全量查询测试属性', 'select', 'basic', 'enabled', '其他管理员')
        """,
        attributeId);
    jdbcTemplate.update(
        """
        INSERT INTO product_attribute_values
          (id, attribute_id, scope, value, code, status, created_by_name)
        VALUES (?, ?, 'shared', '其他管理员维护的属性值', 'other-admin-value', 'enabled', '其他管理员')
        """,
        otherValueId,
        attributeId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/product-attribute-values")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].createdByName".formatted(otherValueId),
            hasItem("其他管理员")));

    mockMvc.perform(get("/api/admin/product-attribute-values/attribute-options")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].name".formatted(attributeId),
            hasItem("属性值全量查询测试属性")));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/product-attribute-values")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "attributeId":%d,
                  "scope":"shared",
                  "value":"当前账号维护的属性值",
                  "code":"current-admin-value",
                  "status":"enabled"
                }
                """.formatted(attributeId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.createdByName").value("属性值操作员"))
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    Integer createdValueId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id");
    String persistedCreatorName = jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM product_attribute_values WHERE id = ?",
        String.class,
        createdValueId);
    assertThat(persistedCreatorName).isEqualTo("属性值操作员");

    mockMvc.perform(patch("/api/admin/product-attribute-values/{id}/status", createdValueId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "status":"disabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"))
        .andExpect(jsonPath("$.data.createdByName").value("属性值操作员"));

    mockMvc.perform(delete("/api/admin/product-attribute-values/{id}", createdValueId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void productAttributeIgnoresDataScopeAndEnforcesTabFunctionPermissions() throws Exception {
    long accountId = 9061L;
    long employeeId = 9061L;
    long roleId = 9061L;
    long accessoryAttributeId = 9061L;
    long sharedAttributeId = 9062L;
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '属性库全局操作测试角色', 'ATTRIBUTE_GLOBAL_OPERATOR_TEST', 'all', 'enabled',
          'admin.product-data-center.attribute.shared.view,'
          'admin.product-data-center.attribute.shared.create,'
          'admin.product-data-center.attribute.shared.toggle-status,'
          'admin.product-data-center.attribute.shared.delete,'
          'admin.product-data-center.attribute.accessory.view', '集成测试')
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
        VALUES (?, 'accessory', '其他管理员创建的配件属性', 'text', 'basic', 'enabled', '其他管理员')
        """,
        accessoryAttributeId);
    jdbcTemplate.update(
        """
        INSERT INTO product_attributes
          (id, scope, name, value_type, attribute_role, status, created_by_name)
        VALUES (?, 'shared', '其他管理员创建的共享属性', 'text', 'basic', 'enabled', '其他管理员')
        """,
        sharedAttributeId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].createdByName".formatted(accessoryAttributeId),
            hasItem("其他管理员")))
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].createdByName".formatted(sharedAttributeId),
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
        "admin.product-data-center.attribute.accessory.view",
        roleId);
    mockMvc.perform(get("/api/admin/product-attributes")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].id".formatted(accessoryAttributeId),
            hasItem((int) accessoryAttributeId)))
        .andExpect(jsonPath(
            "$.data[?(@.id == %d)].id".formatted(sharedAttributeId),
            not(hasItem((int) sharedAttributeId))));
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
    mockMvc.perform(patch("/api/admin/product-attributes/{id}/status", accessoryAttributeId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(delete("/api/admin/product-attributes/{id}", accessoryAttributeId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden());
  }

  @Test
  void protectedAdminApiRequiresAuthentication() throws Exception {
    mockMvc.perform(get("/api/admin/tenants"))
        .andExpect(status().isUnauthorized());
  }

  @Test
  void supplierCrudPersistsThroughApi() throws Exception {
    String suffix = Long.toString(System.nanoTime());
    String supplierName = "数据库集成测试供应商-" + suffix;
    String token = TokenAuthenticationFilter.DEV_TOKEN;
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

    MvcResult createdResult = mockMvc.perform(post("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "supplyTypeIds":[1],
                  "contactName":"测试联系人",
                  "contactPhone":"13900009999",
                  "qualificationStatus":"approved",
                  "createdByName":"不应覆盖",
                  "remark":"数据库写入验证",
                  "status":"enabled"
                }
                """.formatted(supplierName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.id").isNumber())
        .andExpect(jsonPath("$.data.name").value(supplierName))
        .andExpect(jsonPath("$.data.ownerScope").value("platform"))
        .andExpect(jsonPath("$.data.supplyTypes[0].code").value("slab"))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();
    long supplierId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM suppliers WHERE id = ? AND name = ? AND status = 'enabled'",
        Integer.class,
        supplierId,
        supplierName)).isEqualTo(1);

    mockMvc.perform(put("/api/admin/suppliers/{id}", supplierId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "supplyTypeIds":[1,2],
                  "contactName":"更新联系人",
                  "contactPhone":"13800009999",
                  "qualificationStatus":"approved",
                  "createdByName":"仍不应覆盖",
                  "remark":"数据库更新验证",
                  "status":"disabled"
                }
                """.formatted(supplierName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.supplyTypes.length()").value(2))
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andExpect(jsonPath("$.data.status").value("enabled"));

    mockMvc.perform(patch("/api/admin/suppliers/{id}/status", supplierId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "status":"disabled"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(get("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == %d)].remark".formatted(supplierId))
            .value(hasItem("数据库更新验证")));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM suppliers WHERE id = ? AND owner_scope = 'platform' AND owner_id = 0 AND status = 'disabled'",
        Integer.class,
        supplierId)).isEqualTo(1);

    mockMvc.perform(delete("/api/admin/suppliers/{id}", supplierId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM suppliers WHERE id = ?",
        Integer.class,
        supplierId)).isZero();
  }

  @Test
  void supplierDeleteReturnsBusinessErrorsWhenReferenced() throws Exception {
    jdbcTemplate.update(
        """
        INSERT INTO suppliers
          (id, owner_scope, owner_id, name, status, created_by_account_id)
        VALUES
          (9220, 'platform', 0, '大板引用删除测试供应商', 'enabled', 1),
          (9221, 'platform', 0, '成品引用删除测试供应商', 'enabled', 1)
        """);
    jdbcTemplate.update(
        """
        INSERT INTO slab_inventory
          (id, supplier_id, name, serial_no, status)
        VALUES (9220, 9220, '供应商删除保护测试库存', 'SUPPLIER-DELETE-GUARD-9220', 'warehouse')
        """);
    jdbcTemplate.update(
        """
        INSERT INTO finished_products
          (id, supplier_id, name, sku, total_stock, status)
        VALUES (9221, 9221, '供应商删除保护测试成品', 'SUPPLIER-DELETE-GUARD-9221', 0, 'warehouse')
        """);

    try {
      mockMvc.perform(delete("/api/admin/suppliers/9220")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message")
              .value("该供应商已关联大板库存，不能删除，请先停用该供应商"));
      mockMvc.perform(delete("/api/admin/suppliers/9221")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message")
              .value("该供应商已关联成品，不能删除，请先停用该供应商"));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM suppliers WHERE id IN (9220, 9221)",
          Integer.class)).isEqualTo(2);
    } finally {
      jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = 9220");
      jdbcTemplate.update("DELETE FROM finished_products WHERE id = 9221");
      jdbcTemplate.update("DELETE FROM suppliers WHERE id IN (9220, 9221)");
    }
  }

  @Test
  void supplierNameMustBeUniqueWhenCreatingAndEditing() throws Exception {
    String suffix = Long.toString(System.nanoTime());
    String existingName = "供应商重名校验-" + suffix;
    String otherName = "供应商重名编辑-" + suffix;
    String token = TokenAuthenticationFilter.DEV_TOKEN;

    MvcResult existingResult = mockMvc.perform(post("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"%s","supplyTypeIds":[1],"status":"enabled"}
                """.formatted(existingName)))
        .andExpect(status().isOk())
        .andReturn();
    long existingId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        existingResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    mockMvc.perform(post("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":" %s ","supplyTypeIds":[2],"status":"enabled"}
                """.formatted(existingName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("供应商名称已存在"));

    MvcResult otherResult = mockMvc.perform(post("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"%s","supplyTypeIds":[2],"status":"enabled"}
                """.formatted(otherName)))
        .andExpect(status().isOk())
        .andReturn();
    long otherId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        otherResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    try {
      mockMvc.perform(put("/api/admin/suppliers/{id}", otherId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[2],"status":"enabled"}
                  """.formatted(existingName)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("供应商名称已存在"));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM suppliers WHERE name = ?",
          Integer.class,
          existingName)).isEqualTo(1);
    } finally {
      jdbcTemplate.update("DELETE FROM suppliers WHERE id IN (?, ?)", existingId, otherId);
    }
  }

  @Test
  void supplierManagementSeparatesEditAndStatusPermissions() throws Exception {
    long accountId = 9081L;
    long employeeId = 9081L;
    long roleId = 9081L;
    long supplierId = 9260L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629081",
        "供应商权限测试员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '供应商权限测试员', '15926629081', 'enabled', 'all', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '供应商编辑测试角色', 'SUPPLIER_EDIT_TEST', 'all', 'enabled',
          'admin.supplier-management.view,admin.supplier-management.edit', '集成测试')
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
        INSERT INTO suppliers
          (id, owner_scope, owner_id, tenant_id, store_id, name, status,
           created_by_name, created_by_account_id, created_at)
        VALUES
          (?, 'store', 1, 1, 1, '供应商权限集成测试', 'enabled', '供应商权限测试员', ?, '2098-01-01 00:00:00'),
          (9261, 'store', 1, 1, 1, '供应商排序集成测试', 'enabled', '集成测试', NULL, '2099-01-01 00:00:00')
        """,
        supplierId,
        accountId);
    jdbcTemplate.update(
        "INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (?, 1), (9261, 2)",
        supplierId);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/suppliers")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[0].id").value(9261))
          .andExpect(jsonPath("$.data[1].id").value(supplierId));
      mockMvc.perform(put("/api/admin/suppliers/{id}", supplierId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"供应商权限集成测试-已编辑","supplyTypeIds":[2],"status":"disabled"}
                  """))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.name").value("供应商权限集成测试-已编辑"))
          .andExpect(jsonPath("$.data.status").value("enabled"));
      mockMvc.perform(patch("/api/admin/suppliers/{id}/status", supplierId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"status":"disabled"}
                  """))
          .andExpect(status().isForbidden());

      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.supplier-management.view,admin.supplier-management.toggle-status",
          roleId);
      mockMvc.perform(put("/api/admin/suppliers/{id}", supplierId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"无权编辑供应商","supplyTypeIds":[1],"status":"enabled"}
                  """))
          .andExpect(status().isForbidden());
      mockMvc.perform(patch("/api/admin/suppliers/{id}/status", supplierId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"status":"disabled"}
                  """))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));

      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.supplier-management.view,admin.supplier-management.create,admin.supplier-management.delete",
          roleId);
      MvcResult createdResult = mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"自有数据权限新增供应商","supplyTypeIds":[3],"status":"enabled"}
                  """))
          .andExpect(status().isOk())
          .andReturn();
      long createdSupplierId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
          createdResult.getResponse().getContentAsString(),
          "$.data.id").toString());
      mockMvc.perform(delete("/api/admin/suppliers/{id}", createdSupplierId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM suppliers WHERE id IN (?, 9261) OR name = '自有数据权限新增供应商'", supplierId);
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ? AND role_id = ?", accountId, roleId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void supplierDataIsIsolatedByCurrentStoreOrganization() throws Exception {
    long firstStoreId = 98991L;
    long secondStoreId = 98992L;
    String permissions = "admin.supplier-management.view,admin.supplier-management.create,"
        + "admin.supplier-management.edit,admin.supplier-management.delete";
    String firstToken = createStoreScopedEmployee(
        firstStoreId, "15926628991", "供应商隔离甲", permissions);
    String secondToken = createStoreScopedEmployee(
        secondStoreId, "15926628992", "供应商隔离乙", permissions);
    String supplierName = "跨组织可重名供应商-" + System.nanoTime();

    try {
      MvcResult firstResult = mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + firstToken)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[1,3],"status":"enabled"}
                  """.formatted(supplierName)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.storeId").value(firstStoreId))
          .andReturn();
      long firstSupplierId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
          firstResult.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + firstToken)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[2],"status":"enabled"}
                  """.formatted(supplierName)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("供应商名称已存在"));

      MvcResult secondResult = mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + secondToken)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[2],"status":"enabled"}
                  """.formatted(supplierName)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.storeId").value(secondStoreId))
          .andReturn();
      long secondSupplierId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
          secondResult.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(get("/api/admin/suppliers")
              .header("Authorization", "Bearer " + firstToken))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.length()").value(1))
          .andExpect(jsonPath("$.data[0].id").value(firstSupplierId));
      mockMvc.perform(get("/api/admin/suppliers")
              .header("Authorization", "Bearer " + secondToken))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.length()").value(1))
          .andExpect(jsonPath("$.data[0].id").value(secondSupplierId));
      mockMvc.perform(put("/api/admin/suppliers/{id}", secondSupplierId)
              .header("Authorization", "Bearer " + firstToken)
              .contentType("application/json")
              .content("""
                  {"name":"越权修改供应商","supplyTypeIds":[1],"status":"enabled"}
                  """))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("供应商不存在或无权访问"));
    } finally {
      jdbcTemplate.update("DELETE FROM suppliers WHERE store_id IN (?, ?)", firstStoreId, secondStoreId);
      cleanupStoreScopedEmployee(firstStoreId);
      cleanupStoreScopedEmployee(secondStoreId);
    }
  }

  @Test
  void supplierSelfDataPermissionFiltersListsAndMutations() throws Exception {
    long storeId = 98994L;
    String token = createStoreScopedEmployee(
        storeId,
        "15926628994",
        "供应商本人范围",
        "admin.supplier-management.view,admin.supplier-management.create,admin.supplier-management.edit");
    jdbcTemplate.update("UPDATE employees SET data_permission = 'self' WHERE id = ?", storeId);
    String ownName = "本人供应商-" + System.nanoTime();
    long otherSupplierId = 989940L;

    try {
      mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[1],"status":"enabled"}
                  """.formatted(ownName)))
          .andExpect(status().isOk());
      jdbcTemplate.update(
          """
          INSERT INTO suppliers
            (id, owner_scope, owner_id, tenant_id, store_id, name, status, created_by_account_id)
          VALUES (?, 'store', ?, 1, ?, '其他人供应商', 'enabled', 1)
          """,
          otherSupplierId,
          storeId,
          storeId);
      jdbcTemplate.update(
          "INSERT INTO supplier_supply_type_links (supplier_id, supply_type_id) VALUES (?, 1)",
          otherSupplierId);

      mockMvc.perform(get("/api/admin/suppliers")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.length()").value(1))
          .andExpect(jsonPath("$.data[0].name").value(ownName));
      mockMvc.perform(put("/api/admin/suppliers/{id}", otherSupplierId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"name":"越权本人数据","supplyTypeIds":[1],"status":"enabled"}
                  """))
          .andExpect(status().isForbidden());
    } finally {
      jdbcTemplate.update("DELETE FROM suppliers WHERE store_id = ?", storeId);
      cleanupStoreScopedEmployee(storeId);
    }
  }

  @Test
  void supplyTypeConfigurationIsPlatformOnlyAndReferenceSafe() throws Exception {
    String typeName = "供货类型配置测试-" + System.nanoTime();
    String supplierName = "供货类型引用测试-" + System.nanoTime();
    long storeId = 98993L;
    String storeToken = createStoreScopedEmployee(
        storeId,
        "15926628993",
        "供货类型越权",
        "admin.supplier-management.view,admin.supplier-management.manage-supply-types");
    Long createdTypeId = null;
    Long supplierId = null;

    try {
      MvcResult result = mockMvc.perform(post("/api/admin/supplier-supply-types")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"name":"%s"}
                  """.formatted(typeName)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.name").value(typeName))
          .andExpect(jsonPath("$.data.status").value("enabled"))
          .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
          .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
          .andReturn();
      createdTypeId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
          result.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(get("/api/admin/supplier-supply-types")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[0].id").value(createdTypeId))
          .andExpect(jsonPath("$.data[0].referenced").value(false))
          .andExpect(jsonPath("$.data[0].createdAt").isNotEmpty());

      mockMvc.perform(patch("/api/admin/supplier-supply-types/{id}/status", createdTypeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"status\":\"disabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));
      mockMvc.perform(post("/api/admin/supplier-supply-types")
              .header("Authorization", "Bearer " + storeToken)
              .contentType("application/json")
              .content("{\"name\":\"门店越权类型\"}"))
          .andExpect(status().isForbidden())
          .andExpect(jsonPath("$.message").value("仅运营平台可以配置供货类型"));

      mockMvc.perform(patch("/api/admin/supplier-supply-types/{id}/status", createdTypeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"status\":\"enabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("enabled"));

      MvcResult supplierResult = mockMvc.perform(post("/api/admin/suppliers")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"name":"%s","supplyTypeIds":[%d],"status":"enabled"}
                  """.formatted(supplierName, createdTypeId)))
          .andExpect(status().isOk())
          .andReturn();
      supplierId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
          supplierResult.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(get("/api/admin/supplier-supply-types")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[0].id").value(createdTypeId))
          .andExpect(jsonPath("$.data[0].referenced").value(true));

      mockMvc.perform(delete("/api/admin/supplier-supply-types/{id}", createdTypeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("供货类型“" + typeName + "”已被供应商使用，无法删除"));

      mockMvc.perform(delete("/api/admin/suppliers/{id}", supplierId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk());
      supplierId = null;

      mockMvc.perform(delete("/api/admin/supplier-supply-types/{id}", createdTypeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      createdTypeId = null;
    } finally {
      if (supplierId != null) {
        jdbcTemplate.update("DELETE FROM suppliers WHERE id = ?", supplierId);
      }
      if (createdTypeId != null) {
        jdbcTemplate.update("DELETE FROM supplier_supply_types WHERE id = ?", createdTypeId);
      }
      cleanupStoreScopedEmployee(storeId);
    }
  }

  @Test
  void storeCategoryCrudAndOrderingPersistInDatabase() throws Exception {
    String suffix = Long.toString(System.nanoTime() % 1_000_000);
    String token = createStoreScopedEmployee(
        98001L,
        "15926628001",
        "门店分类测试员",
        "admin.tenant.store-category-management.view,"
            + "admin.tenant.store-category-management.create-root,"
            + "admin.tenant.store-category-management.create-child,"
            + "admin.tenant.store-category-management.edit,"
            + "admin.tenant.store-category-management.move-up,"
            + "admin.tenant.store-category-management.move-down,"
            + "admin.tenant.store-category-management.toggle-status,"
            + "admin.tenant.store-category-management.delete");

    MvcResult firstRootResult = mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"门店一级分类甲-%s",
                  "status":"enabled"
                }
                """.formatted(suffix)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sortOrder").value(1))
        .andExpect(jsonPath("$.data.createdByName").isNotEmpty())
        .andExpect(jsonPath("$.data.createdAt").isNotEmpty())
        .andReturn();
    long firstRootId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        firstRootResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    MvcResult secondRootResult = mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"门店一级分类乙-%s",
                  "status":"enabled"
                }
                """.formatted(suffix)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sortOrder").value(1))
        .andReturn();
    long secondRootId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        secondRootResult.getResponse().getContentAsString(),
        "$.data.id").toString());
    assertThat(jdbcTemplate.queryForObject(
        "SELECT sort_order FROM store_categories WHERE id = ?",
        Integer.class,
        firstRootId)).isEqualTo(2);

    MvcResult childResult = mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "parentId":%d,
                  "name":"门店二级分类-%s",
                  "status":"enabled"
                }
                """.formatted(firstRootId, suffix)))
        .andExpect(status().isOk())
        .andReturn();
    long childId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        childResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    MvcResult listResult = mockMvc.perform(get("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andReturn();
    java.util.List<Integer> categoryIds = com.jayway.jsonpath.JsonPath.read(
        listResult.getResponse().getContentAsString(),
        "$.data[*].id");
    assertThat(categoryIds.indexOf(Math.toIntExact(secondRootId)))
        .isLessThan(categoryIds.indexOf(Math.toIntExact(firstRootId)));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE created_by_name IS NOT NULL AND created_at IS NOT NULL",
        Integer.class)).isEqualTo(3);

    MvcResult grandchildResult = mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "parentId":%d,
                  "name":"门店三级分类-%s",
                  "status":"enabled"
                }
                """.formatted(childId, suffix)))
        .andExpect(status().isOk())
        .andReturn();
    long grandchildId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        grandchildResult.getResponse().getContentAsString(),
        "$.data.id").toString());

    mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "parentId":%d,
                  "name":"门店四级分类-%s",
                  "status":"enabled"
                }
                """.formatted(grandchildId, suffix)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("门店分类最多支持三级"));

    mockMvc.perform(post("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "parentId":%d,
                  "name":" 门店二级分类-%s ",
                  "status":"enabled"
                }
                """.formatted(firstRootId, suffix)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("同级分类名称不能重复"));

    mockMvc.perform(put("/api/admin/store-categories/{id}", firstRootId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"门店一级分类甲-已编辑-%s"}
                """.formatted(suffix)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("门店一级分类甲-已编辑-" + suffix));

    mockMvc.perform(put("/api/admin/store-categories/{id}/move", secondRootId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("{\"direction\":\"down\"}"))
        .andExpect(status().isOk());
    assertThat(jdbcTemplate.queryForObject(
        "SELECT sort_order FROM store_categories WHERE id = ?",
        Integer.class,
        secondRootId)).isEqualTo(2);
    MvcResult movedListResult = mockMvc.perform(get("/api/admin/store-categories")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andReturn();
    java.util.List<Integer> movedCategoryIds = com.jayway.jsonpath.JsonPath.read(
        movedListResult.getResponse().getContentAsString(),
        "$.data[*].id");
    assertThat(movedCategoryIds.indexOf(Math.toIntExact(firstRootId)))
        .isLessThan(movedCategoryIds.indexOf(Math.toIntExact(secondRootId)));

    mockMvc.perform(put("/api/admin/store-categories/{id}/status", firstRootId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk());
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM store_categories WHERE id = ?",
        String.class,
        childId)).isEqualTo("disabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM store_categories WHERE id = ?",
        String.class,
        grandchildId)).isEqualTo("disabled");

    mockMvc.perform(put("/api/admin/store-categories/{id}/status", firstRootId)
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("{\"status\":\"enabled\"}"))
        .andExpect(status().isOk());
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM store_categories WHERE id = ?",
        String.class,
        childId)).isEqualTo("enabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM store_categories WHERE id = ?",
        String.class,
        grandchildId)).isEqualTo("enabled");

    mockMvc.perform(delete("/api/admin/store-categories/{id}", firstRootId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该分类包含下级分类，请先删除或转移下级分类"));

    mockMvc.perform(delete("/api/admin/store-categories/{id}", childId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该分类包含下级分类，请先删除或转移下级分类"));
    mockMvc.perform(delete("/api/admin/store-categories/{id}", grandchildId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/store-categories/{id}", childId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/store-categories/{id}", firstRootId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/store-categories/{id}", secondRootId)
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE name LIKE ?",
        Integer.class,
        "%" + suffix + "%")).isZero();
  }

  @Test
  void storeCategoryIsSharedWithinStoreAndIsolatedAcrossStores() throws Exception {
    long accountId = 9022L;
    long employeeId = 9022L;
    long roleId = 9022L;
    long storeId = 9022L;
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status) VALUES (?, 1, '门店分类隔离测试门店', 'partner', 'enabled')",
        storeId);
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629022",
        "门店分类查看员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, ?, '门店分类查看员', '15926629022', 'enabled', 'self', '韩健')
        """,
        employeeId,
        accountId,
        storeId);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, ?, 'enabled')
        """,
        accountId,
        employeeId,
        storeId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, tenant_id, store_id, name, code, data_scope, status,
           function_permissions, created_by_name)
        VALUES (?, 1, ?, '门店分类查看角色', 'STORE_CATEGORY_VIEWER_TEST', 'store', 'enabled',
          'admin.tenant.store-category-management.view,admin.tenant.store-category-management.edit', '集成测试')
        """,
        roleId,
        storeId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, ?)
        """,
        accountId,
        roleId,
        storeId);
    jdbcTemplate.update(
        """
        INSERT INTO store_categories
          (id, store_id, name, sort_order, product_count, status, created_by_name)
        VALUES
          (9301, 1, '同名门店分类', 1, 0, 'enabled', '韩健'),
          (9302, ?, '同名门店分类', 1, 0, 'enabled', '张飞')
        """,
        storeId);

    try {
      mockMvc.perform(get("/api/admin/store-categories")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.length()").value(1))
          .andExpect(jsonPath("$.data[0].id").value(9302));
      mockMvc.perform(put("/api/admin/store-categories/{id}", 9301)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId))
              .contentType("application/json")
              .content("{\"name\":\"跨门店修改\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("分类不存在或已被删除"));
    } finally {
      jdbcTemplate.update("DELETE FROM store_categories WHERE id IN (9301, 9302)");
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
      jdbcTemplate.update("DELETE FROM stores WHERE id = ?", storeId);
    }
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '成品分类操作角色', 'FINISHED_CATEGORY_OPERATOR_TEST', 'all', 'enabled',
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

    jdbcTemplate.update(
        """
        INSERT INTO finished_products
          (id, category_id, name, sku, total_stock, status)
        VALUES (9210, 3, '分类删除保护测试商品', 'CATEGORY-DELETE-GUARD-9210', 0, 'warehouse')
        """);
    try {
      mockMvc.perform(delete("/api/admin/product-categories/3")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("该分类已关联商品，不能删除，请先停用该分类"));
    } finally {
      jdbcTemplate.update("DELETE FROM finished_products WHERE id = 9210");
    }

    jdbcTemplate.update(
        """
        INSERT INTO product_categories
          (id, scope, name, sort_order, product_count, status, created_by_name,
           created_by_account_id)
        VALUES (9203, 'finished', '模板引用删除测试分类', 1, 0, 'enabled', '超级管理员', 1)
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
    jdbcTemplate.update(
        """
        INSERT INTO slab_inventory
          (id, variety_id, name, serial_no, status)
        VALUES (9211, 1, '品种删除保护测试库存', 'VARIETY-DELETE-GUARD-9211', 'warehouse')
        """);
    try {
      mockMvc.perform(delete("/api/admin/slab-varieties/1")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.code").value(400))
          .andExpect(jsonPath("$.message")
              .value("该品种已被大板库存引用，不能删除，请先停用该品种"));
    } finally {
      jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = 9211");
    }

    Integer pandoraCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_varieties WHERE id = 1 AND name = '潘多拉'",
        Integer.class);
    assertThat(pandoraCount).isEqualTo(1);
  }

  @Test
  void slabTextureAndAliasLifecycleWork() throws Exception {
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_textures WHERE name IN ('细纹', '直纹', '乱纹', '山水纹', '晶体纹')",
        Integer.class)).isEqualTo(5);

    String textureName = "纹理集成测试-" + System.nanoTime();
    MvcResult textureResult = mockMvc.perform(post("/api/admin/slab-textures")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {"name":"%s","status":"enabled","remark":"新增"}
                """.formatted(textureName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value(textureName))
        .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
        .andReturn();
    String textureId = com.jayway.jsonpath.JsonPath.read(
        textureResult.getResponse().getContentAsString(), "$.data.id").toString();

    MvcResult aliasResult = mockMvc.perform(post("/api/admin/slab-textures/{id}/aliases", textureId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"集成别名\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("集成别名"))
        .andReturn();
    String aliasId = com.jayway.jsonpath.JsonPath.read(
        aliasResult.getResponse().getContentAsString(), "$.data.id").toString();

    mockMvc.perform(get("/api/admin/slab-textures/{id}/aliases", textureId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].name", hasItem("集成别名")));
    mockMvc.perform(put("/api/admin/slab-textures/{id}/aliases/{aliasId}", textureId, aliasId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"集成别名已编辑\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("集成别名已编辑"));
    mockMvc.perform(post("/api/admin/slab-textures/{id}/aliases", textureId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"细纹\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("别名已存在或与标准纹理重复"));

    mockMvc.perform(delete("/api/admin/slab-textures/{id}", textureId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_texture_aliases WHERE id = ?", Integer.class, Long.valueOf(aliasId)))
        .isZero();
  }

  @Test
  void slabColorAndCategoryLifecycleWork() throws Exception {
    String categoryName = "测试白色系-" + System.nanoTime();
    String colorName = "测试奶白-" + System.nanoTime();

    MvcResult categoryResult = mockMvc.perform(post("/api/admin/slab-colors/categories")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"" + categoryName + "\",\"remark\":\"集成测试\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value(categoryName))
        .andReturn();
    String categoryId = com.jayway.jsonpath.JsonPath.read(
        categoryResult.getResponse().getContentAsString(), "$.data.id").toString();

    MvcResult colorResult = mockMvc.perform(post("/api/admin/slab-colors")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"" + colorName + "\",\"categoryId\":" + categoryId
                + ",\"status\":\"enabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value(colorName))
        .andExpect(jsonPath("$.data.categoryName").value(categoryName))
        .andReturn();
    String colorId = com.jayway.jsonpath.JsonPath.read(
        colorResult.getResponse().getContentAsString(), "$.data.id").toString();

    mockMvc.perform(get("/api/admin/slab-colors")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].name", hasItem(colorName)))
        .andExpect(jsonPath("$.data[*].categoryName", hasItem(categoryName)));

    mockMvc.perform(delete("/api/admin/slab-colors/categories/{id}", categoryId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该色系分类已被色系引用，无法删除"));

    mockMvc.perform(patch("/api/admin/slab-colors/{id}/status", colorId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(delete("/api/admin/slab-colors/{id}", colorId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
    mockMvc.perform(delete("/api/admin/slab-colors/categories/{id}", categoryId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void slabColorOperationsRequireTheirOwnPermissions() throws Exception {
    long accountId = 9061L;
    long employeeId = 9061L;
    long roleId = 9061L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629061",
        "色系只读操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '色系只读操作员', '15926629061', 'enabled', 'all', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, remark)
        VALUES (?, 1, 1, '色系只读角色', 'SLAB_COLOR_VIEW_ONLY', 'all', 'enabled', 'admin.product-data-center.slab-color.view', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/slab-colors").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk());
      mockMvc.perform(get("/api/admin/slab-colors/categories").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk());
      mockMvc.perform(post("/api/admin/slab-colors")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"越权色系\",\"categoryId\":1,\"status\":\"enabled\"}"))
          .andExpect(status().isForbidden());
      mockMvc.perform(post("/api/admin/slab-colors/categories")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"越权色系分类\"}"))
          .andExpect(status().isForbidden());
    } finally {
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void storeLevelMigrationCrudOptionsAndReferencesWork() throws Exception {
    Integer tableCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'store_levels'",
        Integer.class);
    Integer columnCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'stores' AND column_name = 'store_level_id'",
        Integer.class);
    assertThat(tableCount).isEqualTo(1);
    assertThat(columnCount).isEqualTo(1);

    Long referencedLevelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE name = '1级'", Long.class);
    mockMvc.perform(get("/api/admin/store-levels/{id}/delete-preview", referencedLevelId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该门店级别已被门店引用，不能删除"));
    mockMvc.perform(delete("/api/admin/store-levels/{id}", referencedLevelId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该门店级别已被门店引用，不能删除"));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/store-levels")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"name\":\"4级\",\"status\":\"enabled\",\"remark\":\"新增\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.code").doesNotExist())
        .andExpect(jsonPath("$.data.name").value("4级"))
        .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
        .andReturn();
    String levelId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(), "$.data.id").toString();
    try {
      mockMvc.perform(get("/api/admin/stores/level-options")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[*].name", hasItem("4级")));

      mockMvc.perform(put("/api/admin/store-levels/{id}", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"name\":\"四级门店\",\"status\":\"disabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.code").doesNotExist())
          .andExpect(jsonPath("$.data.name").value("四级门店"))
          .andExpect(jsonPath("$.data.status").value("enabled"));

      mockMvc.perform(patch("/api/admin/store-levels/{id}/status", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"status\":\"disabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));

      mockMvc.perform(get("/api/admin/stores/level-options")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[*].name", not(hasItem("四级门店"))));

      mockMvc.perform(post("/api/admin/stores")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"tenantId\":1,\"name\":\"停用级别门店\",\"type\":\"cityPartner\",\"storeLevelId\":" + levelId + ",\"status\":\"enabled\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("店铺级别已停用"));

      mockMvc.perform(post("/api/admin/stores")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"tenantId\":1,\"name\":\"无效级别门店\",\"type\":\"cityPartner\",\"storeLevelId\":999999,\"status\":\"enabled\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("店铺级别不存在"));

      mockMvc.perform(get("/api/admin/store-levels/{id}/delete-preview", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));

      mockMvc.perform(delete("/api/admin/store-levels/{id}", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM store_levels WHERE id = ?", Long.valueOf(levelId));
    }
  }

  @Test
  void storeLevelOperationsRequireTheirOwnPermissions() throws Exception {
    long accountId = 99086L;
    long employeeId = 99086L;
    long roleId = 99086L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId, "15926629086", "店铺级别只读操作员");
    jdbcTemplate.update(
        "INSERT INTO employees (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name) VALUES (?, ?, 1, 1, '店铺级别只读操作员', '15926629086', 'enabled', 'self', '韩健')",
        employeeId, accountId);
    jdbcTemplate.update(
        "INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status) VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')",
        accountId, employeeId);
    jdbcTemplate.update(
        "INSERT INTO roles (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name) VALUES (?, 1, 1, '店铺级别只读角色', 'STORE_LEVEL_VIEW_TEST', 'self', 'enabled', 'admin.tenant.store-level-management.view', '集成测试')",
        roleId);
    jdbcTemplate.update(
        "INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id) VALUES (?, ?, 'admin', 1, 1)",
        accountId, roleId);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/store-levels").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk());
      mockMvc.perform(post("/api/admin/store-levels")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"越权级别\",\"status\":\"enabled\"}"))
          .andExpect(status().isForbidden());

      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.tenant.store-level-management.view,"
              + "admin.tenant.store-level-management.create,"
              + "admin.tenant.store-level-management.edit,"
              + "admin.tenant.store-level-management.toggle-status,"
              + "admin.tenant.store-level-management.delete",
          roleId);
      MvcResult createdResult = mockMvc.perform(post("/api/admin/store-levels")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"本人创建的店铺级别\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.createdByName").value("店铺级别只读操作员"))
          .andReturn();
      String createdLevelId = com.jayway.jsonpath.JsonPath.read(
          createdResult.getResponse().getContentAsString(), "$.data.id").toString();

      mockMvc.perform(put("/api/admin/store-levels/{id}", createdLevelId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"本人创建的店铺级别-已编辑\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk());
      jdbcTemplate.update(
          "UPDATE store_levels SET created_by_account_id = 1, created_by_name = '其他创建人' WHERE id = ?",
          Long.valueOf(createdLevelId));
      mockMvc.perform(put("/api/admin/store-levels/{id}", createdLevelId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"其他人创建的店铺级别-已编辑\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk());
      mockMvc.perform(delete("/api/admin/store-levels/{id}", createdLevelId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM store_levels WHERE name LIKE '本人创建的店铺级别%'");
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void superAdminCanOperateStoreLevelCreatedByAnotherAccount() throws Exception {
    jdbcTemplate.update(
        "INSERT INTO store_levels (name, status, created_by_name, created_by_account_id) VALUES (?, 'enabled', ?, ?)",
        "超级管理员跨创建人操作测试",
        "其他管理员",
        99087L);
    Long levelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE name = ?",
        Long.class,
        "超级管理员跨创建人操作测试");

    try {
      mockMvc.perform(put("/api/admin/store-levels/{id}", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"name\":\"超级管理员跨创建人操作测试-已编辑\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk());
      mockMvc.perform(delete("/api/admin/store-levels/{id}", levelId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM store_levels WHERE id = ?", levelId);
    }
  }

  @Test
  void storeNameMustBeUniqueAcrossOperatingAndArchivedStores() throws Exception {
    long archivedStoreId = 99093L;
    long editableStoreId = 99094L;
    String suffix = Long.toString(System.nanoTime());
    String archivedStoreName = "已归档店铺重名校验-" + suffix;
    String editableStoreName = "运营中店铺重名校验-" + suffix;
    Long storeLevelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE status = 'enabled' ORDER BY id LIMIT 1",
        Long.class);
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, store_level_id, status, created_by) VALUES (?, 1, ?, 'cityPartner', ?, 'disabled', '韩健')",
        archivedStoreId,
        archivedStoreName,
        storeLevelId);
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, store_level_id, status, created_by) VALUES (?, 1, ?, 'cityPartner', ?, 'enabled', '韩健')",
        editableStoreId,
        editableStoreName,
        storeLevelId);

    try {
      mockMvc.perform(post("/api/admin/stores")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "tenantId": 1,
                    "name": " %s ",
                    "type": "cityPartner",
                    "storeLevelId": %d,
                    "status": "enabled"
                  }
                  """.formatted(archivedStoreName, storeLevelId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("店铺名称已存在"));

      mockMvc.perform(put("/api/admin/stores/{id}", editableStoreId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "tenantId": 1,
                    "name": "%s",
                    "type": "cityPartner",
                    "storeLevelId": %d,
                    "status": "enabled"
                  }
                  """.formatted(archivedStoreName, storeLevelId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("店铺名称已存在"));

      mockMvc.perform(put("/api/admin/stores/{id}", editableStoreId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "tenantId": 1,
                    "name": " %s ",
                    "type": "cityPartner",
                    "storeLevelId": %d,
                    "status": "enabled"
                  }
                  """.formatted(editableStoreName, storeLevelId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.name").value(editableStoreName));
    } finally {
      jdbcTemplate.update("DELETE FROM stores WHERE id IN (?, ?)", archivedStoreId, editableStoreId);
    }
  }

  @Test
  void storeOperationsRequireIndependentPermissionsAndEditPreservesProtectedFields() throws Exception {
    long accountId = 99088L;
    long employeeId = 99088L;
    long roleId = 99088L;
    long storeId = 99088L;
    long otherStoreId = 99089L;
    Long originalLevelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE status = 'enabled' ORDER BY id LIMIT 1",
        Long.class);
    Long targetLevelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE status = 'enabled' AND id <> ? ORDER BY id LIMIT 1",
        Long.class,
        originalLevelId);

    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId, "15926629088", "门店权限测试操作员");
    jdbcTemplate.update(
        "INSERT INTO employees (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name) VALUES (?, ?, 1, 1, '门店权限测试操作员', '15926629088', 'enabled', 'self', '韩健')",
        employeeId, accountId);
    jdbcTemplate.update(
        "INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status) VALUES (?, 'admin', 'employee', ?, 1, 1, 'enabled')",
        accountId, employeeId);
    jdbcTemplate.update(
        "INSERT INTO roles (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name) VALUES (?, 1, 1, '门店编辑测试角色', 'STORE_EDIT_TEST', 'self', 'enabled', 'admin.tenant.tenant-store-management.view,admin.tenant.tenant-store-management.edit', '集成测试')",
        roleId);
    jdbcTemplate.update(
        "INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id) VALUES (?, ?, 'admin', 1, 1)",
        accountId, roleId);
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, store_level_id, status, created_by) VALUES (?, 1, '门店权限测试门店', 'cityPartner', ?, 'enabled', '门店权限测试操作员')",
        storeId, originalLevelId);
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, store_level_id, status, created_by) VALUES (?, 1, '其他人创建的门店权限测试门店', 'cityPartner', ?, 'enabled', '其他管理员')",
        otherStoreId, originalLevelId);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/stores").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[?(@.id == %d)]".formatted(storeId)).isNotEmpty())
          .andExpect(jsonPath("$.data[?(@.id == %d)]".formatted(otherStoreId)).isNotEmpty());
      mockMvc.perform(patch("/api/admin/stores/{id}/level", storeId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"storeLevelId\":" + targetLevelId + "}"))
          .andExpect(status().isForbidden());
      mockMvc.perform(patch("/api/admin/stores/{id}/archive", storeId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isForbidden());

      mockMvc.perform(put("/api/admin/stores/{id}", storeId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {
                    "tenantId": 1,
                    "name": "门店权限测试门店-已编辑",
                    "type": "cityPartner",
                    "storeLevelId": %d,
                    "status": "disabled"
                  }
                  """.formatted(targetLevelId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.name").value("门店权限测试门店-已编辑"))
          .andExpect(jsonPath("$.data.storeLevelId").value(originalLevelId))
          .andExpect(jsonPath("$.data.status").value("enabled"));

      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.tenant.tenant-store-management.view,admin.tenant.tenant-store-management.edit-level",
          roleId);
      mockMvc.perform(patch("/api/admin/stores/{id}/level", storeId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"storeLevelId\":" + targetLevelId + "}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.storeLevelId").value(targetLevelId));

      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.tenant.tenant-store-management.operating.view,"
              + "admin.tenant.tenant-store-management.operating.archive",
          roleId);
      mockMvc.perform(patch("/api/admin/stores/{id}/archive", storeId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));

      jdbcTemplate.update("UPDATE employees SET data_permission = 'all' WHERE id = ?", employeeId);
      jdbcTemplate.update(
          "UPDATE roles SET function_permissions = ? WHERE id = ?",
          "admin.tenant.tenant-store-management.view,"
              + "admin.tenant.tenant-store-management.edit-level,"
              + "admin.tenant.tenant-store-management.edit,"
              + "admin.tenant.tenant-store-management.delete",
          roleId);
      mockMvc.perform(put("/api/admin/stores/{id}", otherStoreId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {
                    "tenantId": 1,
                    "name": "越权编辑其他人的门店",
                    "type": "cityPartner",
                    "storeLevelId": %d,
                    "status": "enabled"
                  }
                  """.formatted(originalLevelId)))
          .andExpect(status().isOk());
      mockMvc.perform(patch("/api/admin/stores/{id}/level", otherStoreId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"storeLevelId\":" + targetLevelId + "}"))
          .andExpect(status().isOk());
      mockMvc.perform(patch("/api/admin/stores/{id}/archive", otherStoreId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));
    } finally {
      jdbcTemplate.update("DELETE FROM stores WHERE id IN (?, ?)", storeId, otherStoreId);
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void archivedStoreBlocksEmployeeLoginRevokesSessionAndCanBeRestored() throws Exception {
    long storeId = 998003L;
    String phone = "15926628003";
    createStoreScopedEmployee(
        storeId,
        phone,
        "门店归档测试员",
        "admin.permission-management.employee-management.view");

    try {
      MvcResult loginResult = mockMvc.perform(post("/api/admin/auth/login")
              .contentType("application/json")
              .content("{\"phone\":\"" + phone + "\",\"verifyCode\":\"888888\"}"))
          .andExpect(status().isOk())
          .andReturn();
      String token = com.jayway.jsonpath.JsonPath.read(
          loginResult.getResponse().getContentAsString(), "$.data.token");

      mockMvc.perform(patch("/api/admin/stores/{id}/archive", storeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT archived_by_tenant FROM stores WHERE id = ?",
          Boolean.class,
          storeId)).isFalse();
      mockMvc.perform(post("/api/admin/auth/login")
              .contentType("application/json")
              .content("{\"phone\":\"" + phone + "\",\"verifyCode\":\"888888\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("该门店已停止运营"));
      mockMvc.perform(get("/api/admin/auth/contexts").header("Authorization", "Bearer " + token))
          .andExpect(status().isUnauthorized());

      mockMvc.perform(patch("/api/admin/stores/{id}/restore", storeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("enabled"));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT archived_by_tenant FROM stores WHERE id = ?",
          Boolean.class,
          storeId)).isFalse();
      mockMvc.perform(post("/api/admin/auth/login")
              .contentType("application/json")
              .content("{\"phone\":\"" + phone + "\",\"verifyCode\":\"888888\"}"))
          .andExpect(status().isOk());

      mockMvc.perform(patch("/api/admin/stores/{id}/archive", storeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));
      jdbcTemplate.update(
          "UPDATE account_identities SET status = 'disabled' WHERE store_id = ?",
          storeId);
      mockMvc.perform(patch("/api/admin/stores/{id}/restore", storeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("enabled"));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT status FROM account_identities WHERE store_id = ? LIMIT 1",
          String.class,
          storeId)).isEqualTo("disabled");
      mockMvc.perform(post("/api/admin/auth/login")
              .contentType("application/json")
              .content("{\"phone\":\"" + phone + "\",\"verifyCode\":\"888888\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("账号不存在或已停用"));
    } finally {
      jdbcTemplate.update("DELETE FROM auth_sessions WHERE account_id = ?", storeId);
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", storeId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", storeId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", storeId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", storeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", storeId);
      jdbcTemplate.update("DELETE FROM stores WHERE id = ?", storeId);
    }
  }

  @Test
  void archivedStorePermanentDeleteRemovesStoreBusinessData() throws Exception {
    long storeId = 99087L;
    long categoryId = 99087L;
    long childCategoryId = 99088L;
    long secondCategoryId = 99089L;
    long sameNameChildCategoryId = 99090L;
    long roleId = 99087L;
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status, created_by) VALUES (?, 1, '已归档删除测试门店', 'cityPartner', 'disabled', '韩健')",
        storeId);
    jdbcTemplate.update(
        "INSERT INTO store_categories (id, store_id, name, sort_order, product_count, status, created_by_name) VALUES (?, ?, '门店删除级联分类', 1, 0, 'enabled', '韩健')",
        categoryId,
        storeId);
    jdbcTemplate.update(
        "INSERT INTO store_categories (id, store_id, parent_id, name, sort_order, product_count, status, created_by_name) VALUES (?, ?, ?, '门店删除级联子分类', 2, 0, 'enabled', '韩健')",
        childCategoryId,
        storeId,
        categoryId);
    jdbcTemplate.update(
        "INSERT INTO store_categories (id, store_id, name, sort_order, product_count, status, created_by_name) VALUES (?, ?, '门店删除级联分类二', 3, 0, 'enabled', '韩健')",
        secondCategoryId,
        storeId);
    jdbcTemplate.update(
        "INSERT INTO store_categories (id, store_id, parent_id, name, sort_order, product_count, status, created_by_name) VALUES (?, ?, ?, '门店删除级联子分类', 4, 0, 'enabled', '韩健')",
        sameNameChildCategoryId,
        storeId,
        secondCategoryId);
    jdbcTemplate.update(
        "INSERT INTO roles (id, name, code, data_scope, status) VALUES (?, '门店删除自动清理角色', 'STORE_DELETE_CASCADE_ROLE', 'all', 'enabled')",
        roleId);
    jdbcTemplate.update(
        "INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id) VALUES (1, ?, 'admin', 1, ?)",
        roleId,
        storeId);
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, '15926629087', '归档门店员工', 'enabled')",
        storeId);
    jdbcTemplate.update(
        "INSERT INTO employees (id, account_id, tenant_id, store_id, name, phone, status) VALUES (?, ?, 1, ?, '归档门店员工', '15926629087', 'enabled')",
        storeId,
        storeId,
        storeId);
    jdbcTemplate.update(
        "INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status) VALUES (?, 'admin', 'employee', ?, 1, ?, 'enabled')",
        storeId,
        storeId,
        storeId);

    mockMvc.perform(delete("/api/admin/stores/{id}", storeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM stores WHERE id = ?", Integer.class, storeId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE id = ?", Integer.class, categoryId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE id = ?", Integer.class, childCategoryId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE id = ?", Integer.class, secondCategoryId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM store_categories WHERE id = ?", Integer.class, sameNameChildCategoryId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM roles WHERE id = ?", Integer.class, roleId)).isEqualTo(1);
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM account_roles WHERE role_id = ?", Integer.class, roleId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM employees WHERE store_id = ?", Integer.class, storeId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM account_identities WHERE store_id = ?", Integer.class, storeId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE id = ?", Integer.class, storeId)).isEqualTo(1);
    jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
    jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", storeId);
  }

  @Test
  void slabGradeMigrationCrudAndValidationWork() throws Exception {
    Integer gradeTableCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM information_schema.tables
        WHERE table_schema = DATABASE() AND table_name = 'slab_grades'
        """,
        Integer.class);
    assertThat(gradeTableCount).isEqualTo(1);

    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-grades")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"code\":\"A+\",\"name\":\"超精品料\",\"status\":\"enabled\",\"remark\":\"新增\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.code").value("A+"))
        .andExpect(jsonPath("$.data.name").value("超精品料"))
        .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
        .andReturn();
    String gradeId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(), "$.data.id").toString();

    try {
      mockMvc.perform(post("/api/admin/slab-grades")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"code\":\"A+\",\"name\":\"另一个名称\",\"status\":\"enabled\"}"))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("等级已存在"));

      mockMvc.perform(put("/api/admin/slab-grades/{id}", gradeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"code\":\"S\",\"name\":\"精品料\",\"status\":\"disabled\",\"remark\":\"编辑\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.code").value("S"))
          .andExpect(jsonPath("$.data.name").value("精品料"))
          .andExpect(jsonPath("$.data.status").value("enabled"));

      mockMvc.perform(patch("/api/admin/slab-grades/{id}/status", gradeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"status\":\"disabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("disabled"));

      mockMvc.perform(delete("/api/admin/slab-grades/{id}", gradeId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM slab_grades WHERE id = ?", Long.valueOf(gradeId));
    }
  }

  @Test
  void slabGradeOperationsRequireTheirOwnPermissions() throws Exception {
    long accountId = 99085L;
    long employeeId = 99085L;
    long roleId = 99085L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926639085",
        "等级只读操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '等级只读操作员', '15926639085', 'enabled', 'all', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '等级只读角色', 'SLAB_GRADE_VIEW_TEST', 'all', 'enabled', 'admin.product-data-center.slab-grade.view', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/slab-grades").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk());
      mockMvc.perform(post("/api/admin/slab-grades")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"code\":\"B\",\"name\":\"越权等级\",\"status\":\"enabled\"}"))
          .andExpect(status().isForbidden());
    } finally {
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void slabOriginMigrationAndCrudLifecycleWork() throws Exception {
    Integer originColumnCount = jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = 'slab_varieties'
          AND column_name = 'origin'
        """,
        Integer.class);
    assertThat(originColumnCount).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_origins WHERE name = '巴西' AND status = 'enabled'",
        Integer.class)).isEqualTo(1);
    assertThat(jdbcTemplate.queryForObject(
        """
        SELECT COUNT(*)
        FROM slab_varieties sv
        JOIN slab_origins so ON so.id = sv.origin_id
        WHERE sv.name = '潘多拉' AND so.name = '巴西'
        """,
        Integer.class)).isEqualTo(1);

    String originName = "产地集成测试-" + System.nanoTime();
    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-origins")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {"name":"%s","status":"enabled","remark":"新增"}
                """.formatted(originName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value(originName))
        .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
        .andReturn();
    String originId = com.jayway.jsonpath.JsonPath.read(
        createdResult.getResponse().getContentAsString(), "$.data.id").toString();

    mockMvc.perform(post("/api/admin/slab-origins")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {"name":" %s ","status":"enabled"}
                """.formatted(originName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("产地名称已存在"));

    mockMvc.perform(put("/api/admin/slab-origins/{id}", originId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {"name":"%s-已编辑","status":"disabled","remark":"编辑"}
                """.formatted(originName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value(originName + "-已编辑"))
        .andExpect(jsonPath("$.data.status").value("enabled"));

    mockMvc.perform(patch("/api/admin/slab-origins/{id}/status", originId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));

    mockMvc.perform(delete("/api/admin/slab-origins/{id}", originId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
  }

  @Test
  void slabOriginManagementIgnoresSelfDataScopeWhenListing() throws Exception {
    long accountId = 9081L;
    long employeeId = 9081L;
    long roleId = 9081L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629081",
        "大板产地自有操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '大板产地自有操作员', '15926629081', 'enabled', 'self', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '大板产地自有操作角色', 'SLAB_ORIGIN_SELF_TEST', 'self', 'enabled',
          'admin.product-data-center.slab-origin.view,'
          'admin.product-data-center.slab-origin.create,'
          'admin.product-data-center.slab-origin.edit,'
          'admin.product-data-center.slab-origin.toggle-status,'
          'admin.product-data-center.slab-origin.delete', '集成测试')
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
        INSERT INTO slab_origins (id, name, status, created_by_name)
        VALUES
          (9081, '本人创建的大板产地', 'enabled', '大板产地自有操作员'),
          (9082, '他人创建的大板产地', 'enabled', '韩健')
        """);

    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/slab-origins").header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[*].name", hasItem("本人创建的大板产地")))
          .andExpect(jsonPath("$.data[*].name", hasItem("他人创建的大板产地")));

      MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-origins")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"本人新增的大板产地\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.createdByName").value("大板产地自有操作员"))
          .andReturn();
      String createdOriginId = com.jayway.jsonpath.JsonPath.read(
          createdResult.getResponse().getContentAsString(),
          "$.data.id")
          .toString();

      mockMvc.perform(put("/api/admin/slab-origins/9082")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"他人创建的大板产地-已编辑\",\"status\":\"enabled\"}"))
          .andExpect(status().isOk());
      mockMvc.perform(patch("/api/admin/slab-origins/9082/status")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"status\":\"disabled\"}"))
          .andExpect(status().isOk());
      mockMvc.perform(delete("/api/admin/slab-origins/9082")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      mockMvc.perform(delete("/api/admin/slab-origins/{id}", createdOriginId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
    } finally {
      jdbcTemplate.update("DELETE FROM slab_origins WHERE id IN (9081, 9082)");
      jdbcTemplate.update("DELETE FROM slab_origins WHERE name = '本人新增的大板产地'");
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void slabOriginRejectsReferencedDeleteAndUnauthorizedAccess() throws Exception {
    mockMvc.perform(delete("/api/admin/slab-origins/1")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message")
            .value("该产地已被大板品种引用，不能删除，请先停用该产地"));

    long accountId = 9071L;
    long employeeId = 9071L;
    long roleId = 9071L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629071",
        "无产地权限操作员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '无产地权限操作员', '15926629071', 'enabled', 'all', '韩健')
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, remark)
        VALUES (?, 1, 1, '无产地权限角色', 'NO_SLAB_ORIGIN_PERMISSION', 'all', 'enabled', 'admin.product-data-center.slab-variety.view', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);
    try {
      String token = TokenAuthenticationFilter.createAccountToken(accountId);
      mockMvc.perform(get("/api/admin/slab-origins")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isForbidden());
      mockMvc.perform(post("/api/admin/slab-origins")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{\"name\":\"越权产地\",\"status\":\"enabled\"}"))
          .andExpect(status().isForbidden());
    } finally {
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void slabVarietyNameMustBeUniqueWhenCreatingAndEditing() throws Exception {
    mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":" 潘多拉 ",
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
                  "status":"enabled"
                }
                """.formatted(varietyName)))
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
                  "status":"enabled"
                }
                """))
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
                  "status":"enabled",
                  "createdByName":"不应覆盖"
                }
                """.formatted(varietyName)))
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
                  "status":"disabled",
                  "createdByName":"不应覆盖"
                }
                """.formatted(varietyName)))
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
  void slabVarietyManagementIgnoresSelfDataScopeWhenListing() throws Exception {
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '大板品种自有操作角色', 'SLAB_VARIETY_SELF_TEST', 'self', 'enabled',
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
        INSERT INTO slab_varieties (id, name, status, created_by_name)
        VALUES
          (9031, '本人创建的大板品种', 'enabled', '大板品种自有操作员'),
          (9032, '他人创建的大板品种', 'enabled', '韩健')
        """);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/slab-varieties").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].name", hasItem("本人创建的大板品种")))
        .andExpect(jsonPath("$.data[*].name", hasItem("他人创建的大板品种")));

    MvcResult createdResult = mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"本人新增的大板品种",
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
                  "name":"他人创建的大板品种-已编辑",
                  "status":"enabled"
                }
                """))
        .andExpect(status().isOk());
    mockMvc.perform(patch("/api/admin/slab-varieties/9032/status")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"status":"disabled"}
                """))
        .andExpect(status().isOk());
    mockMvc.perform(delete("/api/admin/slab-varieties/9032")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '品种编辑角色', 'SLAB_VARIETY_EDITOR_TEST', 'all', 'enabled',
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
        INSERT INTO slab_varieties (id, name, status, created_by_name, created_by_account_id)
        VALUES (9011, '权限集成测试品种', 'enabled', '品种查看员', ?)
        """,
        accountId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/slab-varieties").header("Authorization", "Bearer " + token))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/admin/slab-varieties")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"无权新增品种","status":"enabled"}
                """))
        .andExpect(status().isForbidden());
    mockMvc.perform(put("/api/admin/slab-varieties/9011")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"权限集成测试品种-已编辑","status":"disabled"}
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
          (tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (1, 1, '无租户权限角色', 'NO_TENANT_PERMISSION_ROLE', 'all', 'enabled',
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
  void tenantPermissionsIgnoreDataScopeAndAllowOperationsOnOtherCreatorsData() throws Exception {
    long accountId = 9012L;
    long employeeId = 9012L;
    jdbcTemplate.update(
        """
        INSERT INTO accounts (id, phone, display_name, account_type, status)
        VALUES (?, '15900009012', '租户权限操作员', 'person', 'enabled')
        """,
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '租户权限操作员', '15900009012', 'enabled', 'self', '韩健')
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
          (tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (1, 1, '租户全部查看角色', 'TENANT_ALL_VIEW_SELF_SCOPE_ROLE', 'self', 'enabled',
          'admin.tenant.tenant-management.view,admin.tenant.tenant-management.edit,
           admin.tenant.tenant-management.open-business,admin.tenant.tenant-management.toggle-status,
           admin.tenant.tenant-management.delete', '韩健')
        """);
    Long roleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'TENANT_ALL_VIEW_SELF_SCOPE_ROLE'",
        Long.class);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    String token = TokenAuthenticationFilter.createAccountToken(accountId);
    mockMvc.perform(get("/api/admin/tenants")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 1)]").isNotEmpty());

    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, account_type, status) VALUES (9013, '15926629012', '测试租户管理员', 'person', 'enabled')");
    jdbcTemplate.update(
        "INSERT INTO tenants (id, name, contact_name, contact_phone, status, business_types, created_by_name, created_by_account_id) VALUES (9012, '其他人创建的测试租户', '测试联系人', '15926629012', 'enabled', '', '其他创建人', 1)");
    jdbcTemplate.update(
        "INSERT INTO account_identities (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status) VALUES (9013, 'admin', 'tenant_admin', 9012, 9012, NULL, 'enabled')");
    mockMvc.perform(put("/api/admin/tenants/9012")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {
                  "name":"其他人创建的测试租户-已编辑",
                  "contactName":"已编辑联系人",
                  "contactPhone":"15926629012",
                  "status":"enabled",
                  "businessTypes":"",
                  "remark":""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("其他人创建的测试租户-已编辑"));
    mockMvc.perform(get("/api/admin/tenants/1/purge-preview")
            .header("Authorization", "Bearer " + token))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("仅平台身份可执行当前操作"));
    mockMvc.perform(post("/api/admin/tenants/1/purge")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("{\"confirmationName\":\"装点猫直营租户\"}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("仅平台身份可执行当前操作"));
    jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = 9013");
    jdbcTemplate.update("DELETE FROM tenants WHERE id = 9012");
    jdbcTemplate.update("DELETE FROM accounts WHERE id = 9013");
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
    Long imageMediaId = Long.valueOf(com.jayway.jsonpath.JsonPath.read(
        uploadResult.getResponse().getContentAsString(),
        "$.data.id").toString());

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
                  "imageMediaId": %d,
                  "remark": "新增备注",
                  "status": "enabled",
                  "createdByName": "不应覆盖"
                }
                """.formatted(craftName, imageMediaId)))
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
                  "imageMediaId": %d,
                  "status": "enabled"
                }
                """.formatted(craftName, imageMediaId)))
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
                  "imageMediaId": %d,
                  "status": "enabled"
                }
                """.formatted(craftName, imageMediaId)))
        .andExpect(status().isBadRequest());

    mockMvc.perform(put("/api/admin/crafts/{id}", craftId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "%s",
                  "type": "面工艺",
                  "width": "18",
                  "imageMediaId": %d,
                  "remark": "编辑备注",
                  "status": "enabled",
                  "createdByName": "不应覆盖"
                }
                """.formatted(craftName, imageMediaId)))
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '工艺查看角色', 'CRAFT_VIEWER_TEST', 'all', 'enabled', ?, '集成测试')
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
  void craftManagementIgnoresCurrentEmployeeDataPermissionWhenListing() throws Exception {
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '工艺范围测试角色', 'CRAFT_SCOPE_TEST', 'self', 'enabled', ?, '集成测试')
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
        .andExpect(jsonPath("$.data[?(@.name == '%s')].createdByName".formatted(otherCraftName))
            .value(hasItem("韩健")));

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
        .andExpect(jsonPath("$.data[?(@.status == 'enabled')].code").value(not(hasItem("CUSTOMER_SERVICE"))))
        .andExpect(jsonPath("$.data[0].category").doesNotExist())
        .andExpect(jsonPath("$.data[0].clientCode").doesNotExist())
        .andExpect(jsonPath("$.data[0].tenantId").value(org.hamcrest.Matchers.nullValue()))
        .andExpect(jsonPath("$.data[0].storeId").value(org.hamcrest.Matchers.nullValue()));

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
  void terminalFunctionPoliciesAreMaintainedOutsideRoles() throws Exception {
    mockMvc.perform(get("/api/admin/terminal-function-policies")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[*].terminal").value(hasItem("store")))
        .andExpect(jsonPath("$.data[*].terminal").value(hasItem("supplier")));

    mockMvc.perform(put("/api/admin/terminal-function-policies/store")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "functionPermissions": "store.home.view,store.home.view"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.terminal").value("store"))
        .andExpect(jsonPath("$.data.functionPermissions").value("store.home.view"));

    String storedPermissions = jdbcTemplate.queryForObject(
        "SELECT function_permissions FROM terminal_function_policies WHERE terminal = 'store'",
        String.class);
    assertThat(storedPermissions).isEqualTo("store.home.view");
  }

  @Test
  void roleManagementIsScopedToCurrentStoreIdentity() throws Exception {
    long accountId = 9002L;
    long otherStoreId = 9002L;
    String originalTerminalPermissions = jdbcTemplate.queryForObject(
        "SELECT function_permissions FROM terminal_function_policies WHERE terminal = 'store'",
        String.class);

    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status) VALUES (?, 1, '角色隔离测试门店', 'cityPartner', 'enabled')",
        otherStoreId);

    jdbcTemplate.update(
        """
        INSERT INTO accounts (id, phone, display_name, account_type, status)
        VALUES (?, '15900009002', ?, 'person', 'enabled')
        """,
        accountId,
        "角色范围测试管理员");
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'store_admin', 1, 1, 1, 'enabled')
        """,
        accountId);
    jdbcTemplate.update(
        """
        UPDATE terminal_function_policies
        SET function_permissions = ?
        WHERE terminal = 'store'
        """,
        "admin.permission-management.role-management.view,"
            + "admin.permission-management.role-management.create,"
            + "admin.permission-management.role-management.edit,"
            + "admin.permission-management.role-management.permission,"
            + "admin.permission-management.role-management.delete");
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (tenant_id, store_id, name, code, data_scope, status,
           function_permissions, created_by_name, created_by_account_id)
        VALUES
          (1, 1, '本门店本人角色', 'CURRENT_STORE_ROLE', 'all', 'enabled', '', '角色范围测试管理员', ?),
          (1, 1, '本门店他人角色', 'SAME_STORE_OTHER_ROLE', 'all', 'enabled', '', '韩健', 1),
          (1, ?, '其他门店角色', 'OTHER_STORE_ROLE', 'all', 'enabled', '', '韩健', 1)
        """,
        accountId,
        otherStoreId);

    mockMvc.perform(get("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.code == 'CURRENT_STORE_ROLE')].name").value(hasItem("本门店本人角色")))
        .andExpect(jsonPath("$.data[?(@.code == 'SAME_STORE_OTHER_ROLE')].name").value(hasItem("本门店他人角色")))
        .andExpect(jsonPath("$.data[*].code").value(not(hasItem("OTHER_STORE_ROLE"))))
        .andExpect(jsonPath("$.data[*].code").value(not(hasItem("ADMIN_MANAGER"))));

    mockMvc.perform(get("/api/admin/roles/permission-scope")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.audience").value("store"))
        .andExpect(jsonPath("$.data.functionPermissions")
            .value(org.hamcrest.Matchers.containsString("role-management.view")));

    Long currentStoreRoleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'CURRENT_STORE_ROLE'",
        Long.class);
    mockMvc.perform(put("/api/admin/roles/{id}", currentStoreRoleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "本门店角色-已更新",
                  "code": "IGNORED_CODE",
                  "dataScope": "all",
                  "status": "enabled",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("本门店角色-已更新"));

    Long sameStoreOtherRoleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'SAME_STORE_OTHER_ROLE'",
        Long.class);
    mockMvc.perform(put("/api/admin/roles/{id}", sameStoreOtherRoleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "其他人创建的同门店角色-已更新",
                  "code": "SAME_STORE_OTHER_ROLE",
                  "dataScope": "all",
                  "status": "enabled",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("其他人创建的同门店角色-已更新"));
    mockMvc.perform(delete("/api/admin/roles/{id}", sameStoreOtherRoleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data").value(true));

    Long otherStoreRoleId = jdbcTemplate.queryForObject(
        "SELECT id FROM roles WHERE code = 'OTHER_STORE_ROLE'",
        Long.class);
    mockMvc.perform(put("/api/admin/roles/{id}", otherStoreRoleId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "跨门店修改角色",
                  "code": "OTHER_STORE_ROLE",
                  "dataScope": "all",
                  "status": "enabled",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("当前组织无权操作该角色"));

    jdbcTemplate.update(
        "DELETE FROM roles WHERE code IN ('CURRENT_STORE_ROLE', 'SAME_STORE_OTHER_ROLE', 'OTHER_STORE_ROLE')");
    jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
    jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    jdbcTemplate.update("DELETE FROM stores WHERE id = ?", otherStoreId);
    jdbcTemplate.update(
        "UPDATE terminal_function_policies SET function_permissions = ? WHERE terminal = 'store'",
        originalTerminalPermissions);
  }

  @Test
  void roleNameMustBeUniqueWithinPlatform() throws Exception {
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (name, code, data_scope, status, remark, function_permissions,
           created_by_account_id)
        VALUES
          ('同名角色', 'DUPLICATE_NAME_OPERATION', 'all', 'enabled', '', '', 1),
          ('待重命名角色', 'ROLE_TO_RENAME', 'all', 'enabled', '', '', 1)
        """);

    mockMvc.perform(post("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": " 同名角色 ",
                  "code": "DUPLICATE_NAME_CREATE",
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("当前组织已存在同名角色"));

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
                  "dataScope": "all",
                  "status": "enabled",
                  "remark": "",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("当前组织已存在同名角色"));

    Integer crossCategoryCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM roles WHERE name = '同名角色'",
        Integer.class);
    assertThat(crossCategoryCount).isEqualTo(1);
  }

  @Test
  void employeePermissionUpdateDoesNotRequireProfileEditPermission() throws Exception {
    long managerAccountId = 9041L;
    long managerEmployeeId = 9041L;
    long targetAccountId = 9042L;
    long targetEmployeeId = 9042L;
    long otherStoreAccountId = 9043L;
    long otherStoreEmployeeId = 9043L;
    long otherStoreId = 9043L;
    long managerRoleId = 9041L;

    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status) VALUES (?, 1, '员工隔离测试门店', 'partner', 'enabled')",
        otherStoreId);

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
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        otherStoreAccountId,
        "15926629043",
        "其他门店员工");
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
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids,
           data_permission, created_by_name)
        VALUES (?, ?, 1, ?, '其他门店员工', '15926629043', 'enabled', '2', 'all', '韩健')
        """,
        otherStoreEmployeeId,
        otherStoreAccountId,
        otherStoreId);
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
          (id, tenant_id, store_id, name, code, data_scope, status,
           function_permissions, created_by_name)
        VALUES (?, 1, 1, '员工权限配置测试角色', 'EMPLOYEE_PERMISSION_MANAGER_TEST', 'self', 'enabled',
          'admin.permission-management.employee-management.view,'
          'admin.permission-management.employee-management.edit,'
          'admin.permission-management.employee-management.permission,'
          'admin.permission-management.employee-management.toggle-status,'
          'admin.permission-management.employee-management.delete', '集成测试')
        """,
        managerRoleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1), (?, ?, 'admin', 1, 1)
        """,
        managerAccountId,
        managerRoleId,
        targetAccountId,
        managerRoleId);

    mockMvc.perform(get("/api/admin/employees")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 9042)].name").value(hasItem("待配置员工")))
        .andExpect(jsonPath("$.data[?(@.id == 9043)]").isEmpty());

    mockMvc.perform(patch("/api/admin/employees/{id}/permissions", targetEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "roleIds": "%d",
                  "dataPermission": "self"
                }
                """.formatted(managerRoleId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.roleIds").value(String.valueOf(managerRoleId)))
        .andExpect(jsonPath("$.data.dataPermission").value("self"));

    mockMvc.perform(put("/api/admin/employees/{id}", managerEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "不应修改的他人创建员工",
                  "gender": "male",
                  "phone": "15926629041",
                  "status": "enabled",
                  "roleIds": "%d",
                  "dataPermission": "self",
                  "remark": ""
                }
                """.formatted(managerRoleId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能编辑当前登录员工"));
    mockMvc.perform(patch("/api/admin/employees/{id}/permissions", managerEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "roleIds": "%d",
                  "dataPermission": "self"
                }
                """.formatted(managerRoleId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能修改当前登录员工的角色"));
    mockMvc.perform(put("/api/admin/employees/{id}", managerEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "权限配置员",
                  "gender": "male",
                  "phone": "15926629041",
                  "status": "enabled",
                  "roleIds": "2",
                  "dataPermission": "self",
                  "remark": ""
                }
                """))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能修改当前登录员工的角色"));
    mockMvc.perform(put("/api/admin/employees/{id}", managerEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "name": "权限配置员",
                  "gender": "male",
                  "phone": "15926629041",
                  "status": "disabled",
                  "roleIds": "%d",
                  "dataPermission": "self",
                  "remark": ""
                }
                """.formatted(managerRoleId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能停用当前登录员工"));
    mockMvc.perform(delete("/api/admin/employees/{id}", managerEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId)))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能删除当前登录员工"));

    mockMvc.perform(patch("/api/admin/employees/{id}/permissions", otherStoreEmployeeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(managerAccountId))
            .contentType("application/json")
            .content("""
                {
                  "roleIds": "2",
                  "dataPermission": "self"
                }
                """))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("当前组织无权操作该员工"));
  }

  @Test
  void employeeInvitePersistsCurrentIdentityAsCreator() throws Exception {
    long accountId = 9051L;
    long employeeId = 9051L;
    long roleId = 9051L;

    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629051",
        "邀请创建员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids,
           data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '邀请创建员', '15926629051', 'enabled', ?, 'all', '韩健')
        """,
        employeeId,
        accountId,
        String.valueOf(roleId));
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
          (id, tenant_id, store_id, name, code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, 1, 1, '员工邀请创建测试角色', 'EMPLOYEE_INVITE_CREATOR_TEST', 'all', 'enabled',
          'admin.permission-management.employee-management.create', '集成测试')
        """,
        roleId);
    jdbcTemplate.update(
        """
        INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id)
        VALUES (?, ?, 'admin', 1, 1)
        """,
        accountId,
        roleId);

    MvcResult inviteResult = mockMvc.perform(post("/api/admin/employee-invites")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.token").isString())
        .andReturn();

    String token = com.jayway.jsonpath.JsonPath.read(
        inviteResult.getResponse().getContentAsString(),
        "$.data.token");
    Long createdByAccountId = jdbcTemplate.queryForObject(
        "SELECT created_by_account_id FROM employee_invites WHERE token = ?",
        Long.class,
        token);
    String createdByName = jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM employee_invites WHERE token = ?",
        String.class,
        token);

    assertThat(createdByAccountId).isEqualTo(accountId);
    assertThat(createdByName).isEqualTo("邀请创建员");
  }

  @Test
  void employeeInviteUsesCurrentIdentityStoreScope() throws Exception {
    long storeId = 9052L;
    long accountId = 9052L;
    long employeeId = 9052L;
    long roleId = 9052L;
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status, created_by) VALUES (?, 1, '邀请作用域测试门店', 'cityPartner', 'enabled', '集成测试')",
        storeId);
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, '15926629052', '跨门店邀请创建员', 'enabled')",
        accountId);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids,
           data_permission, created_by_name)
        VALUES (?, ?, 1, ?, '跨门店邀请创建员', '15926629052', 'enabled', ?, 'all', '集成测试')
        """,
        employeeId,
        accountId,
        storeId,
        String.valueOf(roleId));
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, ?, 'enabled')
        """,
        accountId,
        employeeId,
        storeId);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, tenant_id, store_id, name, code, data_scope, status,
           function_permissions, created_by_name)
        VALUES (?, 1, ?, '跨门店邀请测试角色', 'EMPLOYEE_INVITE_SCOPE_TEST', 'all', 'enabled',
          'admin.permission-management.employee-management.create', '集成测试')
        """,
        roleId,
        storeId);
    jdbcTemplate.update(
        "INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id) VALUES (?, ?, 'admin', 1, ?)",
        accountId,
        roleId,
        storeId);

    try {
      mockMvc.perform(post("/api/admin/employee-invites")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
          .andExpect(status().isOk());

      assertThat(jdbcTemplate.queryForObject(
          "SELECT store_id FROM employee_invites WHERE created_by_account_id = ? ORDER BY id DESC LIMIT 1",
          Long.class,
          accountId)).isEqualTo(storeId);
    } finally {
      jdbcTemplate.update("DELETE FROM employee_invites WHERE created_by_account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM roles WHERE id = ?", roleId);
      jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", accountId);
      jdbcTemplate.update("DELETE FROM employees WHERE id = ?", employeeId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
      jdbcTemplate.update("DELETE FROM stores WHERE id = ?", storeId);
    }
  }

  @Test
  void employeeInviteRegistrationActivatesWithCurrentStoreRole() throws Exception {
    String creatorName = "邀请注册测试员";
    String adminToken = createStoreScopedEmployee(
        98002L,
        "15926628002",
        creatorName,
        "admin.permission-management.employee-management.view,"
            + "admin.permission-management.employee-management.create,"
            + "admin.permission-management.employee-management.edit,"
            + "admin.permission-management.employee-management.permission,"
            + "admin.permission-management.employee-management.toggle-status");
    MvcResult inviteResult = mockMvc.perform(post("/api/admin/employee-invites")
            .header("Authorization", "Bearer " + adminToken))
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
                  "phone": "15926628002"
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
            .header("Authorization", "Bearer " + adminToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.phone == '15926629999')].createdByName").value(hasItem(creatorName)));

    String createdByName = jdbcTemplate.queryForObject(
        "SELECT created_by_name FROM employees WHERE id = ?",
        String.class,
        Long.valueOf(employeeId));
    assertThat(createdByName).isEqualTo(creatorName);

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
            .header("Authorization", "Bearer " + adminToken)
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
            .header("Authorization", "Bearer " + adminToken)
            .contentType("application/json")
            .content("""
                {
                  "name": "待审核员工",
                  "gender": "male",
                  "phone": "15926629999",
                  "status": "enabled",
                  "roleIds": "98002",
                  "dataPermission": "all",
                  "remark": ""
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("enabled"))
        .andExpect(jsonPath("$.data.roleIds").value("98002"));

    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926629999",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.storeId").value(98002));
  }

  @Test
  void tenantCrudPersistsThroughApi() throws Exception {
    String creatorName = jdbcTemplate.queryForObject(
        "SELECT name FROM employees WHERE account_id = 1 ORDER BY id DESC LIMIT 1",
        String.class);
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
        .andExpect(jsonPath("$.data.createdByName").value(creatorName))
        .andReturn();

    String tenantId = com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(),
        "$.data.id")
        .toString();
    long tenantIdValue = Long.parseLong(tenantId);

    Long tenantAccountId = jdbcTemplate.queryForObject(
        "SELECT id FROM accounts WHERE phone = '15926626946'",
        Long.class);
    assertThat(tenantAccountId).isNotNull();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenant_businesses WHERE tenant_id = ? AND business_type = 'cityPartner' AND status = 'enabled'",
        Integer.class,
        tenantIdValue)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT created_by_account_id FROM tenants WHERE id = ?",
        Long.class,
        tenantIdValue)).isEqualTo(1L);
    Long tenantIdentityId = jdbcTemplate.queryForObject(
        "SELECT id FROM account_identities WHERE account_id = ? AND identity_type = 'tenant_admin' AND tenant_id = ? AND store_id IS NULL",
        Long.class,
        tenantAccountId,
        tenantIdValue);
    assertThat(tenantIdentityId).isNotNull();

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

    mockMvc.perform(patch("/api/admin/tenants/{id}/businesses", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"businessTypes\":\"cityPartner\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.businessTypes").value("cityPartner"));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenant_businesses WHERE tenant_id = ? AND business_type = 'cityPartner' AND status = 'enabled'",
        Integer.class,
        tenantIdValue)).isEqualTo(1);

    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));
    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"enabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("enabled"));

    Long storeLevelId = jdbcTemplate.queryForObject(
        "SELECT id FROM store_levels WHERE status = 'enabled' ORDER BY id LIMIT 1",
        Long.class);
    mockMvc.perform(post("/api/admin/stores")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "tenantId": %d,
                  "name": "未开通业务的测试门店",
                  "type": "slabSupplier",
                  "storeLevelId": %d,
                  "status": "enabled"
                }
                """.formatted(tenantIdValue, storeLevelId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该租户未启用对应业务，不能创建或变更为该类型门店"));

    MvcResult storeCreateResult = mockMvc.perform(post("/api/admin/stores")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "tenantId": %d,
                  "name": "集成测试租户门店",
                  "type": "cityPartner",
                  "storeLevelId": %d,
                  "status": "enabled"
                }
                """.formatted(tenantIdValue, storeLevelId)))
        .andExpect(status().isOk())
        .andReturn();
    long storeId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        storeCreateResult.getResponse().getContentAsString(),
        "$.data.id").toString());
    String manuallyArchivedStoreName = "租户恢复保留归档门店-" + tenantIdValue;
    jdbcTemplate.update(
        """
        INSERT INTO stores
          (tenant_id, name, type, store_level_id, status, archived_by_tenant, created_by)
        VALUES (?, ?, 'cityPartner', ?, 'disabled', 0, '集成测试')
        """,
        tenantIdValue,
        manuallyArchivedStoreName,
        storeLevelId);
    Long manuallyArchivedStoreId = jdbcTemplate.queryForObject(
        "SELECT id FROM stores WHERE name = ?",
        Long.class,
        manuallyArchivedStoreName);

    Long storeIdentityId = jdbcTemplate.queryForObject(
        "SELECT id FROM account_identities WHERE account_id = ? AND identity_type = 'store_admin' AND store_id = ?",
        Long.class,
        tenantAccountId,
        storeId);
    assertThat(storeIdentityId).isNotNull();

    MvcResult loginResult = mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("""
                {
                  "phone": "15926626946",
                  "verifyCode": "888888"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.identityType").value("store_admin"))
        .andExpect(jsonPath("$.data.user.storeId").value(storeId))
        .andReturn();
    String tenantToken = com.jayway.jsonpath.JsonPath.read(
        loginResult.getResponse().getContentAsString(),
        "$.data.token");

    mockMvc.perform(get("/api/admin/auth/contexts")
            .header("Authorization", "Bearer " + tenantToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.identityType == 'tenant_admin')].tenantId")
            .value(hasItem((int) tenantIdValue)))
        .andExpect(jsonPath("$.data[?(@.identityType == 'store_admin')].storeId")
            .value(hasItem((int) storeId)));

    MvcResult tenantSwitchResult = mockMvc.perform(post("/api/admin/auth/switch-identity")
            .header("Authorization", "Bearer " + tenantToken)
            .contentType("application/json")
            .content("""
                {"identityId": %d}
                """.formatted(tenantIdentityId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.user.identityType").value("tenant_admin"))
        .andExpect(jsonPath("$.data.user.tenantId").value(tenantIdValue))
        .andExpect(jsonPath("$.data.user.storeId").doesNotExist())
        .andReturn();
    String tenantAdminToken = com.jayway.jsonpath.JsonPath.read(
        tenantSwitchResult.getResponse().getContentAsString(),
        "$.data.token");

    jdbcTemplate.update("UPDATE stores SET status = 'disabled' WHERE id = ?", storeId);
    mockMvc.perform(get("/api/admin/auth/contexts")
            .header("Authorization", "Bearer " + tenantAdminToken))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.storeId == %d)]".formatted(storeId)).isEmpty());
    mockMvc.perform(post("/api/admin/auth/switch-identity")
            .header("Authorization", "Bearer " + tenantAdminToken)
            .contentType("application/json")
            .content("""
                {"identityId": %d}
                """.formatted(storeIdentityId)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该门店已停止运营"));
    jdbcTemplate.update("UPDATE stores SET status = 'enabled' WHERE id = ?", storeId);

    mockMvc.perform(get("/api/admin/tenants/{id}/purge-preview", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.eligible").value(false))
        .andExpect(jsonPath("$.data.blockers[0]").value("请先归档租户"));

    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM account_identities WHERE id = ?",
        String.class,
        tenantIdentityId)).isEqualTo("enabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM stores WHERE id = ?",
        String.class,
        storeId)).isEqualTo("disabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT archived_by_tenant FROM stores WHERE id = ?",
        Boolean.class,
        storeId)).isTrue();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM stores WHERE id = ?",
        String.class,
        manuallyArchivedStoreId)).isEqualTo("disabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT archived_by_tenant FROM stores WHERE id = ?",
        Boolean.class,
        manuallyArchivedStoreId)).isFalse();
    mockMvc.perform(patch("/api/admin/stores/{id}/restore", storeId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("所属租户已归档，不能恢复门店运营"));
    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"enabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("enabled"));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM stores WHERE id = ?",
        String.class,
        storeId)).isEqualTo("enabled");
    assertThat(jdbcTemplate.queryForObject(
        "SELECT archived_by_tenant FROM stores WHERE id = ?",
        Boolean.class,
        storeId)).isFalse();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT status FROM stores WHERE id = ?",
        String.class,
        manuallyArchivedStoreId)).isEqualTo("disabled");
    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value("disabled"));
    mockMvc.perform(get("/api/admin/auth/contexts")
            .header("Authorization", "Bearer " + tenantAdminToken))
        .andExpect(status().isUnauthorized());
    mockMvc.perform(post("/api/admin/auth/login")
            .contentType("application/json")
            .content("{\"phone\":\"15926626946\",\"verifyCode\":\"888888\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("所属租户已归档，请联系平台运营"));

    mockMvc.perform(get("/api/admin/tenants/{id}/purge-preview", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.eligible").value(true))
        .andExpect(jsonPath("$.data.storeCount").value(2))
        .andExpect(jsonPath("$.data.accountDeleteCount").value(1))
        .andExpect(jsonPath("$.data.accountRetainCount").value(0));
    mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"confirmationName\":\"错误名称\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("请输入完整租户名称确认删除"));
    mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantIdValue)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"confirmationName\":\"集成测试租户-已更新\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.tenantDeleteCount").value(1))
        .andExpect(jsonPath("$.data.storeDeleteCount").value(2))
        .andExpect(jsonPath("$.data.accountDeleteCount").value(1));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM accounts WHERE id = ?",
        Integer.class,
        tenantAccountId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM stores WHERE id = ?",
        Integer.class,
        storeId)).isZero();
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM stores WHERE id = ?",
        Integer.class,
        manuallyArchivedStoreId)).isZero();
  }

  @Test
  void slabPublishOptionsComeFromReferenceTablesAndSelectionsArePersisted() throws Exception {
    String suffix = String.valueOf(System.nanoTime());
    String colorCategoryName = "大板发布色系分类-" + suffix;
    String colorName = "大板发布色系-" + suffix;
    String gradeCode = "P" + suffix.substring(Math.max(0, suffix.length() - 6));
    String gradeName = "大板发布等级-" + suffix;
    String serialNo = "SLAB-PUBLISH-" + suffix;
    String supplierName = "大板审核供应商-" + suffix;

    jdbcTemplate.update(
        """
        INSERT INTO suppliers
          (owner_scope, owner_id, tenant_id, store_id, name, status, created_by_name, created_by_account_id)
        VALUES ('platform', 0, NULL, NULL, ?, 'enabled', '超级管理员', 1)
        """,
        supplierName);
    Long supplierId = jdbcTemplate.queryForObject(
        "SELECT id FROM suppliers WHERE name = ?", Long.class, supplierName);

    jdbcTemplate.update(
        "INSERT INTO slab_color_categories (name, status) VALUES (?, 'enabled')",
        colorCategoryName);
    Long colorCategoryId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_color_categories WHERE name = ?", Long.class, colorCategoryName);
    jdbcTemplate.update(
        "INSERT INTO slab_colors (category_id, name, status) VALUES (?, ?, 'enabled')",
        colorCategoryId,
        colorName);
    Long colorId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_colors WHERE name = ?", Long.class, colorName);
    jdbcTemplate.update(
        "INSERT INTO slab_grades (code, name, status) VALUES (?, ?, 'enabled')",
        gradeCode,
        gradeName);
    Long gradeId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_grades WHERE code = ?", Long.class, gradeCode);
    Long textureId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_textures WHERE name = '细纹'", Long.class);
    jdbcTemplate.update(
        """
        INSERT INTO slab_markup_configurations
          (name, price_coefficient, sort_order, status, created_by_name, created_by_account_id)
        VALUES
          ('1级合伙人价格', 0.5000, 1, 'enabled', '超级管理员', 1),
          ('2级合伙人价格', 1.3000, 2, 'enabled', '超级管理员', 1),
          ('3级合伙人价格', 1.1800, 3, 'enabled', '超级管理员', 1)
        """);
    Long level1ConfigurationId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_markup_configurations WHERE name = '1级合伙人价格'",
        Long.class);
    Long level2ConfigurationId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_markup_configurations WHERE name = '2级合伙人价格'",
        Long.class);
    Long level3ConfigurationId = jdbcTemplate.queryForObject(
        "SELECT id FROM slab_markup_configurations WHERE name = '3级合伙人价格'",
        Long.class);
    Long mainImageMediaId = uploadSlabMedia("main.png", "image/png");
    Long scanImageMediaId = uploadSlabMedia("scan.png", "image/png");
    Long designImageMediaId = uploadSlabMedia("design.png", "image/png");
    Long videoMediaId = uploadSlabMedia("product.mp4", "video/mp4");
    Long videoCoverMediaId = uploadSlabMedia("video-cover.jpg", "image/jpeg");

    Long slabId = null;
    Long interfaceSlabId = null;
    Long deletedInterfaceSlabId = null;
    try {
      mockMvc.perform(get("/api/admin/slabs/publish-options")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.textures[*].label", hasItem("细纹")))
          .andExpect(jsonPath("$.data.colorCategories[*].label", hasItem(colorCategoryName)))
          .andExpect(jsonPath("$.data.colorCategories[*].children[*].label", hasItem(colorName)))
          .andExpect(jsonPath("$.data.grades[*].label", hasItem(gradeCode)))
          .andExpect(jsonPath("$.data.grades[*].description", hasItem(gradeName)));

      MvcResult slabResult = mockMvc.perform(post("/api/admin/slabs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "name":"大板发布选项测试",
                    "serialNo":"%s",
                    "supplierId":%d,
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "videoMediaId":%d,
                    "videoCoverMediaId":%d,
                    "varietyId":1,
                    "originId":1,
                    "textureId":%d,
                    "colorId":%d,
                    "gradeId":%d,
                    "lengthMm":3200.50,
                    "widthMm":1800.25,
                    "thicknessMm":18.50,
                    "toleranceMm":2.25,
                    "corner1LengthMm":100.50,
                    "corner1WidthMm":80.25,
                    "corner2LengthMm":101.50,
                    "corner2WidthMm":81.25,
                    "corner3LengthMm":102.50,
                    "corner3WidthMm":82.25,
                    "corner4LengthMm":103.50,
                    "corner4WidthMm":83.25,
                    "costPrice":100,
                    "guidePrice":160,
                    "guidePriceCoefficient":1.60,
                    "markupPrices":[
                      {"markupConfigurationId":%d,"priceCoefficient":0.50,"costPrice":100,"price":50},
                      {"markupConfigurationId":%d,"priceCoefficient":1.30,"costPrice":100,"price":130},
                      {"markupConfigurationId":%d,"priceCoefficient":1.18,"costPrice":100,"price":118}
                    ],
                    "status":"warehouse"
                  }
                  """.formatted(
                      serialNo,
                      supplierId,
                      mainImageMediaId,
                      scanImageMediaId,
                      designImageMediaId,
                      videoMediaId,
                      videoCoverMediaId,
                      textureId,
                      colorId,
                      gradeId,
                      level1ConfigurationId,
                      level2ConfigurationId,
                      level3ConfigurationId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.textureId").value(textureId))
          .andExpect(jsonPath("$.data.colorId").value(colorId))
          .andExpect(jsonPath("$.data.gradeId").value(gradeId))
          .andExpect(jsonPath("$.data.mainImageMediaId").value(mainImageMediaId))
          .andExpect(jsonPath("$.data.scanImageMediaId").value(scanImageMediaId))
          .andExpect(jsonPath("$.data.designImageMediaId").value(designImageMediaId))
          .andExpect(jsonPath("$.data.videoMediaId").value(videoMediaId))
          .andExpect(jsonPath("$.data.videoCoverMediaId").value(videoCoverMediaId))
          .andExpect(jsonPath("$.data.mainImageUrl", containsString("/api/open/media/")))
          .andExpect(jsonPath("$.data.originId").value(1))
          .andExpect(jsonPath("$.data.publisherType").value("平台发布"))
          .andExpect(jsonPath("$.data.createdByName").value("超级管理员"))
          .andExpect(jsonPath("$.data.lengthMm").value(3200.50))
          .andExpect(jsonPath("$.data.corner4WidthMm").value(83.25))
          .andReturn();
      slabId = Long.valueOf(com.jayway.jsonpath.JsonPath.read(
          slabResult.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(post("/api/admin/slabs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "name":"重复编码大板",
                    "serialNo":"%s",
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "status":"warehouse"
                  }
                  """.formatted(serialNo, mainImageMediaId, scanImageMediaId, designImageMediaId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("SKU已存在"));

      MvcResult interfaceSlabResult = mockMvc.perform(post("/api/admin/slabs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "name":"接口获取大板",
                    "serialNo":"%s-interface",
                    "publisherType":"接口获取",
                    "supplierId":%d,
                    "varietyId":1,
                    "originId":1,
                    "textureId":%d,
                    "colorId":%d,
                    "gradeId":%d,
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "lengthMm":3200,
                    "widthMm":1800,
                    "thicknessMm":18,
                    "costPrice":100,
                    "guidePrice":160,
                    "guidePriceCoefficient":1.60,
                    "markupPrices":[
                      {"markupConfigurationId":%d,"priceCoefficient":0.50,"costPrice":100,"price":50},
                      {"markupConfigurationId":%d,"priceCoefficient":1.30,"costPrice":100,"price":130},
                      {"markupConfigurationId":%d,"priceCoefficient":1.18,"costPrice":100,"price":118}
                    ],
                    "status":"warehouse"
                  }
                  """.formatted(
                      serialNo,
                      supplierId,
                      textureId,
                      colorId,
                      gradeId,
                      mainImageMediaId,
                      scanImageMediaId,
                      designImageMediaId,
                      level1ConfigurationId,
                      level2ConfigurationId,
                      level3ConfigurationId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.publisherType").value("接口获取"))
          .andExpect(jsonPath("$.data.createdByName").value("外部系统"))
          .andExpect(jsonPath("$.data.createdByAccountId").doesNotExist())
          .andExpect(jsonPath("$.data.status").value("warehouse"))
          .andReturn();
      interfaceSlabId = Long.valueOf(com.jayway.jsonpath.JsonPath.read(
          interfaceSlabResult.getResponse().getContentAsString(), "$.data.id").toString());

      MvcResult deletedInterfaceSlabResult = mockMvc.perform(post("/api/admin/slabs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "name":"待删除接口大板",
                    "serialNo":"%s-deleted-interface",
                    "publisherType":"接口获取",
                    "supplierId":%d,
                    "varietyId":1,
                    "originId":1,
                    "textureId":%d,
                    "colorId":%d,
                    "gradeId":%d,
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "lengthMm":3200,
                    "widthMm":1800,
                    "thicknessMm":18,
                    "costPrice":100,
                    "guidePrice":160,
                    "guidePriceCoefficient":1.60,
                    "markupPrices":[
                      {"markupConfigurationId":%d,"priceCoefficient":0.50,"costPrice":100,"price":50},
                      {"markupConfigurationId":%d,"priceCoefficient":1.30,"costPrice":100,"price":130},
                      {"markupConfigurationId":%d,"priceCoefficient":1.18,"costPrice":100,"price":118}
                    ],
                    "status":"warehouse"
                  }
                  """.formatted(
                      serialNo,
                      supplierId,
                      textureId,
                      colorId,
                      gradeId,
                      mainImageMediaId,
                      scanImageMediaId,
                      designImageMediaId,
                      level1ConfigurationId,
                      level2ConfigurationId,
                      level3ConfigurationId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.status").value("warehouse"))
          .andReturn();
      deletedInterfaceSlabId = Long.valueOf(com.jayway.jsonpath.JsonPath.read(
          deletedInterfaceSlabResult.getResponse().getContentAsString(), "$.data.id").toString());

      mockMvc.perform(post("/api/admin/slabs/{id}/delete", deletedInterfaceSlabId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"reason":"资料不完整"}
                  """))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      Integer deletedInterfaceCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_inventory WHERE id = ?", Integer.class, deletedInterfaceSlabId);
      assertThat(deletedInterfaceCount).isZero();
      mockMvc.perform(get("/api/admin/slabs/operation-logs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.records[?(@.slabId == " + deletedInterfaceSlabId
              + ")].operationType", hasItem("PHYSICAL_DELETE")))
          .andExpect(jsonPath("$.data.records[?(@.slabId == " + deletedInterfaceSlabId
              + ")].standardReason", hasItem("资料不完整")))
          .andExpect(jsonPath("$.data.records[?(@.slabId == " + deletedInterfaceSlabId
              + ")].operatorName", hasItem("超级管理员")));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT detail_reason FROM slab_operation_logs WHERE slab_id = ? AND operation_type = 'PHYSICAL_DELETE'",
          String.class,
          deletedInterfaceSlabId)).isNull();

      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"ids":[%d,%d],"status":"selling"}
                  """.formatted(slabId, interfaceSlabId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      Integer sellingCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_inventory WHERE id IN (?, ?) AND status = 'selling'",
          Integer.class,
          slabId,
          interfaceSlabId);
      assertThat(sellingCount).isEqualTo(2);
      Integer unchangedPriceCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_prices WHERE slab_id = ?",
          Integer.class,
          slabId);
      assertThat(unchangedPriceCount).isEqualTo(3);
      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"ids":[%d,%d],"status":"offShelf","reason":"价格调整","detail":"批量调整指导价"}
                  """.formatted(slabId, interfaceSlabId)))
          .andExpect(status().isOk());
      Map<String, Object> offShelfRecord = jdbcTemplate.queryForMap(
          """
          SELECT inventory.status, record.standard_reason, record.detail_reason, record.off_shelved_by_name
          FROM slab_inventory inventory
          INNER JOIN slab_off_shelf_records record ON record.slab_id = inventory.id
          WHERE inventory.id = ?
          """,
          slabId);
      assertThat(offShelfRecord.get("status")).isEqualTo("offShelf");
      assertThat(offShelfRecord.get("standard_reason")).isEqualTo("价格调整");
      assertThat(offShelfRecord.get("detail_reason")).isEqualTo("批量调整指导价");
      assertThat(offShelfRecord.get("off_shelved_by_name")).isEqualTo("超级管理员");
      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"ids":[%d,%d],"status":"warehouse"}
                  """.formatted(slabId, interfaceSlabId)))
          .andExpect(status().isOk());
      Integer retainedHistoryCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_off_shelf_records WHERE slab_id = ?",
          Integer.class,
          slabId);
      assertThat(retainedHistoryCount).isEqualTo(1);
      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"ids":[%d],"status":"selling"}
                  """.formatted(slabId)))
          .andExpect(status().isOk());
      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {"ids":[%d],"status":"offShelf","reason":"库存异常","detail":"盘点数量不一致"}
                  """.formatted(slabId)))
          .andExpect(status().isOk());
      List<Map<String, Object>> offShelfHistory = jdbcTemplate.queryForList(
          """
          SELECT standard_reason, detail_reason, off_shelved_by_name
          FROM slab_off_shelf_records
          WHERE slab_id = ?
          ORDER BY off_shelved_at DESC, id DESC
          """,
          slabId);
      assertThat(offShelfHistory).hasSize(2);
      assertThat(offShelfHistory.get(0).get("standard_reason")).isEqualTo("库存异常");
      assertThat(offShelfHistory.get(0).get("detail_reason")).isEqualTo("盘点数量不一致");
      assertThat(offShelfHistory.get(1).get("standard_reason")).isEqualTo("价格调整");

      jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = ?", interfaceSlabId);
      interfaceSlabId = null;

      Integer persistedCount = jdbcTemplate.queryForObject(
          """
          SELECT COUNT(*) FROM slab_inventory
          WHERE id = ? AND texture_id = ? AND color_id = ? AND grade_id = ?
            AND origin_id = 1 AND created_by_name = '超级管理员'
            AND main_image_media_id = ? AND scan_image_media_id = ? AND design_image_media_id = ?
            AND video_media_id = ? AND video_cover_media_id = ?
            AND length_mm = 3200.50 AND width_mm = 1800.25 AND thickness_mm = 18.50
            AND tolerance_mm = 2.25
            AND corner1_length_mm = 100.50 AND corner1_width_mm = 80.25
            AND corner2_length_mm = 101.50 AND corner2_width_mm = 81.25
            AND corner3_length_mm = 102.50 AND corner3_width_mm = 82.25
            AND corner4_length_mm = 103.50 AND corner4_width_mm = 83.25
          """,
          Integer.class,
          slabId,
          textureId,
          colorId,
          gradeId,
          mainImageMediaId,
          scanImageMediaId,
          designImageMediaId,
          videoMediaId,
          videoCoverMediaId);
      assertThat(persistedCount).isEqualTo(1);
      Integer persistedPriceCount = jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_prices WHERE slab_id = ?",
          Integer.class,
          slabId);
      assertThat(persistedPriceCount).isEqualTo(3);

      mockMvc.perform(put("/api/admin/slab-guide-price-setting")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "priceCoefficient":1.61
                  }
                  """))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.priceCoefficient").value(1.61));

      mockMvc.perform(get("/api/admin/slabs")
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[?(@.id == " + slabId + ")].originName", hasItem("巴西")))
          .andExpect(jsonPath(
              "$.data[?(@.id == " + slabId + ")].offShelfRecords[0].standardReason", hasItem("库存异常")))
          .andExpect(jsonPath(
              "$.data[?(@.id == " + slabId + ")].offShelfRecords[0].detailReason", hasItem("盘点数量不一致")))
          .andExpect(jsonPath(
              "$.data[?(@.id == " + slabId + ")].offShelfRecords[0].offShelvedByName", hasItem("超级管理员")))
          .andExpect(jsonPath(
              "$.data[?(@.id == " + slabId + ")].offShelfRecords[1].standardReason", hasItem("价格调整")))
          .andExpect(jsonPath("$.data[?(@.id == " + slabId + ")].guidePriceCoefficient", hasItem(1.60)))
          .andExpect(jsonPath("$.data[?(@.id == " + slabId + ")].markupPrices[0].price", hasItem(50.00)));
      assertThat(jdbcTemplate.queryForObject(
          """
          SELECT CONCAT(guide_price_coefficient, ':', guide_price)
          FROM slab_inventory
          WHERE id = ?
          """,
          String.class,
          slabId)).isEqualTo("1.6000:160.00");

      mockMvc.perform(put("/api/admin/slabs/{id}", slabId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("""
                  {
                    "name":"大板发布选项测试",
                    "serialNo":"%s",
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "textureId":999999999,
                    "colorId":%d,
                    "gradeId":%d,
                    "status":"warehouse"
                  }
                  """.formatted(
                      serialNo,
                      mainImageMediaId,
                      scanImageMediaId,
                      designImageMediaId,
                      colorId,
                      gradeId)))
          .andExpect(status().isBadRequest())
          .andExpect(jsonPath("$.message").value("纹理不存在"));

      mockMvc.perform(post("/api/admin/slabs/{id}/delete", slabId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{}"))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT status FROM slab_inventory WHERE id = ?", String.class, slabId)).isEqualTo("recycle");
      mockMvc.perform(delete("/api/admin/slabs/{id}", slabId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data").value(true));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_inventory WHERE id = ?", Integer.class, slabId)).isZero();
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id = ?", Integer.class, slabId)).isGreaterThan(2);
    } finally {
      jdbcTemplate.update("DELETE FROM slab_guide_price_settings WHERE id = 1");
      if (slabId != null) {
        jdbcTemplate.update(
            "DELETE FROM slab_prices WHERE slab_id = ?",
            slabId);
        jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = ?", slabId);
        jdbcTemplate.update("DELETE FROM slab_operation_logs WHERE slab_id = ?", slabId);
      }
      if (interfaceSlabId != null) {
        jdbcTemplate.update("DELETE FROM slab_operation_logs WHERE slab_id = ?", interfaceSlabId);
        jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = ?", interfaceSlabId);
      }
      if (deletedInterfaceSlabId != null) {
        jdbcTemplate.update("DELETE FROM slab_operation_logs WHERE slab_id = ?", deletedInterfaceSlabId);
      }
      jdbcTemplate.update(
          "DELETE FROM slab_markup_configurations WHERE id IN (?, ?, ?)",
          level1ConfigurationId,
          level2ConfigurationId,
          level3ConfigurationId);
      jdbcTemplate.update("DELETE FROM slab_grades WHERE id = ?", gradeId);
      jdbcTemplate.update("DELETE FROM slab_colors WHERE id = ?", colorId);
      jdbcTemplate.update("DELETE FROM slab_color_categories WHERE id = ?", colorCategoryId);
      jdbcTemplate.update("DELETE FROM suppliers WHERE id = ?", supplierId);
    }
  }

  @Test
  void slabManagementIgnoresDataPermissionAndCreatorForAllOperations() throws Exception {
    long operatorId = 98996L;
    String token = createStoreScopedEmployee(
        operatorId,
        "15926628996",
        "大板共享操作员",
        "admin.slab-management.view,admin.slab-management.warehouse.publish,"
            + "admin.slab-management.warehouse.edit,admin.slab-management.off-shelf.restore,"
            + "admin.slab-management.warehouse.delete,admin.slab-management.recycle.purge,"
            + "admin.slab-management.operation-log.view");
    jdbcTemplate.update("UPDATE employees SET data_permission = 'self' WHERE id = ?", operatorId);
    Long mainImageMediaId = uploadSlabMedia("shared-main.png", "image/png");
    Long scanImageMediaId = uploadSlabMedia("shared-scan.png", "image/png");
    Long designImageMediaId = uploadSlabMedia("shared-design.png", "image/png");
    String sku = "SLAB-SHARED-" + System.nanoTime();
    Long slabId = null;

    try {
      jdbcTemplate.update(
          """
          INSERT INTO slab_inventory
            (name, serial_no, publisher_type, main_image_media_id, scan_image_media_id,
             design_image_media_id, status, created_by_name, created_by_account_id)
          VALUES (?, ?, '平台发布', ?, ?, ?, 'warehouse', '其他用户', 1)
          """,
          "共享大板权限测试",
          sku,
          mainImageMediaId,
          scanImageMediaId,
          designImageMediaId);
      slabId = jdbcTemplate.queryForObject(
          "SELECT id FROM slab_inventory WHERE serial_no = ?", Long.class, sku);
      jdbcTemplate.update(
          "UPDATE media_assets SET status = 'active', confirmed_at = NOW(), last_referenced_at = NOW() WHERE id IN (?, ?, ?)",
          mainImageMediaId,
          scanImageMediaId,
          designImageMediaId);
      jdbcTemplate.update(
          """
          INSERT INTO media_references
            (media_id, business_domain, business_id, field_key, owner_client_code)
          VALUES
            (?, 'SLAB', ?, 'mainImage', 'ADMIN'),
            (?, 'SLAB', ?, 'scanImage', 'ADMIN'),
            (?, 'SLAB', ?, 'designImage', 'ADMIN')
          """,
          mainImageMediaId,
          slabId,
          scanImageMediaId,
          slabId,
          designImageMediaId,
          slabId);

      mockMvc.perform(get("/api/admin/slabs")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data[?(@.id == " + slabId + ")].createdByName", hasItem("其他用户")));

      mockMvc.perform(put("/api/admin/slabs/{id}", slabId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {
                    "name":"其他用户大板-已编辑",
                    "serialNo":"%s",
                    "mainImageMediaId":%d,
                    "scanImageMediaId":%d,
                    "designImageMediaId":%d,
                    "status":"warehouse"
                  }
                  """.formatted(sku, mainImageMediaId, scanImageMediaId, designImageMediaId)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.name").value("其他用户大板-已编辑"))
          .andExpect(jsonPath("$.data.createdByAccountId").value(1));

      jdbcTemplate.update("UPDATE slab_inventory SET status = 'offShelf' WHERE id = ?", slabId);
      mockMvc.perform(put("/api/admin/slabs/batch-status")
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("""
                  {"ids":[%d],"status":"warehouse"}
                  """.formatted(slabId)))
          .andExpect(status().isOk());

      mockMvc.perform(post("/api/admin/slabs/{id}/delete", slabId)
              .header("Authorization", "Bearer " + token)
              .contentType("application/json")
              .content("{}"))
          .andExpect(status().isOk());
      mockMvc.perform(get("/api/admin/slabs/operation-logs")
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.records[?(@.slabId == " + slabId
              + ")].operatorName", hasItem("大板共享操作员")))
          .andExpect(jsonPath("$.data.records[?(@.slabId == " + slabId
              + ")].operationType", hasItem("UPDATE")));
      mockMvc.perform(delete("/api/admin/slabs/{id}", slabId)
              .header("Authorization", "Bearer " + token))
          .andExpect(status().isOk());
      slabId = null;
    } finally {
      if (slabId != null) {
        jdbcTemplate.update("DELETE FROM slab_prices WHERE slab_id = ?", slabId);
        jdbcTemplate.update("DELETE FROM slab_off_shelf_records WHERE slab_id = ?", slabId);
        jdbcTemplate.update(
            "DELETE FROM media_references WHERE business_domain = 'SLAB' AND business_id = ?",
            slabId);
        jdbcTemplate.update("DELETE FROM slab_inventory WHERE id = ?", slabId);
        jdbcTemplate.update("DELETE FROM slab_operation_logs WHERE slab_id = ?", slabId);
      }
      cleanupStoreScopedEmployee(operatorId);
    }
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

  @Test
  void tenantPurgeRetainsAccountsWithExternalIdentities() throws Exception {
    String tenantName = "共享账号保留测试租户";
    String phone = "15926626948";
    MvcResult createResult = mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "contactName":"共享账号联系人",
                  "contactPhone":"%s",
                  "status":"enabled"
                }
                """.formatted(tenantName, phone)))
        .andExpect(status().isOk())
        .andReturn();
    long tenantId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(), "$.data.id").toString());
    Long accountId = jdbcTemplate.queryForObject(
        "SELECT id FROM accounts WHERE phone = ?", Long.class, phone);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'customer', 'customer', ?, NULL, NULL, 'enabled')
        """,
        accountId,
        accountId);

    try {
      mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"status\":\"disabled\"}"))
          .andExpect(status().isOk());
      mockMvc.perform(get("/api/admin/tenants/{id}/purge-preview", tenantId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.accountDeleteCount").value(0))
          .andExpect(jsonPath("$.data.accountRetainCount").value(1));
      mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantId)
              .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
              .contentType("application/json")
              .content("{\"confirmationName\":\"%s\"}".formatted(tenantName)))
          .andExpect(status().isOk())
          .andExpect(jsonPath("$.data.accountDeleteCount").value(0))
          .andExpect(jsonPath("$.data.accountRetainCount").value(1));
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM accounts WHERE id = ?", Integer.class, accountId)).isEqualTo(1);
      assertThat(jdbcTemplate.queryForObject(
          "SELECT COUNT(*) FROM account_identities WHERE account_id = ? AND client_code = 'customer'",
          Integer.class,
          accountId)).isEqualTo(1);
    } finally {
      jdbcTemplate.update(
          "DELETE FROM account_identities WHERE account_id = ? AND client_code = 'customer'",
          accountId);
      jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", accountId);
    }
  }

  @Test
  void tenantPurgeBlocksUndefinedCrossOrganizationProductReferences() throws Exception {
    String tenantName = "跨组织删除阻断测试租户";
    String phone = "15926626949";
    MvcResult createResult = mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name":"%s",
                  "contactName":"跨组织测试联系人",
                  "contactPhone":"%s",
                  "status":"enabled"
                }
                """.formatted(tenantName, phone)))
        .andExpect(status().isOk())
        .andReturn();
    long tenantId = Long.parseLong(com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(), "$.data.id").toString());
    jdbcTemplate.update(
        "INSERT INTO product_categories (tenant_id, scope, name, status) VALUES (?, 'finished', ?, 'enabled')",
        tenantId,
        "跨组织阻断分类-" + tenantId);
    Long categoryId = jdbcTemplate.queryForObject(
        "SELECT id FROM product_categories WHERE tenant_id = ?", Long.class, tenantId);
    jdbcTemplate.update(
        "INSERT INTO finished_products (category_id, name, sku, status) VALUES (?, '跨组织阻断成品', ?, 'warehouse')",
        categoryId,
        "TENANT-PURGE-BLOCK-" + tenantId);
    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk());

    mockMvc.perform(get("/api/admin/tenants/{id}/purge-preview", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.eligible").value(false))
        .andExpect(jsonPath("$.data.blockers[0]")
            .value("该租户存在暂不支持删除的跨组织业务数据"));
    mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"confirmationName\":\"%s\"}".formatted(tenantName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该租户存在暂不支持删除的跨组织业务数据"));
    assertThat(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM tenants WHERE id = ?", Integer.class, tenantId)).isEqualTo(1);

    jdbcTemplate.update("DELETE FROM finished_products WHERE category_id = ?", categoryId);
    mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"confirmationName\":\"%s\"}".formatted(tenantName)))
        .andExpect(status().isOk());
  }

  @Test
  void tenantCreationAllowsDuplicateNameAndRejectsDuplicatePhone() throws Exception {
    MvcResult createResult = mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "装点猫直营租户",
                  "contactName": "同名租户联系人",
                  "contactPhone": "15926626947",
                  "status": "enabled",
                  "businessTypes": "",
                  "remark": "允许租户同名"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.name").value("装点猫直营租户"))
        .andReturn();

    String tenantId = com.jayway.jsonpath.JsonPath.read(
        createResult.getResponse().getContentAsString(),
        "$.data.id").toString();

    mockMvc.perform(post("/api/admin/tenants")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("""
                {
                  "name": "另一个租户姓名",
                  "contactName": "重复手机号联系人",
                  "contactPhone": "15926626947",
                  "status": "enabled",
                  "businessTypes": "",
                  "remark": ""
                }
                """))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("该手机号已存在"));

    mockMvc.perform(patch("/api/admin/tenants/{id}/status", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk());
    mockMvc.perform(post("/api/admin/tenants/{id}/purge", tenantId)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN)
            .contentType("application/json")
            .content("{\"confirmationName\":\"装点猫直营租户\"}"))
        .andExpect(status().isOk());
  }

  private String createStoreScopedEmployee(
      long id,
      String phone,
      String name,
      String permissions) {
    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status, created_by) VALUES (?, 1, ?, 'cityPartner', 'enabled', '集成测试')",
        id,
        name + "门店");
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, account_type, status) VALUES (?, ?, ?, 'person', 'enabled')",
        id,
        phone,
        name);
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, role_ids,
           data_permission, created_by_name, created_by_account_id)
        VALUES (?, ?, 1, ?, ?, ?, 'enabled', ?, 'all', ?, ?)
        """,
        id,
        id,
        id,
        name,
        phone,
        String.valueOf(id),
        name,
        id);
    jdbcTemplate.update(
        """
        INSERT INTO account_identities
          (account_id, client_code, identity_type, subject_id, tenant_id, store_id, status)
        VALUES (?, 'admin', 'employee', ?, 1, ?, 'enabled')
        """,
        id,
        id,
        id);
    jdbcTemplate.update(
        """
        INSERT INTO roles
          (id, tenant_id, store_id, name, code, data_scope, status,
           function_permissions, created_by_name, created_by_account_id)
        VALUES (?, 1, ?, ?, ?, 'all', 'enabled', ?, ?, ?)
        """,
        id,
        id,
        name + "角色",
        "STORE_SCOPED_TEST_" + id,
        permissions,
        name,
        id);
    jdbcTemplate.update(
        "INSERT INTO account_roles (account_id, role_id, client_code, tenant_id, store_id) VALUES (?, ?, 'admin', 1, ?)",
        id,
        id,
        id);
    return TokenAuthenticationFilter.createAccountToken(id);
  }

  private void cleanupStoreScopedEmployee(long id) {
    jdbcTemplate.update("DELETE FROM account_roles WHERE account_id = ? OR role_id = ?", id, id);
    jdbcTemplate.update("DELETE FROM account_identities WHERE account_id = ?", id);
    jdbcTemplate.update("DELETE FROM employees WHERE id = ?", id);
    jdbcTemplate.update("DELETE FROM roles WHERE id = ?", id);
    jdbcTemplate.update("DELETE FROM accounts WHERE id = ?", id);
    jdbcTemplate.update("DELETE FROM stores WHERE id = ?", id);
  }

  private Long uploadSlabMedia(String filename, String mimeType) throws Exception {
    MockMultipartFile file = new MockMultipartFile(
        "file", filename, mimeType, new byte[] {0x01, 0x02, 0x03, 0x04});
    MvcResult result = mockMvc.perform(multipart("/api/admin/slabs/images")
            .file(file)
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.DEV_TOKEN))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.id").isNumber())
        .andExpect(jsonPath("$.data.url", containsString("/api/open/media/")))
        .andReturn();
    return Long.valueOf(com.jayway.jsonpath.JsonPath.read(
        result.getResponse().getContentAsString(), "$.data.id").toString());
  }
}
