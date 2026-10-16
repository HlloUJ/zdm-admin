package com.zdm.platform.customer;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
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
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
@Transactional
class CustomerApiTest extends SpringContainerTestSupport {
  private static final String BASE="/api/admin/store-customers";
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("customer_test").withUsername("test").withPassword("test");
  @DynamicPropertySource
  static void database(DynamicPropertyRegistry r) {
    r.add("spring.datasource.url", MYSQL::getJdbcUrl);
    r.add("spring.datasource.username", MYSQL::getUsername);
    r.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @BeforeEach void fixtures() {
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (90001,'13890000001','导购A'),(90002,'13890000002','导购B')");
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type) VALUES (90001,1,'客户测试门店','cityPartner'),(90002,1,'另一门店','cityPartner'),(90003,1,'供应商门店','slabSupplier')");
    jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id) VALUES (90001,'admin','store_admin',90001,1,90001),(90002,'admin','store_admin',90001,1,90001)");
    jdbc.update("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,status) VALUES (90001,90001,'admin',1,90001,'enabled'),(90002,90002,'admin',1,90001,'enabled')");
    jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id) VALUES (90001,'admin','employee',90001,1,90001),(90002,'admin','employee',90002,1,90001)");
    identity(90001,90001L,"all","all");
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  private void identity(long account,Long store,String scope,String... permissions) {
    List<String> grants=java.util.Arrays.stream(permissions).map(p -> p.equals("all") ? p : CustomerService.PREFIX+"."+p).toList();
    var i=new CurrentIdentity(null,account,null,null,"admin",store==null ? null : 1L,store,"测试人员",scope,List.of(),grants);
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(i,null,List.of()));
  }
  private JsonNode data(ResultActions result) throws Exception {
    return json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("data");
  }
  private long create() throws Exception {
    var current=(CurrentIdentity) SecurityContextHolder.getContext().getAuthentication().getPrincipal();
    return data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
        java.util.Map.of("name","王先生","phone","","wechat","","requirement","餐桌","remark","","ownerAccountId",current.accountId()))))).path("id").asLong();
  }
  private ResultActions action(long id,String source,String action,Long owner) throws Exception {
    return mvc.perform(post(BASE+("assign".equals(action) ? "/batch" : "/action")).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
        java.util.Map.of("ids",List.of(id),"status",source,"action",action,"ownerAccountId",owner==null ? 90001L : owner))));
  }
  private ResultActions follow(long id,String content) throws Exception {
    return mvc.perform(post(BASE+"/"+id+"/followups").contentType(MediaType.APPLICATION_JSON).content(content));
  }
  @Test void nationalityIsIndependentAndCallingCodeIsServerDerivedWithoutRegionalLengthChecks() throws Exception {
    var body=java.util.Map.of("name","国际客户","ownerAccountId",90001,"nationality","FR","phoneRegion","CN","phone","000123","callingCode","+999");
    var saved=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))));
    assertThat(saved.path("nationality").asText()).isEqualTo("FR");assertThat(saved.path("phoneRegion").asText()).isEqualTo("CN");
    assertThat(saved.path("callingCode").asText()).isEqualTo("+86");assertThat(saved.path("phone").asText()).isEqualTo("000123");
    var updated=data(mvc.perform(put(BASE+"/"+saved.path("id").asLong()).contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(java.util.Map.of("name","国际客户","ownerAccountId",90001,"nationality","US","phoneRegion","FR","phone","0001")))));
    assertThat(updated.path("phone").asText()).isEqualTo("0001");assertThat(updated.path("callingCode").asText()).isEqualTo("+33");
  }
  @Test void changedPhoneRequiresDigitsAndRegionButPhoneRemainsOptional() throws Exception {
    for (var bad:List.of(java.util.Map.of("phone","123","phoneRegion",""),java.util.Map.of("phone","12-3","phoneRegion","CN"),
        java.util.Map.of("phone","123","phoneRegion","ZZ"),java.util.Map.of("phone"," 123 ","phoneRegion","CN"),java.util.Map.of("nationality","ZZ"))) {
      var body=new java.util.HashMap<String,Object>(bad);body.put("name","测试");body.put("ownerAccountId",90001);
      mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isBadRequest());
    }
    var saved=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"无电话\",\"ownerAccountId\":90001,\"nationality\":\"FR\"}")));
    assertThat(saved.path("phone").asText()).isEmpty();assertThat(saved.path("callingCode").asText()).isEmpty();
  }
  @Test void legacyPhoneCanBeSavedUnchangedAndIsNeverGuessedOrRewritten() throws Exception {
    long id=create();String old=" +1 (020) ABC ext 9 ";
    jdbc.update("UPDATE store_customers SET phone=? WHERE id=?",old,id);
    var body=new java.util.HashMap<String,Object>(java.util.Map.of("name","只改姓名","ownerAccountId",90001,"phone",old));
    var saved=data(mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))));
    assertThat(saved.path("phone").asText()).isEqualTo(old);assertThat(saved.path("phoneRegion").asText()).isEmpty();
    body.put("phone","00123");
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isBadRequest());
    body.put("phoneRegion","US");
    saved=data(mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))));
    assertThat(saved.path("phone").asText()).isEqualTo("00123");assertThat(saved.path("callingCode").asText()).isEqualTo("+1");
  }
  @Test void contactCatalogueContainsSharedCallingCodesAndRequiresCurrentStoreViewGrant() throws Exception {
    var catalogue=data(mvc.perform(get(BASE+"/contact-regions").param("status","daily")));
    assertThat(catalogue.path("nationalities").size()).isGreaterThan(200);assertThat(catalogue.path("phoneRegions").size()).isGreaterThan(200);
    var codes=new java.util.HashMap<String,String>();catalogue.path("phoneRegions").forEach(n -> codes.put(n.path("code").asText(),n.path("callingCode").asText()));
    assertThat(codes).containsEntry("CN","+86").containsEntry("FR","+33").containsEntry("US","+1").containsEntry("CA","+1");
    identity(90001,90001L,"all","daily.create");mvc.perform(get(BASE+"/contact-regions").param("status","daily")).andExpect(status().isForbidden());
    identity(90001,90003L,"all","all");mvc.perform(get(BASE+"/contact-regions").param("status","daily")).andExpect(status().isForbidden());
  }
  private void authenticatedRole(String type,String scope,String... grants) {
    Long identityId=jdbc.queryForObject("SELECT id FROM account_identities WHERE account_id=90001 AND store_id=90001 AND identity_type=?",Long.class,type);
    var i=new CurrentIdentity(null,90001L,identityId,null,"admin",1L,90001L,"测试",scope,List.of(type.equals("store_admin") ? "STORE_ADMIN" : "STORE_MANAGER"),
        java.util.Arrays.stream(grants).map(p -> p.equals("all") ? p : CustomerService.PREFIX+"."+p).toList());
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(i,null,List.of()));
  }
  @Test void storeAdminCanMaintainOtherOwnerCustomersWithoutTakingOwnership() throws Exception {
    long id=create();action(id,"daily","assign",90002L);
    authenticatedRole("store_admin","all","all");
    data(mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"管理员编辑\",\"ownerAccountId\":90002}")));
    action(id,"daily","archive",null).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT owner_account_id FROM store_customers WHERE id=?",Long.class,id)).isEqualTo(90002);
  }
  @Test void roleNamesNeverBypassFunctionOrConfiguredDataScope() throws Exception {
    long id=create();action(id,"daily","assign",90002L);
    authenticatedRole("employee","all","daily.view");action(id,"daily","archive",null).andExpect(status().isForbidden());
    authenticatedRole("employee","self","all");action(id,"daily","archive",null).andExpect(status().isForbidden());
    authenticatedRole("employee","","all");action(id,"daily","archive",null).andExpect(status().isForbidden());
    identity(90001,90001L,"all","daily.view","daily.archive");
    action(id,"daily","archive",null).andExpect(status().isOk());
    identity(90001,90001L,"self","archived.view","archived.restore");
    action(id,"archived","restore",null).andExpect(status().isForbidden());
  }
  @Test void duplicateNamesAndPhonesAndMissingPhoneAreAccepted() throws Exception {
    long a=create(); long b=create(); assertThat(a).isNotEqualTo(b);
    String p="{\"name\":\"王先生\",\"phone\":\"123\",\"phoneRegion\":\"CN\",\"ownerAccountId\":90001}";
    data(mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content(p)));
    data(mvc.perform(put(BASE+"/"+b).contentType(MediaType.APPLICATION_JSON).content(p)));
    assertThat(data(mvc.perform(get(BASE).param("status","daily").param("phone","123"))).size()).isEqualTo(2);
  }
  @Test void scopeUsesCurrentOwnerAndAllScopeDoesNotNeedManagerRole() throws Exception {
    long a=create(); long b=create(); action(b,"daily","assign",90002L).andExpect(status().isOk());
    identity(90001,90001L,"self","daily.view","daily.detail");
    assertThat(data(mvc.perform(get(BASE).param("status","daily"))).size()).isEqualTo(1);
    mvc.perform(get(BASE+"/"+b)).andExpect(status().isForbidden());
    identity(90001,90001L,"all","daily.view","daily.detail");
    assertThat(data(mvc.perform(get(BASE).param("status","daily"))).size()).isEqualTo(2);
    assertThat(data(mvc.perform(get(BASE+"/"+a))).path("customer").path("id").asLong()).isEqualTo(a);
  }
  @Test void foreignStoreAndSupplierAndPlatformCannotAccessEvenWithAllFunctions() throws Exception {
    long a=create();
    identity(90001,90002L,"all","all");
    assertThat(data(mvc.perform(get(BASE).param("status","daily"))).size()).isZero();
    mvc.perform(get(BASE+"/"+a)).andExpect(status().isForbidden());
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"伪造\",\"ownerAccountId\":90001}")).andExpect(status().isForbidden());
    identity(90001,90003L,"all","all"); mvc.perform(get(BASE).param("status","daily")).andExpect(status().isForbidden());
    identity(90001,null,"all","all"); mvc.perform(get(BASE).param("status","daily")).andExpect(status().isForbidden());
  }
  @Test void viewAndDetailAndSingleAndBatchAreIndependent() throws Exception {
    long a=create(); identity(90001,90001L,"all","daily.view","daily.archive");
    mvc.perform(get(BASE+"/"+a)).andExpect(status().isForbidden());
    mvc.perform(get(BASE).param("status","archived")).andExpect(status().isForbidden());
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("ids",List.of(a),"status","daily","action","archive")))).andExpect(status().isForbidden());
    action(a,"daily","archive",null).andExpect(status().isOk());
  }
  @Test void allDataAllowsOrdinaryStaffToMaintainOthersWithoutChangingOwner() throws Exception {
    long a=create();identity(90002,90001L,"all","all");
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"合法维护\",\"ownerAccountId\":90001}"))
        .andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT owner_account_id FROM store_customers WHERE id=?",Long.class,a)).isEqualTo(90001);
    follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"授权跟进\",\"mediaIds\":[]}").andExpect(status().isOk());
    long followup=jdbc.queryForObject("SELECT id FROM store_customer_followups WHERE customer_id=?",Long.class,a);
    mvc.perform(put(BASE+"/"+a+"/followups/"+followup).contentType(MediaType.APPLICATION_JSON)
        .content("{\"followedAt\":\"2026-10-14T10:00:00\",\"content\":\"授权修改\",\"mediaIds\":[]}")).andExpect(status().isOk());
    mvc.perform(delete(BASE+"/"+a+"/followups/"+followup)).andExpect(status().isOk());
    action(a,"daily","archive",null).andExpect(status().isOk());
    action(a,"archived","restore",null).andExpect(status().isOk());
    action(a,"daily","assign",90002L).andExpect(status().isOk());
  }
  @Test void batchAllDataAcceptsMixedOwnersAndSelfDataRejectsAtomically() throws Exception {
    long a=create();long b=create();action(b,"daily","assign",90002L).andExpect(status().isOk());
    String body=json.writeValueAsString(java.util.Map.of("ids",List.of(a,b),"status","daily","action","archive"));
    identity(90001,90001L,"self","all");
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT status FROM store_customers WHERE id=?",String.class,a)).isEqualTo("daily");
    identity(90001,90001L,"all","daily.view","daily.archive");
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
    identity(90001,90001L,"all","daily.view","daily.batch-archive");
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customers WHERE id IN (?,?) AND status='archived'",Integer.class,a,b)).isEqualTo(2);
    identity(90001,90001L,"all","archived.view","archived.batch-restore");
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
        java.util.Map.of("ids",List.of(a,b),"status","archived","action","restore")))).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customers WHERE id IN (?,?) AND status='daily'",Integer.class,a,b)).isEqualTo(2);
  }
  @Test void createdScopeCannotBeForgedAndAuthorizedEditingTransfersOwner() throws Exception {
    var c=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"客户\",\"tenantId\":999,\"storeId\":90002,\"ownerAccountId\":90002}")));
    assertThat(c.path("storeId").asLong()).isEqualTo(90001); assertThat(c.path("ownerAccountId").asLong()).isEqualTo(90002);
    identity(90002,90001L,"all","all");
    var edited=data(mvc.perform(put(BASE+"/"+c.path("id").asLong()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"修改\",\"ownerAccountId\":90001}")));
    assertThat(edited.path("ownerAccountId").asLong()).isEqualTo(90001);
  }
  @Test void createRequiresValidOwnerAndKeepsCreatorAndSelfDataScope() throws Exception {
    mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"客户\"}")).andExpect(status().isBadRequest());
    identity(90001,90001L,"self","daily.view","daily.create");
    var created=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"代建客户\",\"ownerAccountId\":90002}")));
    assertThat(created.path("ownerAccountId").asLong()).isEqualTo(90002);
    assertThat(created.path("createdByAccountId").asLong()).isEqualTo(90001);
    assertThat(data(mvc.perform(get(BASE).param("status","daily"))).size()).isZero();
    mvc.perform(get(BASE+"/"+created.path("id").asLong())).andExpect(status().isForbidden());
  }
  @Test void candidatesAndSubmissionExcludeInactiveDeletedAndOtherOrganizationEmployees() throws Exception {
    // This case isolates ordinary employee validity; an independently enabled administrator identity remains eligible.
    jdbc.update("DELETE FROM account_identities WHERE account_id=90002 AND identity_type='store_admin'");
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (90003,'13890000003','其他门店员工')");
    jdbc.update("INSERT INTO tenants(id,account_id,business_types) VALUES (90004,90003,'cityPartner')");
    jdbc.update("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,status) VALUES (90003,90003,'admin',1,90002,'enabled')");
    jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id) VALUES (90003,'admin','employee',90003,1,90002),(90003,'admin','store_admin',90002,1,90002)");
    mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"跨门店归属\",\"ownerAccountId\":90003}")).andExpect(status().isBadRequest());

    assertThat(data(mvc.perform(get(BASE+"/owner-candidates"))).findValuesAsText("accountId")).containsExactly("90001","90002");
    for (String change : List.of(
        "UPDATE employees SET status='disabled' WHERE id=90002",
        "UPDATE employees SET store_id=90002 WHERE id=90002",
        "UPDATE employees SET tenant_id=90004 WHERE id=90002",
        "UPDATE employees SET client_code='supply-chain',tenant_id=NULL,store_id=NULL WHERE id=90002",
        "UPDATE accounts SET status='disabled' WHERE id=90002",
        "UPDATE account_identities SET status='disabled' WHERE account_id=90002 AND identity_type='employee'",
        "DELETE FROM employees WHERE id=90002")) {
      jdbc.update(change);
      assertThat(data(mvc.perform(get(BASE+"/owner-candidates"))).findValuesAsText("accountId")).containsExactly("90001");
      mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
          .content("{\"name\":\"无效归属\",\"ownerAccountId\":90002}")).andExpect(status().isBadRequest());
      jdbc.update("UPDATE employees SET status='enabled',tenant_id=1,store_id=90001,client_code='admin' WHERE id=90002");
      jdbc.update("UPDATE accounts SET status='enabled' WHERE id=90002");
      jdbc.update("UPDATE account_identities SET status='enabled' WHERE account_id=90002 AND identity_type='employee'");
    }
    mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"无效归属\",\"ownerAccountId\":1}")).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customers WHERE store_id=90001",Integer.class)).isZero();
  }
  @Test void otherEnabledStoreAdministratorsAreEligibleForCreateAndEditWithoutEmployeeRecords() throws Exception {
    jdbc.update("DELETE FROM employees WHERE id=90002");
    assertThat(data(mvc.perform(get(BASE+"/owner-candidates"))).findValuesAsText("accountId")).containsExactly("90001","90002");
    var created=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"管理员归属\",\"ownerAccountId\":90002}")));
    assertThat(created.path("ownerAccountId").asLong()).isEqualTo(90002);
    long id=create();
    assertThat(data(mvc.perform(get(BASE+"/owner-candidates").param("customerId",String.valueOf(id)))).findValuesAsText("accountId"))
        .containsExactly("90001","90002");
    var edited=data(mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"编辑转给管理员\",\"ownerAccountId\":90002}")));
    assertThat(edited.path("ownerAccountId").asLong()).isEqualTo(90002);
    jdbc.update("UPDATE account_identities SET status='disabled' WHERE account_id=90002 AND identity_type='store_admin'");
    assertThat(data(mvc.perform(get(BASE+"/owner-candidates"))).findValuesAsText("accountId")).containsExactly("90001");
    mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"停用管理员\",\"ownerAccountId\":90002}")).andExpect(status().isBadRequest());
  }
  @Test void customerRequirementAndRemarkHaveAHundredCharacterBoundary() throws Exception {
    var body=new java.util.HashMap<String,Object>();
    body.put("name","长度测试"); body.put("ownerAccountId",90001L);
    body.put("requirement","需".repeat(100)); body.put("remark","注".repeat(100));
    var created=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))));
    long id=created.path("id").asLong();
    for (String field : List.of("requirement","remark")) {
      body.put(field,"字".repeat(101));
      mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isBadRequest());
      mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isBadRequest());
      body.put(field,"字".repeat(100));
    }
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(body))).andExpect(status().isOk());
  }
  @Test void editingIncludesOwnerChangeWithoutRetiredAssignmentOrCreatePermission() throws Exception {
    long id=create();
    identity(90001,90001L,"self","daily.view","daily.edit");
    mvc.perform(get(BASE+"/owner-candidates").param("customerId",String.valueOf(id))).andExpect(status().isOk());
    mvc.perform(get(BASE+"/owner-candidates")).andExpect(status().isForbidden());
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"编辑并转交\",\"ownerAccountId\":90002}")).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT name FROM store_customers WHERE id=?",String.class,id)).isEqualTo("编辑并转交");
    assertThat(jdbc.queryForObject("SELECT owner_account_id FROM store_customers WHERE id=?",Long.class,id)).isEqualTo(90002);
    mvc.perform(get(BASE+"/"+id)).andExpect(status().isForbidden());
    identity(90002,90001L,"self","daily.view");
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"无编辑权限\",\"ownerAccountId\":90001}")).andExpect(status().isForbidden());
  }
  @Test void retiredSingleAssignmentRejectsAndBatchAssignmentStaysIndependentOfEdit() throws Exception {
    long id=create();identity(90001,90001L,"all","daily.view","daily.batch-assign");
    String body=json.writeValueAsString(java.util.Map.of("ids",List.of(id),"status","daily","action","assign","ownerAccountId",90002));
    mvc.perform(post(BASE+"/action").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT owner_account_id FROM store_customers WHERE id=?",Long.class,id)).isEqualTo(90002);
    identity(90001,90001L,"all","daily.view","daily.edit");
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isForbidden());
  }
  @Test void editTransferMovesDataScopeAndPreservesHistoryAndArchivedStatus() throws Exception {
    long id=create();
    data(follow(id,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"转移前跟进\",\"mediaIds\":[]}"));
    action(id,"daily","archive",null).andExpect(status().isOk());
    identity(90001,90001L,"self","archived.view","archived.edit");
    var edited=data(mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"归档中转移\",\"ownerAccountId\":90002}")));
    assertThat(edited.path("ownerAccountId").asLong()).isEqualTo(90002);
    assertThat(edited.path("status").asText()).isEqualTo("archived");
    assertThat(edited.path("createdByAccountId").asLong()).isEqualTo(90001);
    assertThat(data(mvc.perform(get(BASE).param("status","archived"))).size()).isZero();
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"旧窗口保存\",\"ownerAccountId\":90001}")).andExpect(status().isForbidden());
    identity(90002,90001L,"self","archived.view","archived.edit","archived.detail");
    var detail=data(mvc.perform(get(BASE+"/"+id)));
    assertThat(detail.path("customer").path("ownerAccountId").asLong()).isEqualTo(90002);
    assertThat(detail.path("followups").get(0).path("createdByAccountId").asLong()).isEqualTo(90001);
    mvc.perform(get(BASE+"/owner-candidates").param("customerId",String.valueOf(id))).andExpect(status().isOk());
  }
  @Test void invalidEditOwnerRejectsAllChangesAndRequiresAnOwner() throws Exception {
    jdbc.update("UPDATE account_identities SET status='disabled' WHERE account_id=90002 AND identity_type='store_admin'");
    long id=create();
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"缺少归属人\"}")).andExpect(status().isBadRequest());
    jdbc.update("UPDATE employees SET status='disabled' WHERE id=90002");
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"无效归属不保存\",\"ownerAccountId\":90002}")).andExpect(status().isBadRequest());
    mvc.perform(put(BASE+"/"+id).contentType(MediaType.APPLICATION_JSON)
        .content("{\"name\":\"越界归属不保存\",\"ownerAccountId\":1}")).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT name FROM store_customers WHERE id=?",String.class,id)).isEqualTo("王先生");
  }
  @Test void assignmentRestoresArchiveKeepsCreatorAndAllowsAllHistoricalFollowupMaintenance() throws Exception {
    long a=create();
    data(follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"A的跟进\",\"mediaIds\":[]}"));
    long f=data(mvc.perform(get(BASE+"/"+a))).path("followups").get(0).path("id").asLong();
    action(a,"daily","archive",null).andExpect(status().isOk());
    action(a,"archived","assign",90002L).andExpect(status().isOk());
    identity(90001,90001L,"self","all"); mvc.perform(get(BASE+"/"+a)).andExpect(status().isForbidden());
    identity(90002,90001L,"self","daily.view","daily.detail");
    mvc.perform(put(BASE+"/"+a+"/followups/"+f).contentType(MediaType.APPLICATION_JSON).content("{\"followedAt\":\"2026-10-14T10:00:00\",\"content\":\"B修改\",\"mediaIds\":[]}")).andExpect(status().isOk());
    var d=data(mvc.perform(get(BASE+"/"+a))); assertThat(d.path("customer").path("status").asText()).isEqualTo("daily");
    assertThat(d.path("customer").path("createdByAccountId").asLong()).isEqualTo(90001);
    assertThat(d.path("followups").get(0).path("createdByAccountId").asLong()).isEqualTo(90001);
    mvc.perform(delete(BASE+"/"+a+"/followups/"+f)).andExpect(status().isOk());
  }
  @Test void archivedRecordsRemainEditableAndDeletionOnlyAllowedFromArchive() throws Exception {
    long a=create(); action(a,"daily","purge",null).andExpect(status().isBadRequest());
    action(a,"daily","archive",null).andExpect(status().isOk());
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"归档修改\",\"ownerAccountId\":90001}")).andExpect(status().isOk());
    data(follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"归档跟进\",\"mediaIds\":[]}"));
    assertThat(data(mvc.perform(get(BASE+"/"+a))).path("customer").path("status").asText()).isEqualTo("archived");
    action(a,"archived","purge",null).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customer_followups WHERE customer_id=?",Integer.class,a)).isZero();
  }
  @Test void crossStoreBatchMakesNoPartialChanges() throws Exception {
    long a=create(); long b=create(); action(b,"daily","assign",90002L).andExpect(status().isOk());
    jdbc.update("UPDATE store_customers SET store_id=90002 WHERE id=?",b);
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("ids",List.of(a,b),"status","daily","action","archive")))).andExpect(status().isForbidden());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customers WHERE status='archived'",Integer.class)).isZero();
  }
  @Test void staleStateAndInvalidTargetRejectEntireBatch() throws Exception {
    long a=create(); long b=create(); action(b,"daily","archive",null).andExpect(status().isOk());
    mvc.perform(post(BASE+"/batch").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(java.util.Map.of("ids",List.of(a,b),"status","daily","action","archive")))).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT status FROM store_customers WHERE id=?",String.class,a)).isEqualTo("daily");
    action(a,"daily","assign",1L).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT owner_account_id FROM store_customers WHERE id=?",Long.class,a)).isEqualTo(90001);
  }
  @Test void followupValidatesRequiredFieldsAndMaximumAttachments() throws Exception {
    long a=create();
    follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"\",\"mediaIds\":[]}").andExpect(status().isBadRequest());
    follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"内容\",\"mediaIds\":[1,2,3,4]}").andExpect(status().isBadRequest());
    follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"内容\",\"mediaIds\":[1,1]}").andExpect(status().isBadRequest());
  }
  @Test void genericAttachmentIsPrivateBoundAndReadThroughAuthorizedCustomer() throws Exception {
    long a=create();
    var file=new MockMultipartFile("file","说明.html","text/html","<script>alert(1)</script>".getBytes(java.nio.charset.StandardCharsets.UTF_8));
    long media=data(mvc.perform(multipart(BASE+"/"+a+"/attachments").file(file))).path("id").asLong();
    data(follow(a,json.writeValueAsString(java.util.Map.of("followedAt","2026-10-13T10:00:00","content","附资料","mediaIds",List.of(media)))));
    long f=data(mvc.perform(get(BASE+"/"+a))).path("followups").get(0).path("id").asLong();
    assertThat(jdbc.queryForObject("SELECT access_level FROM media_assets WHERE id=?",String.class,media)).isEqualTo("private");
    var response=mvc.perform(get(BASE+"/"+a+"/followups/"+f+"/attachments/"+media)).andExpect(status().isOk()).andReturn().getResponse();
    assertThat(response.getHeader("Content-Disposition")).startsWith("attachment;");
    assertThat(response.getContentType()).isEqualTo("application/octet-stream");
    identity(90002,90001L,"self","all"); mvc.perform(get(BASE+"/"+a+"/followups/"+f+"/attachments/"+media)).andExpect(status().isForbidden());
    identity(90001,90001L,"all","all"); mvc.perform(delete(BASE+"/"+a+"/followups/"+f)).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE media_id=?",Integer.class,media)).isZero();
  }
  @Test void crossTenantCannotReadOrAssignCustomer() throws Exception {
    long a=create();
    jdbc.update("INSERT INTO tenants(id,account_id,business_types) VALUES (90003,90002,'cityPartner')");
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type) VALUES (90004,90003,'跨租户门店','cityPartner')");
    var i=new CurrentIdentity(null,90002L,null,null,"admin",90003L,90004L,"他租户员工","all",List.of(),List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(i,null,List.of()));
    assertThat(data(mvc.perform(get(BASE).param("status","daily"))).size()).isZero();
    mvc.perform(get(BASE+"/"+a)).andExpect(status().isForbidden());
    action(a,"daily","assign",90002L).andExpect(status().isForbidden());
  }
  @Test void temporaryAttachmentCannotBeClaimedOrReleasedByAnotherOwner() throws Exception {
    long a=create();
    var file=new MockMultipartFile("file","note.bin","application/octet-stream",new byte[] { 1 });
    long media=data(mvc.perform(multipart(BASE+"/"+a+"/attachments").file(file))).path("id").asLong();
    identity(90002,90001L,"all","all"); long b=create();
    follow(b,json.writeValueAsString(java.util.Map.of("followedAt","2026-10-13T10:00:00","content","伪造附件","mediaIds",List.of(media))))
        .andExpect(status().isBadRequest());
    mvc.perform(delete(BASE+"/"+b+"/attachments/"+media)).andExpect(status().isForbidden());
  }
  @Test void unknownDataScopeAndNoFunctionGrantCannotAccess() throws Exception {
    identity(90001,90001L,"", "all"); mvc.perform(get(BASE).param("status","daily")).andExpect(status().isForbidden());
    identity(90001,90001L,"all"); mvc.perform(get(BASE).param("status","daily")).andExpect(status().isForbidden());
  }
  @Test void attachmentLimitIsEnforcedForAnyFormat() throws Exception {
    long a=create(); var file=new MockMultipartFile("file","big.bin","application/octet-stream",new byte[5*1024*1024+1]);
    mvc.perform(multipart(BASE+"/"+a+"/attachments").file(file)).andExpect(status().isBadRequest());
  }
}
