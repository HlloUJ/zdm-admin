package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.security.TokenAuthenticationFilter;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@AutoConfigureMockMvc
@Testcontainers(disabledWithoutDocker = true)
class FinishedPriceSourceApiTest {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("finished_price_source").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private ProductLifecycleService lifecycle;
  @Autowired private FinishedOperationLogService logs;
  @Autowired private MockMvc mvc;
  @Autowired private FinishedProductPriceService prices;
  @Autowired private FinishedPriceConfigurationSyncService sync;
  @Autowired private FinishedMarkupConfigurationMapper configurations;
  private final String token = "Bearer " + TokenAuthenticationFilter.createAccountToken(1L);
  @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  @Test
  void followsOnlyAutoPricesAndFreezesDisabledConfiguration() throws Exception {
    jdbc.update("UPDATE store_levels SET status = 'disabled'");
    jdbc.update("INSERT INTO store_levels (id, name, sort_order) VALUES (99101, '来源测试级别', 1)");
    jdbc.update("INSERT INTO finished_products (id, name, sku) VALUES (99101, '来源测试商品', 'source-test')");
    jdbc.update("""
        INSERT INTO finished_markup_configurations
          (id, name, store_level_id, price_coefficient, status, legacy_seeded, sort_order)
        VALUES (99101, '来源测试级别', 99101, 2, 'enabled', false, 1)
        """);
    for (String key : List.of("A", "B")) {
      long skuId = key.equals("A") ? 99111L : 99112L;
      jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (?,99101,?,1,10)", skuId, key);
      jdbc.update("""
          INSERT INTO finished_product_guide_prices
            (finished_product_id, sku_id, variant_label, price_coefficient, cost_price, price)
          VALUES (99101, ?, ?, 3, 10, 30)
          """, skuId, key);
    }
    authenticateDirectService();
    assertThat(sync.backfillMissingPrices(configurations.selectById(99101L))).isEqualTo(2);
    List<FinishedProductPrice> existing = prices.listPrices(99101L);
    existing.get(1).setPriceSource("manual");
    authenticateDirectService();
    prices.replacePrices(99101L, existing);
    updateCoefficient(4);
    assertPrice("A", "40", "auto");
    assertPrice("B", "20", "manual");
    mvc.perform(delete("/api/admin/finished-markup-configurations/99101").header("Authorization", token))
        .andExpect(status().isBadRequest());
    setStatus("disabled");
    updateCoefficient(5);
    assertPrice("A", "40", "auto");
    setStatus("enabled");
    assertPrice("A", "50", "auto");
    assertPrice("B", "20", "manual");
    List<FinishedProductPrice> restored = prices.listPrices(99101L);
    restored.get(1).setPriceSource("auto");
    restored.get(1).setPriceCoefficient(new BigDecimal("5"));
    restored.get(1).setPrice(new BigDecimal("50"));
    authenticateDirectService();
    prices.replacePrices(99101L, restored);
    updateCoefficient(6);
    assertPrice("A", "60", "auto");
    assertPrice("B", "60", "auto");
  }


