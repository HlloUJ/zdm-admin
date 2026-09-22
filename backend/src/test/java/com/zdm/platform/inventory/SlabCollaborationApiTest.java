package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.CurrentIdentity;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
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
class SlabCollaborationApiTest {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("slab_collaboration").withUsername("test").withPassword("test");
  @DynamicPropertySource static void database(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @Autowired private MockMvc mvc;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ProductLifecycleService lifecycle;
  @Autowired private SlabInventoryService slabs;
  @Autowired private SlabOperationLogService logs;
  @Autowired private SlabPriceService prices;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;

  private void identity(String client, String scope, String... permissions) {
    var user = new CurrentIdentity(1L, 1L, 1L, 1L, client, null, null, "大板协同测试", scope,
        List.of("OPERATOR"), List.of(permissions));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(user, null, List.of()));
  }
  @AfterEach void clear() { SecurityContextHolder.clearContext(); }
  private void fixture(String status, String source, boolean deleted, long creator) {
    jdbc.update("INSERT INTO slab_inventory (id,name,serial_no,status,source_status,operations_deleted,created_by_account_id,stock,cost_price) VALUES (99601,'协同大板','SLAB-COLLAB',?,?,?,?,2,10)", status, source, deleted, creator);
  }
  @Test void missingPartnerConfigurationAllowsInitialPricingAndManualCompletion() {
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99609,'未配置合伙人',1)");
    jdbc.update("INSERT INTO slab_guide_price_settings (id,price_coefficient) VALUES (1,2) ON DUPLICATE KEY UPDATE price_coefficient=2");
    fixture("warehouse", "selling", false, 1L);
    identity("supply-chain", "all", "all");
    lifecycle.reprice(ProductLifecycleService.Kind.SLAB,99601L,false);
    assertThat(slabs.getById(99601L).getOperationsDeleted()).isFalse();
    assertThat(slabs.getById(99601L).getStatus()).isEqualTo("warehouse");
    assertThatThrownBy(() -> prices.requireCompletePrices(99601L)).hasMessageContaining("请完善全部大板价格");
    identity("admin", "all", "all");
    var price = new SlabPrice();
    price.setStoreLevelId(99609L);
    price.setPriceCoefficient(new java.math.BigDecimal("1.5"));
    price.setCostPrice(new java.math.BigDecimal("10"));
    price.setPrice(new java.math.BigDecimal("15"));
    price.setPriceSource("manual");
    prices.replacePrices(99601L,List.of(price));
    prices.requireCompletePrices(99601L);
    assertThat(prices.listPrices(99601L).getFirst().getPriceSource()).isEqualTo("manual");
    jdbc.update("UPDATE slab_inventory SET cost_price=20 WHERE id=99601");
    sqlSession.clearCache();
    lifecycle.reprice(ProductLifecycleService.Kind.SLAB,99601L,false);
    assertThat(prices.listPrices(99601L).getFirst().getPriceCoefficient()).isEqualByComparingTo("1.5");
    assertThat(prices.listPrices(99601L).getFirst().getPrice()).isEqualByComparingTo("30");
  }

  @Test void batchOperationsKeepIndividualLogsWithoutBatchNumber() throws Exception {
    fixture("offShelf", "selling", false, 1L);
    jdbc.update("INSERT INTO slab_inventory (id,name,serial_no,status,source_status,operations_deleted,created_by_account_id,stock,cost_price) VALUES (99602,'协同大板2','SLAB-COLLAB-2','offShelf','selling',false,1,2,10)");
    identity("admin", "all", "all");
    slabs.updateStatuses(List.of(99601L,99602L), "warehouse", null, null);
    var records = logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).records();
    assertThat(records).hasSize(2);
    var mapper = new com.fasterxml.jackson.databind.ObjectMapper().findAndRegisterModules();
    for (var record : records) {
      assertThat(record.getOperationType()).isEqualTo("RESTORE_WAREHOUSE");
      assertThat(record.getStandardReason()).isNull();
      assertThat(record.getDetailReason()).isNull();
      assertThat(mapper.valueToTree(record).has("batchNo")).isFalse();
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='slab_operation_logs' AND column_name='batch_no'", Integer.class)).isZero();
  }

  @Test void arrivalSnapshotsAndLegacyReplayPreserveHistoricalDimensionsAndPrices() throws Exception {
    fixture("warehouse", "selling", false, 1L);
    identity("supply-chain", "all", "all");
    jdbc.update("UPDATE slab_inventory SET length_mm=2000,width_mm=1800,thickness_mm=20,area_square_meter=3.6 WHERE id=99601");
    var snapshot = logs.arrivalSnapshot(99601L);
    logs.record(slabs.getById(99601L), "CREATE", null, "warehouse", null, null, "MANUAL", snapshot);
    assertThat(jdbc.queryForObject("SELECT operation_summary FROM slab_operation_logs WHERE slab_id=99601 ORDER BY id DESC LIMIT 1", String.class)).isEqualTo("创建大板");
    identity("admin", "all", "all");
    logs.record(slabs.getById(99601L), "SOURCE_SHELF", null, "warehouse", null, null, "SUPPLY_CHAIN", snapshot);
    logs.record(slabs.getById(99601L), "SOURCE_SYNC", "warehouse", "warehouse", null, null, "SUPPLY_CHAIN",
        java.util.Map.of("来源状态",java.util.Map.of("before","warehouse","after","selling"),
            "入仓价格",java.util.Map.of("before",List.of(),"after",List.of(java.util.Map.of("cost_price",10,"guide_price",20,"guide_price_coefficient",2)))));
    jdbc.update("UPDATE slab_inventory SET length_mm=9000,area_square_meter=16.2,cost_price=99 WHERE id=99601");
    var records=logs.listPage("SLAB-COLLAB","SOURCE_SHELF",null,null,null,1,10).records();
    assertThat(records).hasSize(2);
    var json=new com.fasterxml.jackson.databind.ObjectMapper();
    for(var record:records) {
      var details=json.readTree(record.getChangeDetails());
      assertThat(record.getBeforeStatus()).isNull();
      assertThat(record.getOperationSummary()).isEqualTo(FinishedOperationLogService.SOURCE_SHELF_SUMMARY);
      assertThat(details.path("长度").path("after").asInt()).isEqualTo(2000);
      assertThat(details.path("面积").path("after").decimalValue()).isEqualByComparingTo("3.6");
      assertThat(details.path("成本价").path("after").asInt()).isEqualTo(10);
      assertThat(details.has("入仓价格")).isFalse();
      assertThat(details.has("1:1主图")).isTrue();
    }
  }

  private String permissionScope(String status) {
    return switch (status) { case "offShelf" -> "off-shelf"; case "soldOut" -> "sold-out"; default -> status; };
  }

  @ParameterizedTest
  @ValueSource(strings = {"warehouse", "selling", "offShelf", "soldOut", "recycle"})
  void detailRequiresTheActualTabPermission(String state) throws Exception {
    fixture(state, "selling", false, 1L);
    String prefix = "admin.slab-management." + permissionScope(state);
    identity("admin", "all", prefix + ".view");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isForbidden());
    identity("admin", "all", prefix + ".view", prefix + ".detail");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.status").value(state)).andExpect(jsonPath("$.data.stock").value(2));
    String other = "warehouse".equals(state) ? "selling" : "warehouse";
    identity("admin", "all", prefix + ".view", "admin.slab-management." + other + ".detail");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isForbidden());
  }

  @Test void detailDoesNotLeakOtherCreatorsOrDeletedOperations() throws Exception {
    fixture("warehouse", "selling", false, 2L);
    identity("admin", "self", "admin.slab-management.warehouse.view", "admin.slab-management.warehouse.detail");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isBadRequest());
    identity("admin", "all", "all");
    jdbc.update("UPDATE slab_inventory SET operations_deleted=TRUE WHERE id=99601");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isBadRequest());
    mvc.perform(get("/api/admin/slabs")).andExpect(jsonPath("$.data[?(@.id == 99601)]").isEmpty());
  }

  @Test void sourceActionsLogBothSidesAndKeepPurgedSourceReadableUntilOperationsPurge() throws Exception {
    fixture("selling", "selling", false, 1L);
    identity("supply-chain", "all", "all");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "offShelf", "库存异常", "待核对库存");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "recycle");
    slabs.removeById(99601L);
    for (String client : List.of("admin", "supply-chain")) {
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code=?", Integer.class, client)).isEqualTo(3);
    }
    assertThat(jdbc.queryForList("SELECT JSON_UNQUOTE(JSON_EXTRACT(change_details,'$.\"来源状态\".after')) FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code='admin' ORDER BY id", String.class))
        .containsExactly("offShelf", "recycle", "purged");
    assertThat(jdbc.queryForObject("SELECT standard_reason FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code='admin' ORDER BY id LIMIT 1", String.class)).isNull();
    assertThat(jdbc.queryForObject("SELECT detail_reason FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code='admin' ORDER BY id LIMIT 1", String.class)).isNull();
    assertThat(jdbc.queryForObject("SELECT standard_reason FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code='supply-chain' AND operation_type='OFF_SHELF'", String.class)).isEqualTo("库存异常");
    jdbc.update("UPDATE slab_operation_logs SET standard_reason='旧原因',detail_reason='旧说明',change_details=JSON_SET(change_details,'$.\"下架原因\"',JSON_OBJECT('before','','after','旧原因')) WHERE slab_id=99601 AND business_client_code='admin' AND operation_type='SOURCE_OFF_SHELF'");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isBadRequest());
    identity("admin", "all", "all");
    assertThat(logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).records())
        .extracting(SlabOperationLog::getOperationType).containsExactly("SOURCE_DELETE", "SOURCE_OFF_SHELF");
    assertThat(logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).records())
        .extracting(SlabOperationLog::getOperationSummary).containsExactly("供应链已删除该商品", "供应链已下架该商品");
    for (var log : logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).records()) {
      assertThat(log.getStandardReason()).isNull();
      assertThat(log.getDetailReason()).isNull();
      assertThat(new com.fasterxml.jackson.databind.ObjectMapper().readTree(log.getChangeDetails()).size()).isEqualTo(1);
      assertThat(log.getChangeDetails()).contains("来源状态").doesNotContain("下架原因", "详细说明");
    }
    jdbc.update("UPDATE slab_operation_logs SET operation_type='SOURCE_SYNC' WHERE slab_id=99601 AND business_client_code='admin'");
    assertThat(logs.listPage("SLAB-COLLAB", "SOURCE_OFF_SHELF", null, null, null, 1, 10).total()).isEqualTo(1);
    assertThat(logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).records())
        .extracting(SlabOperationLog::getOperationType).containsExactly("SOURCE_DELETE", "SOURCE_OFF_SHELF");
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sourceStatus").value("purged"))
        .andExpect(jsonPath("$.data.sourceUnavailable").value(true))
        .andExpect(jsonPath("$.data.status").value("selling"))
        .andExpect(jsonPath("$.data.sourceOffShelfRecords[0].standardReason").value("库存异常"));
    mvc.perform(put("/api/admin/slabs/batch-status").contentType("application/json")
        .content("{\"ids\":[99601],\"status\":\"offShelf\",\"reason\":\"库存异常\"}"))
        .andExpect(status().isBadRequest());
    slabs.removeById(99601L);
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isBadRequest());
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=99601", Integer.class)).isEqualTo(7);
  }

  @Test void sourceOnlyRecordDoesNotCreateOperationsOrOperationsLogs() {
    fixture("warehouse", "selling", true, 1L);
    identity("supply-chain", "all", "all");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "offShelf", "库存异常", null);
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "recycle");
    slabs.removeById(99601L);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=99601 AND business_client_code='admin'", Integer.class)).isZero();
  }

  @Test void restoreToSourceWarehouseKeepsOperationsBlockedAndStateUnchanged() throws Exception {
    fixture("offShelf", "offShelf", false, 1L);
    identity("supply-chain", "all", "all");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "warehouse");
    identity("admin", "all", "all");
    assertThat(logs.listPage("SLAB-COLLAB", null, null, null, null, 1, 10).total()).isZero();
    mvc.perform(get("/api/admin/slabs/99601")).andExpect(status().isOk())
        .andExpect(jsonPath("$.data.sourceUnavailable").value(true))
        .andExpect(jsonPath("$.data.status").value("offShelf"));
  }

  @Test void sourceDeletionKeepsSubmittedReasonInBothLogs() {
    fixture("warehouse", "warehouse", false, 1L);
    identity("supply-chain", "all", "all");
    slabs.deleteFromManagement(99601L, "图片不清晰", "请重新采集扫描图");
    assertThat(jdbc.queryForList("SELECT standard_reason FROM slab_operation_logs WHERE slab_id=99601 ORDER BY id", String.class))
        .containsExactly("图片不清晰", "图片不清晰");
    assertThat(jdbc.queryForList("SELECT detail_reason FROM slab_operation_logs WHERE slab_id=99601 ORDER BY id", String.class))
        .containsExactly("请重新采集扫描图", "请重新采集扫描图");
  }

  @Test void invalidRepeatDoesNotDuplicateLogs() {
    fixture("selling", "selling", false, 1L);
    identity("supply-chain", "all", "all");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "offShelf", "库存异常", null);
    assertThatThrownBy(() -> lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB, 99601L, "offShelf", "库存异常", null))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=99601", Integer.class)).isEqualTo(2);
  }
  @Test void operationsShelfValidatesExistingSupplyChainMediaWithoutTreatingItAsANewUpload() {
    fixture("warehouse", "selling", false, 1L);
    identity("admin", "all", "all");
    for (long id : List.of(99701L, 99702L, 99703L)) {
      jdbc.update("INSERT INTO media_assets (id,public_id,storage_key,media_type,mime_type,owner_client_code,status) VALUES (?,UUID(),?,'image','image/png','supply-chain','active')", id, "slab-shelf-test-" + id);
    }
    jdbc.update("UPDATE slab_inventory SET main_image_media_id=99701,scan_image_media_id=99702,design_image_media_id=99703 WHERE id=99601");
    // Media validation must pass and reach the independent required business fields check.
    assertThatThrownBy(() -> slabs.updateStatuses(List.of(99601L), "selling", null, null))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("请完善大板基础信息后再上架");
    jdbc.update("UPDATE media_assets SET status='deleted' WHERE id=99701");
    sqlSession.clearCache();
    assertThatThrownBy(() -> slabs.updateStatuses(List.of(99601L), "selling", null, null))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("媒体资源不存在");
    jdbc.update("UPDATE media_assets SET status='active',media_type='video' WHERE id=99701");
    sqlSession.clearCache();
    assertThatThrownBy(() -> slabs.updateStatuses(List.of(99601L), "selling", null, null))
        .isInstanceOf(IllegalArgumentException.class).hasMessage("媒体文件类型不正确");
  }

  @Test void actionCheckUsesActualPermissionsAndStateWithoutChangingDataOrWritingLogs() throws Exception {
    fixture("selling", "selling", false, 1L);
    identity("admin", "all", "admin.slab-management.selling.view");
    String body = "{\"ids\":[99601],\"action\":\"offShelf\"}";
    mvc.perform(post("/api/admin/slabs/action-check").contentType("application/json").content(body))
        .andExpect(status().isForbidden());
    identity("admin", "all", "admin.slab-management.selling.off-shelf");
    mvc.perform(post("/api/admin/slabs/action-check").contentType("application/json").content(body))
        .andExpect(status().isOk());
    assertThat(jdbc.queryForObject("SELECT status FROM slab_inventory WHERE id=99601", String.class)).isEqualTo("selling");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM slab_operation_logs WHERE slab_id=99601", Integer.class)).isZero();
    jdbc.update("UPDATE slab_inventory SET source_status='offShelf' WHERE id=99601");
    sqlSession.clearCache();
    mvc.perform(post("/api/admin/slabs/action-check").contentType("application/json").content(body))
        .andExpect(status().isBadRequest());
  }

}
