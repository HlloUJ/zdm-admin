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
    return data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"王先生\",\"phone\":\"\",\"wechat\":\"\",\"requirement\":\"餐桌\",\"remark\":\"\"}"))).path("id").asLong();
  }
  private ResultActions action(long id,String source,String action,Long owner) throws Exception {
    return mvc.perform(post(BASE+"/action").contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(
        java.util.Map.of("ids",List.of(id),"status",source,"action",action,"ownerAccountId",owner==null ? 90001L : owner))));
  }
  private ResultActions follow(long id,String content) throws Exception {
    return mvc.perform(post(BASE+"/"+id+"/followups").contentType(MediaType.APPLICATION_JSON).content(content));
  }
  @Test void duplicateNamesAndPhonesAndMissingPhoneAreAccepted() throws Exception {
    long a=create(); long b=create(); assertThat(a).isNotEqualTo(b);
    String p="{\"name\":\"王先生\",\"phone\":\"123\"}";
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
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"伪造\"}")).andExpect(status().isForbidden());
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
  @Test void allViewNeverAllowsMaintainingOthersButAssignmentNeedsNoRoleName() throws Exception {
    long a=create(); identity(90002,90001L,"all","all");
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"篡改\"}")).andExpect(status().isForbidden());
    action(a,"daily","archive",null).andExpect(status().isForbidden());
    follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"越权\",\"mediaIds\":[]}").andExpect(status().isForbidden());
    action(a,"daily","assign",90002L).andExpect(status().isOk());
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"合法维护\"}")).andExpect(status().isOk());
  }
  @Test void createdScopeAndOwnerCannotBeForgedInProfile() throws Exception {
    var c=data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"客户\",\"tenantId\":999,\"storeId\":90002,\"ownerAccountId\":90002}")));
    assertThat(c.path("storeId").asLong()).isEqualTo(90001); assertThat(c.path("ownerAccountId").asLong()).isEqualTo(90001);
    var edited=data(mvc.perform(put(BASE+"/"+c.path("id").asLong()).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"修改\",\"ownerAccountId\":90002}")));
    assertThat(edited.path("ownerAccountId").asLong()).isEqualTo(90001);
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
    mvc.perform(put(BASE+"/"+a).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"归档修改\"}")).andExpect(status().isOk());
    data(follow(a,"{\"followedAt\":\"2026-10-13T10:00:00\",\"content\":\"归档跟进\",\"mediaIds\":[]}"));
    assertThat(data(mvc.perform(get(BASE+"/"+a))).path("customer").path("status").asText()).isEqualTo("archived");
    action(a,"archived","purge",null).andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_customer_followups WHERE customer_id=?",Integer.class,a)).isZero();
  }
  @Test void mixedOwnershipBatchMakesNoPartialChanges() throws Exception {
    long a=create(); long b=create(); action(b,"daily","assign",90002L).andExpect(status().isOk());
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
