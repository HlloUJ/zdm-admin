package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.zdm.platform.support.SpringContainerTestSupport;
import com.zdm.platform.security.TokenAuthenticationFilter;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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
class FinishedPriceSourceApiTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("finished_price_source").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private com.fasterxml.jackson.databind.ObjectMapper json;
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
    assertThat(ProductLifecycleService.sourceBlockMessage("offShelf", null)).isEqualTo("该商品已被供应链下架");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"warehouse");
    assertThat(jdbc.queryForObject("SELECT source_block_reason FROM finished_products WHERE id=99202",String.class))
        .isEqualTo("OFF_SHELF");
    assertThat(ProductLifecycleService.sourceBlockMessage("warehouse", "OFF_SHELF"))
        .isEqualTo("该商品已被供应链下架");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99202L,"selling");
    assertThat(jdbc.queryForObject("SELECT source_block_reason FROM finished_products WHERE id=99202",String.class)).isNull();
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
      if (List.of("offShelf", "selling", "recycle", "purged").contains(target)) { expectedOperationsLogs++; }
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin'",Long.class))
          .as("运营日志数量：%s", target).isEqualTo(expectedOperationsLogs);
      assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=99202",String.class)).isEqualTo("selling");
      assertThat(jdbc.queryForObject("SELECT price FROM finished_product_guide_prices WHERE finished_product_id=99202",BigDecimal.class)).isEqualByComparingTo("123");
    }
    assertThat(jdbc.queryForList("SELECT operation_type FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='supply-chain' ORDER BY id",String.class))
        .containsExactly("SHELF", "OFF_SHELF", "RESTORE", "SHELF", "OFF_SHELF", "DELETE_TO_RECYCLE", "RESTORE", "SHELF", "OFF_SHELF", "DELETE_TO_RECYCLE", "PURGE");
    assertThat(jdbc.queryForObject("SELECT operation_type FROM finished_operation_logs WHERE product_id=99202 AND business_client_code='admin' ORDER BY id DESC LIMIT 1",String.class)).isEqualTo("SOURCE_PURGE");
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
    assertThat(page.total()).isEqualTo(4);
    assertThat(page.records()).hasSize(2).allMatch(log -> !"SOURCE_SYNC".equals(log.getOperationType()));
    assertThat(logs.listPage("旧供应链日志","SOURCE_SHELF",null,null,null,1,20).total()).isEqualTo(1);
    var offShelf = logs.listPage("旧供应链日志","SOURCE_OFF_SHELF",null,null,null,1,20).records().getFirst();
    assertThat(logs.detail(offShelf.getId()).getOperationType()).isEqualTo("SOURCE_OFF_SHELF");
    assertThat(logs.detail(offShelf.getId()).getOperationSummary()).isEqualTo("供应链已下架该商品");
    var deleted = logs.listPage("旧供应链日志","SOURCE_PURGE",null,null,null,1,20);
    assertThat(deleted.total()).isEqualTo(1);
    assertThat(logs.detail(deleted.records().getFirst().getId()).getOperationSummary()).isEqualTo("供应链已彻底删除该商品");
    assertThat(logs.listPage("旧供应链日志","SOURCE_DELETE_TO_RECYCLE",null,null,null,1,20).total()).isEqualTo(1);
    for (Long hidden : jdbc.queryForList("SELECT id FROM finished_operation_logs WHERE product_id=99302 AND JSON_UNQUOTE(JSON_EXTRACT(change_details, '$.\"来源状态\".after')) = 'warehouse'",Long.class)) {
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
    assertThat(logs.listPage("删除日志边界",null,null,null,null,1,1).total()).isEqualTo(3);
    assertThat(logs.listPage("删除日志边界",null,null,null,null,2,1).records()).hasSize(1);
    var deleted = logs.listPage("删除日志边界","SOURCE_PURGE",null,null,null,1,20);
    assertThat(deleted.total()).isEqualTo(1);
    assertThat(logs.detail(deleted.records().getFirst().getId()).getChangeDetails()).contains("purged");
    assertThat(logs.listPage("删除日志边界","DELETE_TO_RECYCLE",null,null,null,1,20).total()).isEqualTo(1);
    var recycled = logs.listPage("删除日志边界","SOURCE_DELETE_TO_RECYCLE",null,null,null,1,20);
    assertThat(recycled.total()).isEqualTo(1);
    assertThat(logs.detail(recycled.records().getFirst().getId()).getOperationSummary()).isEqualTo("供应链已将该商品删除至回收站");
    var identity = new com.zdm.platform.security.CurrentIdentity(1L,1L,1L,null,"supply-chain",null,null,
        "供应链人员","all",List.of("SUPER_ADMIN"),List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,List.of()));
    var source = logs.listPage("删除日志边界",null,null,null,null,1,20);
    assertThat(source.total()).isEqualTo(1);
    assertThat(logs.detail(source.records().getFirst().getId()).getOperationType()).isEqualTo("DELETE_TO_RECYCLE");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99303",Long.class)).isEqualTo(4);
    // Slab source recycle is visible as its own downstream action too.
    jdbc.update("INSERT INTO slab_inventory (id,name,serial_no,source_status,status,operations_deleted) VALUES (99303,'大板日志边界','slab-log-boundary','offShelf','selling',FALSE)");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.SLAB,99303L,"recycle");
    assertThat(jdbc.queryForObject("SELECT operation_type FROM slab_operation_logs WHERE slab_id=99303 AND business_client_code='admin'",String.class)).isEqualTo("SOURCE_DELETE_TO_RECYCLE");
    assertThat(ProductLifecycleService.sourceBlockMessage("recycle", null))
        .isEqualTo("该商品已被供应链删除至回收站");
    assertThat(ProductLifecycleService.sourceBlockMessage("purged", null))
        .isEqualTo("该商品已被供应链彻底删除");
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

  @Test
  @org.springframework.transaction.annotation.Transactional
  void sourceShelfAllowsMissingAndDisabledPartnerConfigurations() {
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,3) ON DUPLICATE KEY UPDATE price_coefficient=3");
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99401,'已配置级别',1),(99402,'未配置级别',2),(99403,'停用配置级别',3)");
    jdbc.update("""
        INSERT INTO finished_markup_configurations (id,name,store_level_id,price_coefficient,status,legacy_seeded,sort_order)
        VALUES (99401,'已配置级别',99401,2,'enabled',false,1),(99403,'停用配置级别',99403,4,'disabled',false,3)
        """);
    jdbc.update("INSERT INTO suppliers (id,name,owner_scope,owner_id) VALUES (99401,'未完整价格上架供应商','platform',0)");
    jdbc.update("INSERT INTO product_categories (id,name,scope) VALUES (99401,'未完整价格上架分类','finished')");
    jdbc.update("""
        INSERT INTO media_assets (id,public_id,storage_key,media_type,mime_type,owner_client_code)
        VALUES (99401,UUID(),'incomplete-price-shelf','image','image/png','supply-chain')
        """);
    jdbc.update("""
        INSERT INTO finished_products
          (id,name,sku,supplier_id,category_id,detail,main_image_media_id,video_media_id,total_stock,
           source_status,status,operations_deleted,created_by_account_id)
        VALUES (99401,'未完整价格上架商品','incomplete-price-shelf',99401,99401,'详情',99401,99401,2,'warehouse','warehouse',TRUE,1)
        """);
    jdbc.update("""
        INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price)
        VALUES (99411,99401,'规格A',1,10),(99412,99401,'规格B',1,20)
        """);
    authenticateSupplyChain();
    jdbc.update("UPDATE finished_product_variants SET cost_price=NULL WHERE id=99411");
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> lifecycle.checkSourceTransition(ProductLifecycleService.Kind.FINISHED,99401L,"selling"))
        .hasMessageContaining("请完善成本价后再上架");
    jdbc.update("UPDATE finished_product_variants SET cost_price=10 WHERE id=99411");
    lifecycle.sourceTransition(ProductLifecycleService.Kind.FINISHED,99401L,"selling");
    assertThat(jdbc.queryForObject("SELECT source_status FROM finished_products WHERE id=99401",String.class)).isEqualTo("selling");
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=99401",String.class)).isEqualTo("warehouse");
    assertThat(jdbc.queryForObject("SELECT operations_deleted FROM finished_products WHERE id=99401",Boolean.class)).isFalse();
    var generated = prices.listPrices(99401L);
    assertThat(generated).hasSize(2).allSatisfy(price -> {
      assertThat(price.getStoreLevelId()).isEqualTo(99401L);
      assertThat(price.getPriceSource()).isEqualTo("auto");
    });
    assertThat(generated.stream().filter(price -> price.getSkuId().equals(99411L)).findFirst().orElseThrow().getPrice()).isEqualByComparingTo("20");
    assertThat(generated.stream().filter(price -> price.getSkuId().equals(99412L)).findFirst().orElseThrow().getPrice()).isEqualByComparingTo("40");
    assertThat(jdbc.queryForList("SELECT price FROM finished_product_guide_prices WHERE finished_product_id=99401 ORDER BY sku_id",BigDecimal.class))
        .containsExactly(new BigDecimal("30.00"),new BigDecimal("60.00"));
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99401 AND business_client_code='admin' AND operation_type='SOURCE_SHELF'",Long.class)).isEqualTo(1);
  }

  @Test
  @org.springframework.transaction.annotation.Transactional
  void missingPartnerConfigurationPreservesEachSkusManualCoefficient() {
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO store_levels (id,name,sort_order) VALUES (99404,'手工定价级别',1)");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,3) ON DUPLICATE KEY UPDATE price_coefficient=3");
    jdbc.update("INSERT INTO finished_products (id,name,sku,source_status,status,operations_deleted) VALUES (99404,'不同SKU手工价格','manual-sku-pricing','selling','warehouse',FALSE)");
    jdbc.update("""
        INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price)
        VALUES (99441,99404,'规格A',1,20),(99442,99404,'规格B',1,30),(99443,99404,'未填写价格规格',1,40)
        """);
    jdbc.update("""
        INSERT INTO finished_product_prices
          (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source)
        VALUES (99404,99441,'规格A',99404,'手工定价级别',1.5,10,15,'manual'),
               (99404,99442,'规格B',99404,'手工定价级别',2.5,10,25,'manual')
        """);
    authenticateSupplyChain();
    lifecycle.reprice(ProductLifecycleService.Kind.FINISHED,99404L,true);
    var repriced = prices.listPrices(99404L);
    assertThat(repriced).hasSize(2).allSatisfy(price -> assertThat(price.getPriceSource()).isEqualTo("manual"));
    var first = repriced.stream().filter(price -> price.getSkuId().equals(99441L)).findFirst().orElseThrow();
    var second = repriced.stream().filter(price -> price.getSkuId().equals(99442L)).findFirst().orElseThrow();
    assertThat(first.getPriceCoefficient()).isEqualByComparingTo("1.5");
    assertThat(first.getPrice()).isEqualByComparingTo("30");
    assertThat(second.getPriceCoefficient()).isEqualByComparingTo("2.5");
    assertThat(second.getPrice()).isEqualByComparingTo("75");
  }

  @Test
  @org.springframework.transaction.annotation.Transactional
  void disabledStoreLevelKeepsHistoricalPriceOutsideCurrentPricing() {
    jdbc.update("UPDATE store_levels SET status='disabled'");
    jdbc.update("INSERT INTO store_levels (id,name,status,sort_order) VALUES (99405,'已停用四级','disabled',1),(99406,'启用级别','enabled',2)");
    jdbc.update("INSERT INTO finished_markup_configurations (id,name,store_level_id,price_coefficient,status,legacy_seeded,sort_order) VALUES (99405,'已停用四级',99405,1.4,'enabled',false,1),(99406,'启用级别',99406,2,'enabled',false,2)");
    jdbc.update("INSERT INTO finished_guide_price_settings (id,price_coefficient) VALUES (1,3) ON DUPLICATE KEY UPDATE price_coefficient=3");
    jdbc.update("INSERT INTO finished_products (id,name,sku,source_status,status,operations_deleted,created_by_account_id) VALUES (99405,'停用级别历史商品','disabled-level-history','selling','warehouse',FALSE,1)");
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99451,99405,'规格A',1,20)");
    jdbc.update("INSERT INTO finished_product_prices (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source,source_configuration_id) VALUES (99405,99451,'规格A',99405,'已停用四级',1.2,10,12,'auto',99405)");

    authenticateSupplyChain();
    lifecycle.reprice(ProductLifecycleService.Kind.FINISHED,99405L,false);
    assertThat(jdbc.queryForObject("SELECT price FROM finished_product_prices WHERE finished_product_id=99405 AND store_level_id=99405",BigDecimal.class))
        .isEqualByComparingTo("12");
    assertThat(jdbc.queryForObject("SELECT price FROM finished_product_prices WHERE finished_product_id=99405 AND store_level_id=99406",BigDecimal.class))
        .isEqualByComparingTo("40");

    FinishedProductPrice current = prices.listPrices(99405L).stream()
        .filter(price -> price.getStoreLevelId().equals(99406L)).findFirst().orElseThrow();
    prices.replacePrices(99405L,List.of(current));
    var variant = new FinishedProductVariant();
    variant.setId(99451L);
    prices.requireCompletePrices(99405L,List.of(variant));
    assertThat(jdbc.queryForObject("SELECT price FROM finished_product_prices WHERE finished_product_id=99405 AND store_level_id=99405",BigDecimal.class))
        .isEqualByComparingTo("12");

    jdbc.update("UPDATE finished_markup_configurations SET price_coefficient=1.8 WHERE id=99405");
    assertThat(sync.refreshAutoPrices(configurations.selectById(99405L))).isZero();
    jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (99452,99405,'规格B',1,30)");
    jdbc.update("INSERT INTO finished_product_guide_prices (finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) VALUES (99405,99452,'规格B',3,30,90)");
    assertThat(sync.backfillMissingPrices(configurations.selectById(99405L))).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_product_prices WHERE finished_product_id=99405 AND store_level_id=99405",Long.class))
        .isEqualTo(1L);
  }

  @ParameterizedTest
  @ValueSource(strings = {"warehouse", "selling", "offShelf"})
  @org.springframework.transaction.annotation.Transactional
  void enablingStoreLevelPersistsMissingPricesAndPreservesManualPricesAndProductStatus(String productStatus) throws Exception {
    long id = 99610L;
    prepareLevelPriceFixture(id, "enabled", productStatus);
    enableStoreLevel(id);
    assertThat(jdbc.queryForList("SELECT price FROM finished_product_prices WHERE finished_product_id=? ORDER BY sku_id",BigDecimal.class,id))
        .usingComparatorForType(BigDecimal::compareTo,BigDecimal.class)
        .containsExactly(new BigDecimal("1600"),new BigDecimal("3600"),new BigDecimal("5400"),BigDecimal.ZERO);
    assertThat(jdbc.queryForList("SELECT price_source FROM finished_product_prices WHERE finished_product_id=? ORDER BY sku_id",String.class,id))
        .containsExactly("manual","auto","auto","auto");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_product_prices WHERE finished_product_id=? AND source_configuration_id=?",Long.class,id,id)).isEqualTo(3);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_product_prices WHERE sku_id=?",Long.class,id+5)).isZero();
    assertThat(jdbc.queryForObject("SELECT status FROM finished_products WHERE id=?",String.class,id)).isEqualTo(productStatus);
    assertThat(jdbc.queryForObject("SELECT source_status FROM finished_products WHERE id=?",String.class,id)).isEqualTo("selling");
    var priceIds = jdbc.queryForList("SELECT id FROM finished_product_prices WHERE finished_product_id=? ORDER BY id",Long.class,id);
    enableStoreLevel(id);
    assertThat(jdbc.queryForList("SELECT id FROM finished_product_prices WHERE finished_product_id=? ORDER BY id",Long.class,id)).isEqualTo(priceIds);
    var response = mvc.perform(get("/api/admin/finished-products/{id}",id).header("Authorization",token))
        .andExpect(status().isOk()).andReturn().getResponse().getContentAsByteArray();
    var detail = json.readTree(response).path("data");
    assertThat(detail.path("markupPrices").size()).isEqualTo(4);
    assertThat(detail.path("markupPrices").get(2).path("price").decimalValue()).isEqualByComparingTo("5400");
    assertThat(detail.path("status").asText()).isEqualTo(productStatus);
  }

  @ParameterizedTest
  @ValueSource(strings = {"missing", "disabled"})
  @org.springframework.transaction.annotation.Transactional
  void enablingStoreLevelWithoutActiveConfigurationLeavesPricesIncomplete(String configurationStatus) throws Exception {
    long id = 99610L;
    prepareLevelPriceFixture(id,configurationStatus,"warehouse");
    enableStoreLevel(id);
    assertThat(jdbc.queryForObject("SELECT status FROM store_levels WHERE id=?",String.class,id)).isEqualTo("enabled");
    assertThat(jdbc.queryForList("SELECT price FROM finished_product_prices WHERE finished_product_id=? ORDER BY sku_id",BigDecimal.class,id))
        .usingComparatorForType(BigDecimal::compareTo,BigDecimal.class).containsExactly(new BigDecimal("1600"),new BigDecimal("2200"));
  }

  @Test
  @org.springframework.transaction.annotation.Transactional
  void enablingStoreLevelSupportsZeroCoefficientWithoutOverwritingManualPrice() throws Exception {
    long id = 99610L;
    prepareLevelPriceFixture(id,"enabled","warehouse");
    jdbc.update("UPDATE finished_markup_configurations SET price_coefficient=0 WHERE id=?",id);
    enableStoreLevel(id);
    assertThat(jdbc.queryForList("SELECT price FROM finished_product_prices WHERE finished_product_id=? ORDER BY sku_id",BigDecimal.class,id))
        .usingComparatorForType(BigDecimal::compareTo,BigDecimal.class)
        .containsExactly(new BigDecimal("1600"),BigDecimal.ZERO,BigDecimal.ZERO,BigDecimal.ZERO);
  }

  @Test
  void failedPriceBackfillRollsBackLevelActivationAndAutoPriceUpdates() throws Exception {
    long id = 99620L;
    prepareLevelPriceFixture(id,"enabled","selling");
    try {
      jdbc.update("UPDATE finished_product_guide_prices SET cost_price=9999999999.99 WHERE sku_id=?",id+3);
      mvc.perform(patch("/api/admin/store-levels/{id}/status",id).header("Authorization",token)
          .contentType("application/json").content("{\"status\":\"enabled\"}"))
          .andExpect(status().isInternalServerError());
      assertThat(jdbc.queryForObject("SELECT status FROM store_levels WHERE id=?",String.class,id)).isEqualTo("disabled");
      assertThat(jdbc.queryForList("SELECT price FROM finished_product_prices WHERE finished_product_id=? ORDER BY sku_id",BigDecimal.class,id))
          .usingComparatorForType(BigDecimal::compareTo,BigDecimal.class).containsExactly(new BigDecimal("1600"),new BigDecimal("2200"));
    } finally {
      jdbc.update("DELETE FROM finished_product_prices WHERE finished_product_id=?",id);
      jdbc.update("DELETE FROM finished_product_guide_prices WHERE finished_product_id=?",id);
      jdbc.update("DELETE FROM finished_product_variants WHERE finished_product_id=?",id);
      jdbc.update("DELETE FROM finished_products WHERE id=?",id);
      jdbc.update("DELETE FROM finished_markup_configurations WHERE id=?",id);
      jdbc.update("DELETE FROM store_levels WHERE id=?",id);
    }
  }

  private void enableStoreLevel(long id) throws Exception {
    mvc.perform(patch("/api/admin/store-levels/{id}/status",id).header("Authorization",token)
        .contentType("application/json").content("{\"status\":\"enabled\"}"))
        .andExpect(status().isOk());
  }

  private void prepareLevelPriceFixture(long id, String configurationStatus, String productStatus) {
    jdbc.update("INSERT INTO store_levels (id,name,status,sort_order,created_by_account_id) VALUES (?, ?,'disabled',1,1)",id,"重新启用价格级别"+id);
    if (!"missing".equals(configurationStatus)) {
      jdbc.update("""
          INSERT INTO finished_markup_configurations (id,name,store_level_id,price_coefficient,status,legacy_seeded,sort_order)
          VALUES (?,'重新启用价格级别',?,1.8,?,FALSE,1)
          """,id,id,configurationStatus);
    }
    jdbc.update("""
        INSERT INTO finished_products (id,name,sku,status,source_status,operations_deleted,created_by_account_id)
        VALUES (?,'级别启用补价商品',?,?,'selling',FALSE,1)
        """,id,"level-price-"+id,productStatus);
    for (int index=1;index<=5;index++) {
      Integer cost = index==5 ? null : index==4 ? 0 : index*1000;
      jdbc.update("INSERT INTO finished_product_variants (id,finished_product_id,variant_label,stock,cost_price) VALUES (?,?,?,1,?)",id+index,id,"规格"+index,cost);
      if (cost != null) {
        jdbc.update("""
            INSERT INTO finished_product_guide_prices (finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price)
            VALUES (?,?,?,2,?,?)
            """,id,id+index,"规格"+index,cost,cost*2);
      }
      if (index<=2) {
        jdbc.update("""
            INSERT INTO finished_product_prices
              (finished_product_id,sku_id,variant_label,store_level_id,store_level_name,price_coefficient,cost_price,price,price_source,source_configuration_id)
            VALUES (?,?,?,?,'重新启用价格级别',?,?,?,?,?)
            """,id,id+index,"规格"+index,id,index==1?1.6:1.1,cost,index==1?1600:2200,index==1 || "missing".equals(configurationStatus)?"manual":"auto",
            index==1 || "missing".equals(configurationStatus) ? null : id);
      }
    }
  }

  private void authenticateSupplyChain() {
    var identity = new com.zdm.platform.security.CurrentIdentity(1L,1L,1L,null,"supply-chain",null,null,
        "供应链人员","all",List.of("SUPER_ADMIN"),List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,List.of()));
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
