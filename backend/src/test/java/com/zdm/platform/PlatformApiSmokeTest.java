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

    assertThat(migrationCount).isGreaterThanOrEqualTo(44);
    assertThat(superAdminCount).isEqualTo(1);
    assertThat(emptyTerminalPolicyCount).isEqualTo(2);
    assertThat(legacyReadPermissionCount).isZero();
    assertThat(craftWithoutCreatorCount).isZero();
    assertThat(categoryWithoutCreatorCount).isZero();
    assertThat(slabVarietyWithoutCreatorCount).isZero();
    assertThat(sampleSupplierCount).isZero();
    assertThat(sampleSupplierBusinessRecordCount).isZero();
    assertThat(adminManagerPermissions)
        .contains("admin.permission-management.employee-management.view")
        .contains("admin.permission-management.role-management.view");
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
                  "type":"slab",
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
                  "type":"finished",
                  "contactName":"更新联系人",
                  "contactPhone":"13800009999",
                  "qualificationStatus":"approved",
                  "createdByName":"仍不应覆盖",
                  "remark":"数据库更新验证",
                  "status":"disabled"
                }
                """.formatted(supplierName)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.type").value("finished"))
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
        "SELECT COUNT(*) FROM suppliers WHERE id = ? AND type = 'finished' AND status = 'disabled'",
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
          (id, name, type, status)
        VALUES
          (9220, '大板引用删除测试供应商', 'slab', 'enabled'),
          (9221, '成品引用删除测试供应商', 'finished', 'enabled')
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
                {"name":"%s","type":"slab","status":"enabled"}
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
                {"name":" %s ","type":"finished","status":"enabled"}
                """.formatted(existingName)))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.message").value("供应商名称已存在"));

    MvcResult otherResult = mockMvc.perform(post("/api/admin/suppliers")
            .header("Authorization", "Bearer " + token)
            .contentType("application/json")
            .content("""
                {"name":"%s","type":"finished","status":"enabled"}
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
                  {"name":"%s","type":"finished","status":"enabled"}
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
    long accountId = 9061L;
    long employeeId = 9061L;
    long roleId = 9061L;
    long supplierId = 9260L;
    jdbcTemplate.update(
        "INSERT INTO accounts (id, phone, display_name, status) VALUES (?, ?, ?, 'enabled')",
        accountId,
        "15926629061",
        "供应商权限测试员");
    jdbcTemplate.update(
        """
        INSERT INTO employees
          (id, account_id, tenant_id, store_id, name, phone, status, data_permission, created_by_name)
        VALUES (?, ?, 1, 1, '供应商权限测试员', '15926629061', 'enabled', 'self', '韩健')
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
        VALUES (?, '供应商编辑测试角色', 'SUPPLIER_EDIT_TEST', 'operation-platform',
          'admin', 'all', 'enabled',
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
        INSERT INTO suppliers (id, name, type, status, created_by_name, created_at)
        VALUES
          (?, '供应商权限集成测试', 'slab', 'enabled', '集成测试', '2098-01-01 00:00:00'),
          (9261, '供应商排序集成测试', 'finished', 'enabled', '集成测试', '2099-01-01 00:00:00')
        """,
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
                  {"name":"供应商权限集成测试-已编辑","type":"finished","status":"disabled"}
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
                  {"name":"无权编辑供应商","type":"slab","status":"enabled"}
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
                  {"name":"自有数据权限新增供应商","type":"accessory","status":"enabled"}
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
  void storeCategoryCrudAndOrderingPersistInDatabase() throws Exception {
    String suffix = Long.toString(System.nanoTime() % 1_000_000);
    String token = TokenAuthenticationFilter.DEV_TOKEN;

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
          (id, name, code, category, client_code, store_id, data_scope, status,
           function_permissions, created_by_name)
        VALUES (?, '门店分类查看角色', 'STORE_CATEGORY_VIEWER_TEST', 'partner-store',
          'admin', ?, 'store', 'enabled',
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
        .andExpect(jsonPath("$.data[*].name", hasItem("他人创建的大板品种")));

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
          (id, name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '工艺范围测试角色', 'CRAFT_SCOPE_TEST', 'operation-platform', 'admin', 'self', 'enabled', ?, '集成测试')
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
  void roleManagementIsSharedWithinStoreAndIsolatedAcrossStores() throws Exception {
    long accountId = 9002L;
    long employeeId = 9002L;
    String employeeName = "角色范围测试员工";
    long otherStoreId = 9002L;

    jdbcTemplate.update(
        "INSERT INTO stores (id, tenant_id, name, type, status) VALUES (?, 1, '角色隔离测试门店', 'partner', 'enabled')",
        otherStoreId);

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
          (name, code, category, client_code, store_id, data_scope, status,
           function_permissions, created_by_name)
        VALUES
          ('本人创建的范围角色', 'SELF_SCOPE_ROLE', 'operation-platform', 'admin', 1, 'all', 'enabled', '', ?),
          ('同店他人创建的角色', 'SAME_STORE_ROLE', 'operation-platform', 'admin', 1, 'all', 'enabled', '', '韩健'),
          ('其他门店创建的角色', 'OTHER_STORE_ROLE', 'operation-platform', 'admin', ?, 'all', 'enabled', '', '韩健')
        """,
        employeeName,
        otherStoreId);

    mockMvc.perform(get("/api/admin/roles")
            .header("Authorization", "Bearer " + TokenAuthenticationFilter.createAccountToken(accountId)))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.code == 'SELF_SCOPE_ROLE')].name").value(hasItem("本人创建的范围角色")))
        .andExpect(jsonPath("$.data[?(@.code == 'SAME_STORE_ROLE')].name").value(hasItem("同店他人创建的角色")))
        .andExpect(jsonPath("$.data[?(@.code == 'OTHER_STORE_ROLE')]").isEmpty());

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
                  "category": "operation-platform",
                  "clientCode": "admin",
                  "dataScope": "all",
                  "status": "enabled",
                  "functionPermissions": ""
                }
                """))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.message").value("不能操作其他门店的角色"));
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
                  "roleIds": "2",
                  "dataPermission": "self"
                }
                """))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.data.roleIds").value("2"))
        .andExpect(jsonPath("$.data.dataPermission").value("self"))
        .andExpect(jsonPath("$.data.gender").doesNotExist())
        .andExpect(jsonPath("$.data.remark").doesNotExist());

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
        .andExpect(jsonPath("$.message").value("不能操作其他门店的员工"));
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
          (id, name, code, category, client_code, data_scope, status, function_permissions, created_by_name)
        VALUES (?, '员工邀请创建测试角色', 'EMPLOYEE_INVITE_CREATOR_TEST', 'operation-platform',
          'admin', 'all', 'enabled',
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
  void employeeInviteRegistrationRequiresAdminActivation() throws Exception {
    String creatorName = jdbcTemplate.queryForObject(
        "SELECT name FROM employees WHERE account_id = 1 AND status = 'enabled' LIMIT 1",
        String.class);
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
