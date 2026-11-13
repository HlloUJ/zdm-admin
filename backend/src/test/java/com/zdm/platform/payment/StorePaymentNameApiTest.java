package com.zdm.platform.payment;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc(addFilters = false)
@Testcontainers(disabledWithoutDocker = true)
class StorePaymentNameApiTest extends SpringContainerTestSupport {
  private static final String BASE = "/api/store/payment-names";
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("payment_name_test").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ObjectMapper json;
  @Autowired private StorePaymentNameService service;
  @BeforeEach void fixtures() {
    jdbc.update("DELETE FROM store_payment_name_events");
    jdbc.update("DELETE FROM store_payment_names");
    jdbc.update("INSERT IGNORE INTO accounts(id,phone,display_name) VALUES (90001,'13890000001','导购A'),(90002,'13890000002','导购B')");
    jdbc.update("INSERT IGNORE INTO stores(id,tenant_id,name,type) VALUES (90001,1,'款项门店','cityPartner'),(90002,1,'另一门店','cityPartner'),(90003,1,'供应商门店','slabSupplier')");
    jdbc.update("UPDATE stores SET status='enabled' WHERE id BETWEEN 90001 AND 90003");
    identity(90001, 1L, 90001L, "admin", "all", "all");
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  private void identity(long account, Long tenant, Long store, String client, String data, String... grants) {
    var permissions = java.util.Arrays.stream(grants).map(value -> value.equals("all") || value.startsWith("store.") ? value : StorePaymentNameService.PREFIX + "." + value).toList();
    var identity = new CurrentIdentity(null, account, null, null, client, tenant, store, "操作人", data, List.of(), permissions);
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }
  private JsonNode data(ResultActions result) throws Exception {
    return json.readTree(result.andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray()).path("data");
  }
  private ResultActions createRequest(String name) throws Exception {
    return mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content(json.writeValueAsString(Map.of("name", name))));
  }
  private JsonNode create(String name) throws Exception { return data(createRequest(name)); }
  private ResultActions edit(JsonNode row, String name, long version) throws Exception {
    return mvc.perform(put(BASE + "/" + row.path("id").asText()).contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(Map.of("name", name, "version", version))));
  }
  private ResultActions state(JsonNode row, boolean enabled, long version) throws Exception {
    return mvc.perform(put(BASE + "/" + row.path("id").asText() + "/status").contentType(MediaType.APPLICATION_JSON)
        .content(json.writeValueAsString(Map.of("enabled", enabled, "version", version))));
  }
  private ResultActions deleteRequest(JsonNode row, long version) throws Exception {
    return mvc.perform(delete(BASE + "/" + row.path("id").asText()).param("version", String.valueOf(version)));
  }
  @Test void emptyStoreHasNoDefaultsAndInputScopeCannotBeForged() throws Exception {
    assertEquals(0, data(mvc.perform(get(BASE))).path("total").asInt());
    var row = data(mvc.perform(post(BASE).contentType(MediaType.APPLICATION_JSON).content("{\"name\":\"定金\",\"storeId\":90002,\"tenantId\":999,\"createdBy\":90002}")));
    assertTrue(row.path("enabled").asBoolean());
    assertEquals(90001, row.path("createdBy").asInt());
    assertEquals(90001L, jdbc.queryForObject("SELECT store_id FROM store_payment_names WHERE id=?", Long.class, row.path("id").asText()));
  }
  @Test void namesAreTrimmedLimitedToTenAndCaseSensitiveIncludingDisabledRows() throws Exception {
    assertEquals("十个字符名称测试文字", create(" 十个字符名称测试文字 ").path("name").asText());
    createRequest("十一字符名称测试文字啊").andExpect(status().isBadRequest());
    createRequest("   ").andExpect(status().isBadRequest());
    var upper = create("Deposit"); create("deposit");
    state(upper, false, 1).andExpect(status().isOk());
    createRequest("Deposit").andExpect(status().isBadRequest());
    edit(upper, "十一字符名称测试文字啊", 2).andExpect(status().isBadRequest());
    edit(upper, "deposit", 2).andExpect(status().isBadRequest());
  }
  @Test void sharedStoreNamesUseCurrentAccountNameAndKeepCreationMetadata() throws Exception {
    var row = create("定金");
    identity(90002, 1L, 90001L, "admin", "self", "view", "edit");
    var updated = data(edit(row, "订金", 1));
    assertEquals(row.path("createdAt"), updated.path("createdAt"));
    assertEquals(row.path("createdBy"), updated.path("createdBy"));
    jdbc.update("UPDATE accounts SET display_name='导购A新姓名' WHERE id=90001");
    assertEquals("导购A新姓名", data(mvc.perform(get(BASE))).path("items").get(0).path("createdByName").asText());
  }
  @Test void softDeletionAllowsFreshSameNameAndPreservesAuditSnapshots() throws Exception {
    var row = create("定金");
    deleteRequest(row, 1).andExpect(status().isOk());
    deleteRequest(row, 1).andExpect(status().isOk());
    var replacement = create("定金");
    assertNotEquals(row.path("id"), replacement.path("id"));
    assertEquals(1, data(mvc.perform(get(BASE))).path("total").asInt());
    assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_names WHERE id=? AND deleted_at IS NOT NULL", Integer.class, row.path("id").asText()));
    assertTrue(jdbc.queryForObject("SELECT before_value FROM store_payment_name_events WHERE action='delete' AND payment_name_id=?", String.class, row.path("id").asText()).contains("定金"));
  }
  @Test void staleEditStatusAndDeleteAreRejectedWithoutExtraAuditEvents() throws Exception {
    var row = create("定金");
    var edited = data(edit(row, "订金", 1));
    assertEquals(2, edited.path("version").asInt());
    edit(row, "尾款", 1).andExpect(status().isBadRequest());
    state(row, false, 1).andExpect(status().isBadRequest());
    deleteRequest(row, 1).andExpect(status().isBadRequest());
    assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_name_events", Integer.class));
    state(row, false, 2).andExpect(status().isOk());
    assertEquals(0, data(mvc.perform(get(BASE + "/options"))).size());
    state(row, true, 3).andExpect(status().isOk());
    assertEquals(1, data(mvc.perform(get(BASE + "/options"))).size());
  }
  @Test void listIsStablySortedAndPaginatedByCreationTimeAndId() throws Exception {
    var first = create("定金"); var second = create("尾款");
    jdbc.update("UPDATE store_payment_names SET created_at='2026-11-06 10:00:00'");
    var page = data(mvc.perform(get(BASE).param("page", "1").param("pageSize", "1")));
    assertEquals(2, page.path("total").asInt()); assertEquals(second.path("id"), page.path("items").get(0).path("id"));
    assertEquals(first.path("id"), data(mvc.perform(get(BASE).param("page", "2").param("pageSize", "1"))).path("items").get(0).path("id"));
    mvc.perform(get(BASE).param("page", "0")).andExpect(status().isBadRequest());
  }
  @Test void crossStoreCrossTenantAndOtherClientsCannotReadOrMutate() throws Exception {
    var row = create("定金");
    identity(90002, 1L, 90002L, "admin", "all", "all");
    assertEquals(0, data(mvc.perform(get(BASE))).path("total").asInt());
    edit(row, "盗改", 1).andExpect(status().isBadRequest());
    deleteRequest(row, 1).andExpect(status().isBadRequest());
    create("定金");
    identity(90001, 999L, 90001L, "admin", "all", "all");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
    identity(90001, 1L, 90003L, "admin", "all", "all");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
    identity(90001, 1L, 90001L, "supply-chain", "all", "all");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
    identity(90001, null, null, "admin", "all", "all");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
  }
  @Test void viewOnlyCannotWriteAndReceiptOnlyCanReadMinimalOptions() throws Exception {
    var row = create("定金");
    identity(90002, 1L, 90001L, "admin", "self", "view");
    createRequest("尾款").andExpect(status().isForbidden());
    edit(row, "尾款", 1).andExpect(status().isForbidden());
    state(row, false, 1).andExpect(status().isForbidden());
    deleteRequest(row, 1).andExpect(status().isForbidden());
    identity(90002, 1L, 90001L, "admin", "self", "store.order-management.sales.pending.receipt");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
    var option = data(mvc.perform(get(BASE + "/options"))).get(0);
    assertEquals(3, option.size()); assertTrue(option.has("id")); assertTrue(option.has("name")); assertTrue(option.has("version"));
    identity(90002, 1L, 90001L, "admin", "self");
    mvc.perform(get(BASE + "/options")).andExpect(status().isForbidden());
  }
  @Test void inactiveStoreAndMissingDataScopeAreDenied() throws Exception {
    jdbc.update("UPDATE stores SET status='disabled' WHERE id=90001");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
    jdbc.update("UPDATE stores SET status='enabled' WHERE id=90001");
    identity(90001, 1L, 90001L, "admin", "", "all");
    mvc.perform(get(BASE)).andExpect(status().isForbidden());
  }
  @Test void auditFailureRollsBackConfigurationInsert() {
    var identity = new CurrentIdentity(null, 90001L, null, null, "admin", 1L, 90001L,
        "X".repeat(101), "all", List.of(), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity, null, List.of()));
    assertThrows(RuntimeException.class, () -> service.create("回滚验证"));
    assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_names", Integer.class));
    assertEquals(0, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_name_events", Integer.class));
  }
  @Test void concurrentEditsDoNotSilentlyOverwriteTheFirstWriter() throws Exception {
    var row = create("定金");
    try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var tasks = java.util.stream.IntStream.range(0, 2).mapToObj(index -> executor.submit(() -> {
        identity(90001, 1L, 90001L, "admin", "all", "all");
        try { service.update(row.path("id").asLong(), "订金" + index, 1); return true; }
        catch (IllegalArgumentException expected) { return false; }
        finally { clear(); }
      })).toList();
      assertEquals(1, tasks.stream().filter(task -> { try { return task.get(); } catch (Exception ex) { throw new IllegalStateException(ex); } }).count());
    }
    assertEquals(2, jdbc.queryForObject("SELECT version FROM store_payment_names WHERE id=?", Integer.class, row.path("id").asText()));
    assertEquals(2, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_name_events", Integer.class));
  }
  @Test void concurrentSameNameCreationHasOneWinnerAndOneAuditEvent() throws Exception {
    try (var executor = java.util.concurrent.Executors.newFixedThreadPool(2)) {
      var tasks = java.util.stream.IntStream.range(0, 2).mapToObj(index -> executor.submit(() -> {
        identity(90001, 1L, 90001L, "admin", "all", "all");
        try { service.create("并发定金"); return true; }
        catch (IllegalArgumentException expected) { return false; }
        finally { clear(); }
      })).toList();
      assertEquals(1, tasks.stream().filter(task -> { try { return task.get(); } catch (Exception ex) { throw new IllegalStateException(ex); } }).count());
    }
    assertEquals(1, jdbc.queryForObject("SELECT COUNT(*) FROM store_payment_name_events", Integer.class));
  }
}
