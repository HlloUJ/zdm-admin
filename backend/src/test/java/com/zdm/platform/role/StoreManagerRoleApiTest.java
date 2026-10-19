package com.zdm.platform.role;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.auth.AuthAccountMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.store.Store;
import com.zdm.platform.store.StoreService;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters=false)
@Testcontainers(disabledWithoutDocker=true)
@Transactional
class StoreManagerRoleApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL=new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("manager_test").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url",MYSQL::getJdbcUrl); r.add("spring.datasource.username",MYSQL::getUsername);
    r.add("spring.datasource.password",MYSQL::getPassword);
  }
  @Autowired private JdbcTemplate jdbc;
  @Autowired private RoleService roles;
  @Autowired private StoreService stores;
  @Autowired private StoreBuiltinRoleService builtin;
  @Autowired private AuthAccountMapper accounts;
  @Autowired private org.springframework.test.web.servlet.MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;
  private Long id;
  @BeforeEach void fixtures() {
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type) VALUES(991701,1,'内置角色测试','cityPartner'),(991702,1,'隔离角色测试','cityPartner')");
    builtin.provision(991701L,1L,1L); builtin.provision(991702L,1L,1L);
    id=jdbc.queryForObject("SELECT id FROM roles WHERE store_id=991701 AND builtin_key='STORE_MANAGER'",Long.class);
    identity("admin",1L,991701L,"all","all");
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  private void identity(String client,Long tenant,Long store,String data,String... grants) {
    var current=new CurrentIdentity(null,1L,null,null,client,tenant,store,"测试",data,List.of(),List.of(grants));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(current,null,List.of()));
  }
  private Role payload() { sqlSession.clearCache(); return json.convertValue(roles.getById(id),Role.class); }
  private void rejectUpdate(Role role) throws Exception {
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(role)))
        .andExpect(status().isBadRequest());
  }
  @Test void builtinCannotEditDisableDeleteOrBeRecreated() throws Exception {
    var p=payload();p.setName("改名");rejectUpdate(p);
    p=payload();p.setRemark("改备注");rejectUpdate(p);
    p=payload();p.setStatus("disabled");rejectUpdate(p);
    p=payload();p.setBuiltinKey("OTHER");rejectUpdate(p);
    mvc.perform(delete("/api/admin/roles/"+id)).andExpect(status().isBadRequest());
    p=payload();p.setBuiltinKey(null);p.setCode("CUSTOM_NEW");
    mvc.perform(post("/api/admin/roles").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isBadRequest());
    assertThat(payload().getName()).isEqualTo("店长");assertThat(payload().getStatus()).isEqualTo("enabled");
  }
  @Test void permissionsCanBeAssignedAndAdjustedWithPermissionGrantAlone() throws Exception {
    jdbc.update("UPDATE terminal_function_policies SET function_permissions='store.customer-management.daily.view' WHERE terminal='store'");
    identity("admin",1L,991701L,"all","admin.permission-management.role-management.permission");
    var p=payload();p.setFunctionPermissions("store.customer-management.daily.view");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isOk());
    assertThat(payload().getFunctionPermissions()).isEqualTo("store.customer-management.daily.view");
    p=payload();p.setFunctionPermissions("");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isOk());
    assertThat(payload().getFunctionPermissions()).isEmpty();
  }
  @Test void functionGrantAndDataScopeAndOrganizationRemainEnforced() throws Exception {
    identity("admin",1L,991701L,"all","admin.permission-management.role-management.edit");
    var p=payload();p.setFunctionPermissions("store.customer-management.daily.view");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p))).andExpect(status().isForbidden());
    identity("admin",1L,991702L,"all","all");
    mvc.perform(delete("/api/admin/roles/"+id)).andExpect(status().isForbidden());
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p))).andExpect(status().isForbidden());
    identity("supply-chain",null,null,"all","all");
    mvc.perform(delete("/api/admin/roles/"+id)).andExpect(status().isForbidden());
    identity("admin",1L,991701L,"","all");
    mvc.perform(get("/api/admin/roles")).andExpect(status().isForbidden());
  }
  @Test void ordinaryProfileEditRetainsUnchangedGrantsOutsideReducedTerminalScope() throws Exception {
    jdbc.update("INSERT INTO roles(id,name,code,client_code,tenant_id,store_id,created_by_account_id,function_permissions) VALUES(991799,'普通角色','PROFILE_TEST','admin',1,991701,1,'store.customer-management.daily.view')");
    id=991799L;
    jdbc.update("UPDATE terminal_function_policies SET function_permissions='' WHERE terminal='store'");
    identity("admin",1L,991701L,"all","admin.permission-management.role-management.edit");
    var p=payload();p.setName("修改名称");p.setRemark("修改备注");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isOk());
    assertThat(payload().getName()).isEqualTo("修改名称");
    assertThat(payload().getFunctionPermissions()).isEqualTo("store.customer-management.daily.view");
    p=payload();p.setFunctionPermissions("store.customer-management.archived.view");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isForbidden());
    identity("admin",1L,991701L,"all","admin.permission-management.role-management.permission");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isForbidden());
    p=payload();p.setRemark("没有编辑权限");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isForbidden());
    identity("admin",1L,991702L,"all","all");
    mvc.perform(put("/api/admin/roles/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(p)))
        .andExpect(status().isForbidden());
  }
  @Test void systemRoleIsVisibleInsideItsOrganizationEvenWithSelfDataScope() {
    identity("admin",1L,991701L,"self","all");
    jdbc.update("UPDATE roles SET created_by_account_id=2 WHERE id=?",id);
    assertThat(roles.listForCurrentAdmin()).extracting(Role::getId).containsExactly(id);
  }
  @Test void newStoreCreatesExactlyOneEmptyRoleForEachSupportedStoreType() {
    identity("admin",null,null,"all","all");
    jdbc.update("INSERT IGNORE INTO tenant_businesses(tenant_id,business_type,status) VALUES(1,'cityPartner','enabled'),(1,'slabSupplier','enabled'),(1,'finishedSupplier','enabled')");
    Long level=jdbc.queryForObject("SELECT id FROM store_levels WHERE status='enabled' LIMIT 1",Long.class);
    for (String type:List.of("cityPartner","slabSupplier","finishedSupplier")) {
      Store store=new Store();store.setTenantId(1L);store.setType(type);store.setName("自动店长_"+type);store.setStoreLevelId(level);
      assertThat(stores.createStore(store)).isTrue();
      var rows=jdbc.queryForList("SELECT builtin_key,function_permissions,status FROM roles WHERE store_id=?",store.getId());
      assertThat(rows).hasSize(1);assertThat(rows.getFirst()).containsEntry("builtin_key","STORE_MANAGER")
          .containsEntry("function_permissions","").containsEntry("status","enabled");
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM account_roles WHERE store_id=?",Integer.class,store.getId())).isZero();
    }
  }
  @Test void employeeMissingDataScopeNeverFallsBackToAllButStoreAdminRemainsAll() {
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES(991711,'13899171101','数据权限测试')");
    jdbc.update("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,status,data_permission) VALUES(991711,991711,'admin',1,991701,'enabled',NULL)");
    jdbc.update("INSERT INTO account_identities(id,account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES(991711,991711,'admin','employee',991711,1,991701,'enabled'),(991712,991711,'admin','store_admin',991701,1,991701,'enabled')");
    assertThat(accounts.findByIdentityId(991711L).getDataPermission()).isEmpty();
    assertThat(accounts.findByIdentityId(991712L).getDataPermission()).isEqualTo("all");
  }
  @Test void databaseGuardsRejectDuplicateAndDisabledBuiltins() {
    assertThatThrownBy(() -> builtin.provision(991701L,1L,1L)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    assertThatThrownBy(() -> jdbc.update("UPDATE roles SET status='disabled' WHERE id=?",id))
        .isInstanceOf(org.springframework.dao.DataAccessException.class).hasMessageContaining("chk_roles_builtin_manager");
  }
  @Test void multipleEmployeesCanShareBuiltinAndForeignBindingsDoNotYieldMarker() {
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES(991701,'13899170101','店长甲'),(991702,'13899170102','店长乙')");
    for (long account:List.of(991701L,991702L)) {
      jdbc.update("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,status) VALUES(?,?,'admin',1,991701,'enabled')",account,account);
      jdbc.update("INSERT INTO account_identities(id,account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES(?,?,'admin','employee',?,1,991701,'enabled')",account,account,account);
      jdbc.update("INSERT INTO account_roles(account_id,role_id,client_code,tenant_id,store_id) VALUES(?,?,'admin',1,991701)",account,id);
      assertThat(accounts.findAdminRoleCodes(account,account)).contains("STORE_MANAGER",payload().getCode());
    }
    jdbc.update("UPDATE account_roles SET store_id=991702 WHERE account_id=991702");
    sqlSession.clearCache();
    assertThat(accounts.findAdminRoleCodes(991702L,991702L)).isEmpty();
  }
}
