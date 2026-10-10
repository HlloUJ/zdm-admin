package com.zdm.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import com.zdm.platform.support.SpringContainerTestSupport;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class DataScopeApiTest extends SpringContainerTestSupport {
  @Container
  private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("zdm_scope_test").withUsername("test").withPassword("test");
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add("zdm.media.storage-path", () -> System.getProperty("java.io.tmpdir") + "/zdm-data-scope-test");
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;
  record Catalog(String route, String table, String prefix, String extraColumns, String extraValues) {}
  static Stream<Catalog> catalogs() {
    return Stream.of(
        new Catalog("slab-origins", "slab_origins", "admin.product-data-center.slab-origin", "", ""),
        new Catalog("slab-varieties", "slab_varieties", "admin.product-data-center.slab-variety", "", ""),
        new Catalog("slab-textures", "slab_textures", "admin.product-data-center.slab-texture", "", ""),
        new Catalog("slab-grades", "slab_grades", "admin.product-data-center.slab-grade", ",code,sort_order", ",'ZX',100"),
        new Catalog("crafts", "crafts", "admin.product-data-center.finished-stock-craft", ",type", ",'finished'"),
        new Catalog("store-levels", "store_levels", "admin.tenant.store-level-management", ",sort_order", ",100"),
        new Catalog("product-attributes", "product_attributes", "admin.product-data-center.attribute.shared", ",scope,value_type", ",'shared','select'")
    );
  }
  @ParameterizedTest @MethodSource("catalogs")
  void businessCreatorUsesCurrentAccountNameAndDoesNotStoreNameCopies(Catalog catalog) throws Exception {
    jdbc.update("INSERT INTO accounts(id,phone,display_name,status) VALUES (990033,'15926629833','创建人改名前','enabled')");
    jdbc.update("INSERT INTO " + catalog.table() + " (id,name,status,created_by_account_id" + catalog.extraColumns()
        + ") VALUES (990033,'创建人关联测试','enabled',990033" + catalog.extraValues() + ")");
    identity("all", true, catalog.prefix()+".view");
    String url = "/api/admin/" + catalog.route();
    mvc.perform(get(url)).andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 990033)].createdByName").value(org.hamcrest.Matchers.hasItem("创建人改名前")));
    jdbc.update("UPDATE accounts SET display_name='创建人改名后' WHERE id=990033");
    mvc.perform(get(url)).andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 990033)].createdByName").value(org.hamcrest.Matchers.hasItem("创建人改名后")));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name='created_by_name'",
        Integer.class, catalog.table())).isZero();
  }

  @ParameterizedTest
  @org.junit.jupiter.params.provider.ValueSource(strings = {"admin", "supply-chain", "store"})
  void employeeCreatorNameTracksAccountAcrossAllClients(String client) throws Exception {
    boolean store = "store".equals(client);
    String clientCode = store ? "admin" : client;
    jdbc.update("INSERT INTO accounts(id,phone,display_name,status) VALUES(990044,'15926629844','被邀请员工','enabled'),(990045,'15926629845','邀请人改名前','enabled')");
    jdbc.update("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,status,data_permission,remark,created_by_account_id) VALUES(990044,990044,?,?,?,'disabled','self','独立备注',990045)",
        clientCode, store ? 1L : null, store ? 1L : null);
    var current = new CurrentIdentity(1L, 11L, 1L, 1L, clientCode, store ? 1L : null, store ? 1L : null,
        "当前操作员", "all", List.of(store ? "STORE_ADMIN" : "supply-chain".equals(client) ? "SUPPLY_CHAIN_ADMIN" : "SUPER_ADMIN"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(current, null, List.of()));
    mvc.perform(get("/api/admin/employees")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 990044)].createdByName").value(org.hamcrest.Matchers.hasItem("邀请人改名前")));
    jdbc.update("UPDATE accounts SET display_name='邀请人改名后' WHERE id=990045");
    mvc.perform(get("/api/admin/employees")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 990044)].createdByName").value(org.hamcrest.Matchers.hasItem("邀请人改名后")))
        .andExpect(jsonPath("$.data[?(@.id == 990044)].status").value(org.hamcrest.Matchers.hasItem("disabled")))
        .andExpect(jsonPath("$.data[?(@.id == 990044)].remark").value(org.hamcrest.Matchers.hasItem("独立备注")));
  }

  void identity(String scope, boolean superAdmin, String... permissions) {
    var user = new CurrentIdentity(1L, 11L, 1L, 1L, "admin", null, null, "同名操作员", scope,
        superAdmin ? List.of("SUPER_ADMIN") : List.of("OPERATOR"), List.of(permissions));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null, List.of()));
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  void seed(Catalog c) {
    // The table and column names come exclusively from the constant catalog matrix above.
    jdbc.update("INSERT INTO " + c.table() + " (id,name,status,created_by_account_id" + c.extraColumns()
        + ") VALUES (990011,'范围本人','enabled',11" + c.extraValues() + ")");
    String otherValues = c.extraValues().replace("ZX", "ZY");
    jdbc.update("INSERT INTO " + c.table() + " (id,name,status,created_by_account_id" + c.extraColumns()
        + ") VALUES (990022,'范围他人','enabled',22" + otherValues + ")");
  }
  @ParameterizedTest @MethodSource("catalogs")
  void selfCannotReadOrMutateOtherCreatorsButAllAndSuperAdminCan(Catalog c) throws Exception {
    seed(c);
    String url = "/api/admin/" + c.route();
    identity("self", false, c.prefix()+".view", c.prefix()+".toggle-status", c.prefix()+".delete");
    var response = mvc.perform(get(url)).andExpect(status().isOk()).andReturn();
    String data = json.readTree(response.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).path("data").toString();
    assertThat(data).contains("范围本人").doesNotContain("范围他人");
    mvc.perform(patch(url+"/990022/status").contentType("application/json").content("{\"status\":\"disabled\"}"))
        .andExpect(status().isForbidden());
    mvc.perform(delete(url+"/990022")).andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT status FROM " + c.table() + " WHERE id=990022", String.class)).isEqualTo("enabled");
    identity("all", false, c.prefix()+".view", c.prefix()+".toggle-status");
    mvc.perform(patch(url+"/990022/status").contentType("application/json").content("{\"status\":\"disabled\"}"))
        .andExpect(status().isOk());
    mvc.perform(delete(url+"/990022")).andExpect(status().isForbidden());
    identity("self", true);
    mvc.perform(patch(url+"/990022/status").contentType("application/json").content("{\"status\":\"enabled\"}"))
        .andExpect(status().isOk());
  }

  @Test void creationIgnoresForgedCreatorAndOwnDataRemainsEditable() throws Exception {
    String prefix="admin.product-data-center.slab-origin";
    identity("self", false, prefix+".view",prefix+".create",prefix+".edit",prefix+".delete");
    var result=mvc.perform(post("/api/admin/slab-origins").contentType("application/json")
        .content("{\"name\":\"防伪归属\",\"status\":\"enabled\",\"createdByAccountId\":22}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.createdByAccountId").value(11)).andReturn();
    long id=json.readTree(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).path("data").path("id").asLong();
    mvc.perform(put("/api/admin/slab-origins/"+id).contentType("application/json")
        .content("{\"name\":\"防伪归属编辑\",\"status\":\"enabled\",\"createdByAccountId\":22}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.createdByAccountId").value(11));
    mvc.perform(delete("/api/admin/slab-origins/"+id)).andExpect(status().isOk());
  }

  @Test void masterDataSupportsOwnCrudAndDeniesForeignRows() throws Exception {
    String prefix = "admin.product-data-center.master-data";
    identity("self", false, prefix+".view", prefix+".create", prefix+".edit", prefix+".delete");
    var result = mvc.perform(post("/api/admin/master-data").contentType("application/json")
        .content("{\"dataType\":\"unit\",\"name\":\"自有单位\",\"code\":\"scope-unit\",\"status\":\"enabled\",\"createdByAccountId\":22}"))
        .andExpect(status().isOk()).andExpect(jsonPath("$.data.createdByAccountId").value(11)).andReturn();
    long id = json.readTree(result.getResponse().getContentAsString(java.nio.charset.StandardCharsets.UTF_8)).path("data").path("id").asLong();
    mvc.perform(get("/api/admin/master-data")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(1));
    jdbc.update("UPDATE master_data SET created_by_account_id=22 WHERE id=?",id);
    sqlSession.clearCache();
    mvc.perform(delete("/api/admin/master-data/"+id)).andExpect(status().isForbidden());
    mvc.perform(get("/api/admin/master-data")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
  }

  @Test void finishedStockSelfScopeReturnsOnlyOwnDataInsteadOfRejectingTheModule() throws Exception {
    identity("self", false, "admin.finished-stock-management.view", "admin.finished-stock-management.operation-log.view");
    mvc.perform(get("/api/admin/finished-products")).andExpect(status().isOk()).andExpect(jsonPath("$.data.length()").value(0));
    mvc.perform(get("/api/admin/finished-products/operation-logs")).andExpect(status().isOk()).andExpect(jsonPath("$.data.total").value(0));
  }

  @Test void mixedCreatorBatchIsRejectedWithoutPartialDeletionAndClearOnlyDeletesOwnRows() throws Exception {
    jdbc.update("INSERT INTO slab_inventory (id,name,status,created_by_account_id) VALUES (990011,'自有回收大板','recycle',11),(990022,'他人回收大板','recycle',22)");
    identity("self", false, "admin.slab-management.recycle.batch-purge", "admin.slab-management.recycle.clear");
    mvc.perform(delete("/api/admin/slabs/batch-purge").contentType("application/json").content("[990011,990022]"))
        .andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_inventory WHERE id IN (990011,990022)",Integer.class)).isEqualTo(2);
    mvc.perform(delete("/api/admin/slabs/clear-recycle")).andExpect(status().isOk()).andExpect(jsonPath("$.data").value(1));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_inventory WHERE id=990022",Integer.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=990011 AND product_created_by_account_id=11",Integer.class)).isEqualTo(1);
  }

  @Test void rolesApplySelfScopeInsideTheCurrentOrganization() throws Exception {
    jdbc.update("INSERT INTO roles (id,name,code,data_scope,status,created_by_account_id) VALUES (990011,'自有角色','SCOPE_OWN','all','enabled',11),(990022,'他人角色','SCOPE_OTHER','all','enabled',22)");
    String prefix = "admin.permission-management.role-management";
    identity("self", false, prefix+".view", prefix+".edit", prefix+".delete");
    mvc.perform(get("/api/admin/roles")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data[?(@.id == 990011)]").isNotEmpty())
        .andExpect(jsonPath("$.data[?(@.id == 990022)]").isEmpty());
    mvc.perform(delete("/api/admin/roles/990022")).andExpect(status().isForbidden());
    identity("all", false, prefix+".view", prefix+".delete");
    mvc.perform(delete("/api/admin/roles/990022")).andExpect(status().isOk());
  }

  @Test void templateListAndDirectVersionReadUseVersionCreatorScope() throws Exception {
    jdbc.update("INSERT INTO product_categories (id,name,scope,status,created_by_account_id) VALUES (990011,'范围分类','finished','enabled',11)");
    jdbc.update("INSERT INTO category_template_versions (id, category_id, version_no, state, content, created_by_account_id) VALUES (990011, 990011, 1, 'published', JSON_ARRAY(), 11), (990022, 990011, 2, 'published', JSON_ARRAY(), 22)");
    String prefix = "admin.product-data-center.category-attribute-template.finished.attributes";
    identity("self", false, prefix+".view",prefix+".history");
    mvc.perform(get("/api/admin/template-versions").param("categoryId","990011")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.length()").value(1))
        .andExpect(jsonPath("$.data[0].id").value(990011));
    mvc.perform(get("/api/admin/template-versions/990022")).andExpect(status().isForbidden());
    identity("all", false, prefix+".view",prefix+".history");
    mvc.perform(get("/api/admin/template-versions/990022")).andExpect(status().isOk());
  }
}