  @Test
  void recordsSupplyShelfAndKeepsRepublishedOperationsState() {
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,3) ON DUPLICATE KEY UPDATE price_coefficient=3");
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id) VALUES (99202,'上架日志供应商','platform',0)");
    jdbc.update("INSERT INTO product_categories (id,name,scope) VALUES (99202,'上架日志分类','finished')");
    jdbc.update("""
        INSERT INTO media_assets (id,public_id,storage_key,media_type,mime_type,owner_client_code)
        VALUES (99202,UUID(),'log-shelf-test','image','image/png','supply-chain')
        """);
    jdbc.update("""
        INSERT INTO finished_products
          (id,name,sku,supplier_id,category_id,detail,main_image_media_id,video_media_id,total_stock,
           source_status,status,operations_deleted,created_by_account_id)
        VALUES (99202,'上架日志商品','internal-shelf-test',99202,99202,'详情',99202,99202,2,'warehouse','warehouse',TRUE,1)
        """);
    jdbc.update("""
        INSERT INTO finished_product_variants (finished_product_id,variant_label,stock,cost_price)
        VALUES (99202,'规格A',2,10)
        """);
    var identity = new com.zdm.platform.security.CurrentIdentity(1L,1L,1L,null,"supply-chain",null,null,
        "供应链人员","all",List.of("SUPER_ADMIN"),List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,List.of()));
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"selling");
    Long firstId=jdbc.queryForObject("SELECT id FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin'",Long.class);
    assertThat(jdbc.queryForObject("SELECT operation_type FROM finished_operation_logs WHERE id=?",String.class,firstId)).isEqualTo("SOURCE_SHELF");
    assertThat(jdbc.queryForObject("SELECT operation_summary FROM finished_operation_logs WHERE id=?",String.class,firstId)).isEqualTo(FinishedOperationLogService.SOURCE_SHELF_SUMMARY);
    assertThat(jdbc.queryForObject("SELECT price FROM finished_product_guide_prices WHERE finished_product_id=99202",BigDecimal.class)).isEqualByComparingTo("30");
    assertThat(jdbc.queryForObject("SELECT operation_type FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='supply-chain'",String.class)).isEqualTo("SHELF");
    jdbc.update("UPDATE finished_products SET status='selling' WHERE id=99202");
    jdbc.update("UPDATE finished_product_guide_prices SET price=123 WHERE finished_product_id=99202");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"offShelf","调整",null);
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"warehouse");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"selling");
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=99202",String.class)).isEqualTo("selling");
    assertThat(jdbc.queryForObject("SELECT price FROM finished_product_guide_prices WHERE finished_product_id=99202",BigDecimal.class)).isEqualByComparingTo("123");
    assertThat(jdbc.queryForObject("SELECT operation_summary FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin' ORDER BY id DESC LIMIT 1",String.class))
        .isEqualTo("来源重新上架，解除遮罩并保留运营状态");
    assertThat(jdbc.queryForObject("SELECT before_status FROM finished_operation_logs WHERE id=?",String.class,firstId)).isNull();
    assertThat(jdbc.queryForObject("SELECT before_status FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin' ORDER BY id DESC LIMIT 1",String.class)).isEqualTo("selling");
    // Existing records are normalized for reading and filtering, without rewriting history.
    jdbc.update("UPDATE finished_operation_logs SET operation_type='SOURCE_SYNC',before_status='warehouse',operation_summary='旧入仓文案' WHERE id=?",firstId);
    authenticateDirectService();
    var page=logs.listPage("上架日志商品","SOURCE_SHELF",null,null,null,1,20);
    assertThat(page.total()).isEqualTo(2);
    assertThat(page.records()).allMatch(log -> "SOURCE_SHELF".equals(log.getOperationType()));
    assertThat(logs.detail(firstId).getBeforeStatus()).isNull();
    assertThat(logs.detail(firstId).getAfterStatus()).isEqualTo("warehouse");
    assertThat(logs.detail(firstId).getOperationSummary()).isEqualTo(FinishedOperationLogService.SOURCE_SHELF_SUMMARY);
    assertThat(logs.listPage("上架日志商品","SOURCE_SYNC",null,null,null,1,20).total()).isZero();
    assertThat(logs.listPage("上架日志商品",null,null,null,null,1,20).total()).isEqualTo(3);
    assertThat(logs.listPage("上架日志商品","SOURCE_OFF_SHELF",null,null,null,1,20).records())
        .singleElement().satisfies(log -> assertThat(log.getOperationSummary()).isEqualTo("供应链已下架该商品"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='supply-chain' AND operation_type='RESTORE'",Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT operation_type FROM finished_operation_logs WHERE id=?",String.class,firstId)).isEqualTo("SOURCE_SYNC");
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,List.of()));
    long expectedOperationsLogs = 3;
    for (String target : List.of("offShelf", "recycle", "warehouse", "selling", "offShelf", "recycle", "purged")) {
      lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,target,"调整",null);
      if (List.of("offShelf", "selling", "purged").contains(target)) { expectedOperationsLogs++; }
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin'",Long.class))
          .as("运营日志数量：%s", target).isEqualTo(expectedOperationsLogs);
      assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=99202",String.class)).isEqualTo("selling");
      assertThat(jdbc.queryForObject("SELECT price FROM finished_product_guide_prices WHERE finished_product_id=99202",BigDecimal.class)).isEqualByComparingTo("123");
    }
    assertThat(jdbc.queryForList("SELECT operation_type FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='supply-chain' ORDER BY id",String.class))
        .containsExactly("SHELF", "OFF_SHELF", "RESTORE", "SHELF", "OFF_SHELF", "DELETE_TO_RECYCLE", "RESTORE", "SHELF", "OFF_SHELF", "DELETE_TO_RECYCLE", "PURGE");
    assertThat(jdbc.queryForObject("SELECT operation_type FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin' ORDER BY id DESC LIMIT 1",String.class)).isEqualTo("SOURCE_DELETE");
  }

  @Test
  void legacySupplyEventsHaveSpecificTypesAndInternalEventsAreExcludedBeforePagination() {
    for (String target : List.of("selling", "offShelf", "recycle", "purged", "warehouse")) {
      jdbc.update("""
          INSERT INTO finished_operation_logs
            (product_id,product_name,business_client_code,operation_type,operation_summary,operator_name,operated_at,change_details)
          VALUES (99302,'旧供应链日志','admin','SOURCE_SYNC','旧笼统文案','测试人员',NOW(),JSON_OBJECT('来源状态',JSON_OBJECT('before','offShelf','after',?)))
          """, target);
    }
    authenticateDirectService();
    var page = logs.listPage("旧供应链日志",null,null,null,null,1,2);
    assertThat(page.total()).isEqualTo(3);
    assertThat(page.records()).hasSize(2).allMatch(log -> !"SOURCE_SYNC".equals(log.getOperationType()));
    assertThat(logs.listPage("旧供应链日志","SOURCE_SHELF",null,null,null,1,20).total()).isEqualTo(1);
    var offShelf = logs.listPage("旧供应链日志","SOURCE_OFF_SHELF",null,null,null,1,20).records().getFirst();
    assertThat(logs.detail(offShelf.getId()).getOperationType()).isEqualTo("SOURCE_OFF_SHELF");
    assertThat(logs.detail(offShelf.getId()).getOperationSummary()).isEqualTo("供应链已下架该商品");
    var deleted = logs.listPage("旧供应链日志","SOURCE_DELETE",null,null,null,1,20);
    assertThat(deleted.total()).isEqualTo(1);
    assertThat(logs.detail(deleted.records().getFirst().getId()).getOperationSummary()).isEqualTo("供应链已删除该商品");
    for (Long hidden : jdbc.queryForList("SELECT id FROM finished_operation_logs WHERE product_id=99302 AND JSON_UNQUOTE(JSON_EXTRACT(change_details, '$.\"来源状态\".after')) IN ('warehouse','recycle')",Long.class)) {
      org.assertj.core.api.Assertions.assertThatThrownBy(() -> logs.detail(hidden)).isInstanceOf(IllegalArgumentException.class);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99302 AND operation_type='SOURCE_SYNC'",Long.class)).isEqualTo(5);
  }

  @Test
  void hidesOldSourceRecycleLogsWithoutHidingManualOrSupplyChainDeletionLogs() {
    for (String target : List.of("recycle", "purged")) {
      jdbc.update("""
          INSERT INTO finished_operation_logs
            (product_id,product_name,business_client_code,operation_type,operation_summary,operator_name,operated_at,change_details)
          VALUES (99303,'删除日志边界','admin','SOURCE_DELETE','供应链已删除该商品','测试人员',NOW(),JSON_OBJECT('来源状态',JSON_OBJECT('before','offShelf','after',?)))
          """, target);
    }
    for (String client : List.of("admin", "supply-chain")) {
      jdbc.update("""
          INSERT INTO finished_operation_logs
            (product_id,product_name,business_client_code,operation_type,operation_summary,operator_name,operated_at,change_details)
          VALUES (99303,'删除日志边界',?,'DELETE_TO_RECYCLE','删除至回收站','测试人员',NOW(),'{}')
          """, client);
    }
    authenticateDirectService();
    assertThat(logs.listPage("删除日志边界",null,null,null,null,1,1).total()).isEqualTo(2);
    assertThat(logs.listPage("删除日志边界",null,null,null,null,2,1).records()).hasSize(1);
    var deleted = logs.listPage("删除日志边界","SOURCE_DELETE",null,null,null,1,20);
    assertThat(deleted.total()).isEqualTo(1);
    assertThat(logs.detail(deleted.records().getFirst().getId()).getChangeDetails()).contains("purged");
    assertThat(logs.listPage("删除日志边界","DELETE_TO_RECYCLE",null,null,null,1,20).total()).isEqualTo(1);
    Long hidden = jdbc.queryForObject("SELECT MIN(id) FROM finished_operation_logs WHERE product_id=99303",Long.class);
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> logs.detail(hidden)).isInstanceOf(IllegalArgumentException.class);
    var identity = new com.zdm.platform.security.CurrentIdentity(1L,1L,1L,null,"supply-chain",null,null,
        "供应链人员","all",List.of("SUPER_ADMIN"),List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,List.of()));
    var source = logs.listPage("删除日志边界",null,null,null,null,1,20);
    assertThat(source.total()).isEqualTo(1);
    assertThat(logs.detail(source.records().getFirst().getId()).getOperationType()).isEqualTo("DELETE_TO_RECYCLE");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99303",Long.class)).isEqualTo(4);
    // The shared lifecycle service must retain the existing slab logging rules.
    jdbc.update("INSERT INTO slab_inventory (id,name,serial_no,source_status,status,operations_deleted) VALUES (99303,'大板日志边界','slab-log-boundary','offShelf','selling',FALSE)");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB,99303L,"recycle");
    assertThat(jdbc.queryForObject("SELECT operation_type FROM slab_operation_logs WHERE slab_id=99303 AND business_client_code='admin'",String.class)).isEqualTo("SOURCE_SYNC");
  }

  @Test
  void legacyOperationsPurgeKeepsActualPreviousStateAndDisplaysPermanentDeletion() {
    List<String> states = List.of("warehouse", "selling", "offShelf", "soldOut", "recycle");
    for (String previous : states) {
      jdbc.update("""
          INSERT INTO finished_operation_logs
            (product_id,product_name,business_client_code,operation_type,operation_summary,operator_name,operated_at,before_status,after_status,change_details)
          VALUES (99304,'彻底删除状态日志','admin','PURGE','彻底删除运营商品','测试人员',NOW(),?,NULL,'{}')
          """, previous);
    }
    authenticateDirectService();
    var page = logs.listPage("彻底删除状态日志","PURGE",null,null,null,1,20);
    assertThat(page.total()).isEqualTo(5);
    assertThat(page.records()).extracting(FinishedOperationLog::getBeforeStatus).containsExactlyInAnyOrderElementsOf(states);
    for (FinishedOperationLog row : page.records()) {
      assertThat(row.getAfterStatus()).isEqualTo("purged");
      FinishedOperationLog detail = logs.detail(row.getId());
      assertThat(detail.getBeforeStatus()).isEqualTo(row.getBeforeStatus());
      assertThat(detail.getAfterStatus()).isEqualTo("purged");
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99304 AND after_status IS NULL",Long.class)).isEqualTo(5);
  }

  private void updateCoefficient(int value) throws Exception {
    mvc.perform(put("/api/admin/finished-markup-configurations/99101").header("Authorization", token)
        .contentType("application/json").content("{\"storeLevelId\":99101,\"priceCoefficient\":" + value + "}"))
        .andExpect(status().isOk());
  }
  private void setStatus(String value) throws Exception {
    mvc.perform(patch("/api/admin/finished-markup-configurations/99101/status").header("Authorization", token)
        .contentType("application/json").content("{\"status\":\"" + value + "\"}"))
        .andExpect(status().isOk());
  }
  private void assertPrice(String key, String value, String source) {
    FinishedProductPrice row = prices.listPrices(99101L).stream()
        .filter(price -> key.equals(price.getVariantLabel())).findFirst().orElseThrow();
    assertThat(row.getPrice()).isEqualByComparingTo(value);
    assertThat(row.getPriceSource()).isEqualTo(source);
  }
  private void authenticateDirectService() {
    var identity = new com.zdm.platform.security.CurrentIdentity(1L, 1L, 1L, null, "admin", null, null,
        "系统管理员", "all", List.of("SUPER_ADMIN"), List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }

  @org.junit.jupiter.api.AfterEach
  void clearIdentity() {
    org.springframework.security.core.context.SecurityContextHolder.clearContext();
  }
}
