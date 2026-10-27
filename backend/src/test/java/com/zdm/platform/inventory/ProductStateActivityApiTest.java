package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
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
class ProductStateActivityApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("state_activity_api").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private JdbcTemplate jdbc;
  @Autowired private MockMvc mvc;
  @Autowired private ObjectMapper json;
  @Autowired private ProductStateActivityService activities;
  @Autowired private AccessoryStateActivityService accessoryActivities;
  @Autowired private ProductLifecycleService lifecycle;
  @Autowired private AccessoryLifecycleService accessoryLifecycle;
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  static Stream<Arguments> surfaces() {
    return Stream.of("finished", "accessory", "slab").flatMap(kind ->
        Stream.of("admin", "supply-chain").flatMap(client ->
            Stream.of("warehouse", "selling").map(state -> Arguments.of(kind, client, state))));
  }
  private void identity(String client) {
    var actor = new CurrentIdentity(1L, 1L, 1L, 1L, client, null, null, "真实触发人", "all", List.of("OPERATOR"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor, null, List.of()));
  }
  private String table(String kind) { return "slab".equals(kind) ? "slab_inventory" : kind + "_products"; }
  private String key(String kind) { return "slab".equals(kind) ? "slab_id" : "product_id"; }
  private String logs(String kind) { return "slab".equals(kind) ? "slab_operation_logs" : kind + "_operation_logs"; }
  private String endpoint(String kind) { return "slab".equals(kind) ? "slabs" : kind + "-products"; }
  private void product(String kind, String state) {
    String fields = "slab".equals(kind) ? "serial_no,stock,cost_price" : "sku,total_stock";
    String values = "slab".equals(kind) ? "'STATE-API',2,10" : "'STATE-API',2";
    jdbc.update("INSERT INTO " + table(kind) + " (id,name,status,source_status,operations_deleted,created_by_account_id," + fields + ") VALUES (99880,'状态时间商品',?,?,FALSE,1," + values + ")", state, state);
  }
  @ParameterizedTest @MethodSource("surfaces")
  void returnsRealDatabaseTimeWithoutSourceTagPayload(String kind, String client, String state) throws Exception {
    identity(client); product(kind, state);
    if ("accessory".equals(kind)) { accessoryActivities.record(kind, client, 99880L, null, state, 1L, "supply-chain"); }
    else { activities.record(kind, client, 99880L, null, state, 1L, "supply-chain"); }
    LocalDateTime expected = jdbc.queryForObject("SELECT occurred_at FROM product_state_activity WHERE kind=? AND business_client_code=? AND record_id=99880", LocalDateTime.class, kind, client);
    String body = mvc.perform(get("/api/admin/" + endpoint(kind))).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    JsonNode record = null;
    for (JsonNode row : json.readTree(body).path("data")) { if (row.path("id").asLong() == 99880L) { record = row; break; } }
    assertThat(record).isNotNull();
    assertThat(record.path("stateOperatedAt").asText()).endsWith("Z");
    assertThat(LocalDateTime.parse(record.path("stateOperatedAt").asText().replace("Z", ""))).isEqualTo(expected);
    assertThat(record.path("stateOperatorName").asText()).isNotBlank();
    assertThat(record.has("stateOperatorClientCode")).isFalse();
  }
  @ParameterizedTest @ValueSource(strings = {"finished", "accessory"})
  void transitionResponseMatchesPersistedActivityBeforeAnyListRefresh(String kind) throws Exception {
    identity("supply-chain"); product(kind, "selling");
    for (String target : List.of("offShelf", "warehouse", "recycle", "warehouse")) {
      String body = mvc.perform(put("/api/admin/" + endpoint(kind) + "/99880")
          .contentType("application/json")
          .content("{\"name\":\"状态时间商品\",\"status\":\"" + target + "\",\"offShelfReason\":\"价格调整\"}"))
          .andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
      JsonNode response = json.readTree(body).path("data");
      var activity = jdbc.queryForMap("SELECT occurred_at, operator_account_id FROM product_state_activity WHERE kind=? AND business_client_code='supply-chain' AND record_id=99880 AND state=?", kind, target);
      assertThat(response.path("stateOperatorName").asText()).isNotBlank();
      assertThat(response.path("stateOperatedAt").isTextual()).isTrue();
      assertThat(LocalDateTime.parse(response.path("stateOperatedAt").asText().replace("Z", "")))
          .isEqualTo(StateActivityTime.read(activity.get("occurred_at")));
      assertThat(((Number) activity.get("operator_account_id")).longValue()).isEqualTo(1L);
      JsonNode refreshed = null;
      for (JsonNode row : json.readTree(mvc.perform(get("/api/admin/" + endpoint(kind)))
          .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("data")) {
        if (row.path("id").asLong() == 99880L) { refreshed = row; break; }
      }
      assertThat(refreshed).isNotNull();
      assertThat(response.path("stateOperatorName")).isEqualTo(refreshed.path("stateOperatorName"));
      assertThat(response.path("stateOperatedAt")).isEqualTo(refreshed.path("stateOperatedAt"));
      assertThat(response.path("sourceStatus").asText()).isEqualTo(target);
    }
  }
  @ParameterizedTest @ValueSource(strings = {"admin", "supply-chain"})
  void slabStatusMutationAndListReadSamePersistedActivity(String client) throws Exception {
    identity(client); product("slab", "selling");
    for (String target : List.of("offShelf", "warehouse", "recycle", "warehouse")) {
      if ("recycle".equals(target)) {
        mvc.perform(post("/api/admin/slabs/99880/delete").contentType("application/json").content("{}"))
            .andExpect(status().isOk());
      } else {
        mvc.perform(put("/api/admin/slabs/batch-status").contentType("application/json")
            .content("{\"ids\":[99880],\"status\":\"" + target + "\",\"reason\":\"价格调整\"}"))
            .andExpect(status().isOk());
      }
      JsonNode actual = null;
      for (JsonNode row : json.readTree(mvc.perform(get("/api/admin/slabs"))
          .andExpect(status().isOk()).andReturn().getResponse().getContentAsString()).path("data")) {
        if (row.path("id").asLong() == 99880L) { actual = row; break; }
      }
      assertThat(actual).isNotNull();
      var activity = jdbc.queryForMap("SELECT state, occurred_at, operator_account_id FROM product_state_activity WHERE kind='slab' AND business_client_code=? AND record_id=99880", client);
      assertThat(activity.get("state")).isEqualTo(target);
      assertThat(actual.path("stateOperatorName").asText()).isNotBlank();
      assertThat(LocalDateTime.parse(actual.path("stateOperatedAt").asText().replace("Z", "")))
          .isEqualTo(StateActivityTime.read(activity.get("occurred_at")));
      assertThat(((Number) activity.get("operator_account_id")).longValue()).isEqualTo(1L);
    }
  }
  @ParameterizedTest @ValueSource(strings = {"finished", "accessory", "slab"})
  void reentryKeepsRealTriggerReasonAndHistoricalLogs(String kind) throws Exception {
    identity("admin"); product(kind, "selling");
    jdbc.update("UPDATE stores SET store_level_id=NULL");
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("UPDATE " + table(kind) + " SET source_status='selling',operations_invalidated_at=UTC_TIMESTAMP(),operations_invalidated_reason='来源曾下架' WHERE id=99880");
    jdbc.update("INSERT INTO " + kind + "_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    if (!"slab".equals(kind)) {
      jdbc.update("INSERT INTO " + kind + "_product_variants (id," + kind + "_product_id,variant_label,stock,cost_price) VALUES (99880,99880,'规格',2,10)");
    }
    String subject = "slab".equals(kind) ? "slab_name" : "product_name";
    String code = "slab".equals(kind) ? "slab_serial_no" : "merchant_code";
    jdbc.update("INSERT INTO " + logs(kind) + " (" + key(kind) + "," + subject + "," + code + ",operated_at,created_at,publisher_type,operation_source,business_client_code,operator_client_code,operation_type,operation_summary,operator_name,after_status,change_details) VALUES (99880,'状态时间商品','STATE-API',UTC_TIMESTAMP(),UTC_TIMESTAMP(),'平台发布','SUPPLY_CHAIN','admin','supply-chain','SOURCE_SHELF','历史供应链上架','历史操作人','warehouse','{\"历史字段\":{\"after\":\"原值\"}}')");
    var original = jdbc.queryForMap("SELECT * FROM " + logs(kind) + " WHERE " + key(kind) + "=99880 AND operation_type='SOURCE_SHELF'");
    if ("accessory".equals(kind)) { accessoryLifecycle.purgeOperations(AccessoryLifecycleService.Kind.ACCESSORY, 99880L); }
    else { lifecycle.purgeOperations("slab".equals(kind) ? ProductLifecycleService.Kind.SLAB : ProductLifecycleService.Kind.FINISHED, 99880L); }
    assertThat(jdbc.queryForMap("SELECT * FROM " + logs(kind) + " WHERE id=?", original.get("id"))).isEqualTo(original);
    var log = jdbc.queryForMap("SELECT * FROM " + logs(kind) + " WHERE " + key(kind) + "=99880 AND operation_type='REENTRY'");
    assertThat(log).containsEntry("operator_client_code", "admin").containsEntry("operator_name", "真实触发人")
        .containsEntry("operation_source", "MANUAL").containsEntry("after_status", "warehouse");
    assertThat(((Number) log.get("operator_account_id")).longValue()).isEqualTo(1L);
    assertThat(log.get("operation_summary")).isEqualTo(FinishedOperationLogService.REENTRY_SUMMARY);
    assertThat(json.readTree((String) log.get("change_details")).path("重新入仓原因").path("after").asText()).isEqualTo(FinishedOperationLogService.REENTRY_SUMMARY);
    assertThat(jdbc.queryForObject("SELECT status FROM " + table(kind) + " WHERE id=99880", String.class)).isEqualTo("warehouse");
    assertThat(jdbc.queryForObject("SELECT operations_deleted FROM " + table(kind) + " WHERE id=99880", Boolean.class)).isFalse();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM " + logs(kind) + " WHERE " + key(kind) + "=99880 AND operation_type='SOURCE_SHELF'", Long.class)).isEqualTo(1L);
    String body = mvc.perform(get("/api/admin/" + endpoint(kind) + "/operation-logs").param("operationType", "REENTRY")).andExpect(status().isOk()).andReturn().getResponse().getContentAsString();
    assertThat(json.readTree(body).path("data").path("records")).hasSize(1);
  }
}
