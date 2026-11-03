package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zdm.platform.support.SpringContainerTestSupport;
import java.math.BigDecimal;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class GuidePriceSourceApiTest extends SpringContainerTestSupport {
  @Container static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("guide_source").withUsername("test").withPassword("test");
  @DynamicPropertySource static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }
  @org.junit.jupiter.api.AfterEach
  void clearIdentity() { org.springframework.security.core.context.SecurityContextHolder.clearContext(); }

  private void authenticate(String client) {
    var identity = new com.zdm.platform.security.CurrentIdentity(
        1L,1L,1L,null,client,null,null,"测试人员","all",java.util.List.of("SUPER_ADMIN"),java.util.List.of("all"));
    org.springframework.security.core.context.SecurityContextHolder.getContext().setAuthentication(
        new org.springframework.security.authentication.UsernamePasswordAuthenticationToken(identity,null,java.util.List.of()));
  }
  @Autowired JdbcTemplate jdbc;
  @Autowired FinishedGuidePriceSettingService finishedSettings;
  @Autowired AccessoryGuidePriceSettingService accessorySettings;
  @Autowired GuidePriceConfigurationSyncService sync;
  @Autowired FinishedProductGuidePriceService finished;
  @Autowired AccessoryProductGuidePriceService accessory;
  @Autowired ProductLifecycleService lifecycle;
  @Autowired AccessoryLifecycleService accessoryLifecycle;

  private void seed(String prefix) {
    jdbc.update("INSERT INTO " + prefix + "_products(id,name,sku,source_status,status,operations_deleted) VALUES(998901,'指导价模式测试','guide-source-998901','selling','warehouse',FALSE)");
    for (long id : new long[]{998911,998912,998913}) {
      jdbc.update("INSERT INTO " + prefix + "_product_variants(id," + prefix + "_product_id,variant_label,stock,cost_price) VALUES(?,998901,?,1,10)", id, "规格" + id);
    }
    jdbc.update("INSERT INTO " + prefix + "_product_guide_prices(" + prefix + "_product_id,sku_id,variant_label,price_coefficient,cost_price,price,price_source) VALUES(998901,998911,'跟随规格',2,10,20,'auto'),(998901,998912,'手动规格',3,10,30,'manual')");
    jdbc.update("INSERT INTO " + prefix + "_guide_price_settings(id,price_coefficient) VALUES(1,4) ON DUPLICATE KEY UPDATE price_coefficient=4");
  }

  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  @org.springframework.transaction.annotation.Transactional
  void configurationRefreshesOnlyAutoAndBackfillsMissingWithoutTouchingManual(String prefix) {
    seed(prefix);
    authenticate("admin");
    if (prefix.equals("finished")) finishedSettings.saveSetting(new BigDecimal("4"));
    else accessorySettings.saveSetting(new BigDecimal("4"));
    assertThat(jdbc.queryForObject("SELECT price FROM " + prefix + "_product_guide_prices WHERE sku_id=998911",BigDecimal.class)).isEqualByComparingTo("40");
    assertThat(jdbc.queryForObject("SELECT price FROM " + prefix + "_product_guide_prices WHERE sku_id=998912",BigDecimal.class)).isEqualByComparingTo("30");
    assertThat(jdbc.queryForObject("SELECT price_source FROM " + prefix + "_product_guide_prices WHERE sku_id=998912",String.class)).isEqualTo("manual");
    assertThat(jdbc.queryForObject("SELECT price FROM " + prefix + "_product_guide_prices WHERE sku_id=998913",BigDecimal.class)).isEqualByComparingTo("40");
    assertThat(jdbc.queryForObject("SELECT guide_price FROM " + prefix + "_products WHERE id=998901",BigDecimal.class)).isEqualByComparingTo("40");
    jdbc.update("UPDATE " + prefix + "_products SET operations_deleted=TRUE WHERE id=998901");
    sync.sync(prefix.equals("finished") ? GuidePriceConfigurationSyncService.Commodity.FINISHED : GuidePriceConfigurationSyncService.Commodity.ACCESSORY, new BigDecimal("5"));
    assertThat(jdbc.queryForObject("SELECT price FROM " + prefix + "_product_guide_prices WHERE sku_id=998911",BigDecimal.class)).isEqualByComparingTo("40");
  }

  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  @org.springframework.transaction.annotation.Transactional
  void saveRejectsStaleFollowedCoefficientAtomicallyAndPersistsIndependentModes(String prefix) {
    seed(prefix);
    if (prefix.equals("finished")) {
      var prices = finished.listPrices(998901L);
      assertThatThrownBy(() -> finished.replacePrices(998901L,prices)).hasMessage("跟随配置指导价必须使用当前有效系数");
      assertThat(finished.listPrices(998901L)).hasSize(2);
      prices.getFirst().setPriceCoefficient(new BigDecimal("4")); prices.getFirst().setPrice(new BigDecimal("40"));
      finished.replacePrices(998901L,prices);
      assertThat(finished.listPrices(998901L)).extracting(FinishedProductGuidePrice::getPriceSource).containsExactly("auto","manual");
    } else {
      var prices = accessory.listPrices(998901L);
      assertThatThrownBy(() -> accessory.replacePrices(998901L,prices)).hasMessage("跟随配置指导价必须使用当前有效系数");
      assertThat(accessory.listPrices(998901L)).hasSize(2);
      prices.getFirst().setPriceCoefficient(new BigDecimal("4")); prices.getFirst().setPrice(new BigDecimal("40"));
      accessory.replacePrices(998901L,prices);
      assertThat(accessory.listPrices(998901L)).extracting(AccessoryProductGuidePrice::getPriceSource).containsExactly("auto","manual");
    }
  }

  @ParameterizedTest @ValueSource(strings={"finished","accessory"})
  @org.springframework.transaction.annotation.Transactional
  void costRepricingUsesConfigurationOrPreservesEachManualCoefficientWhenMissing(String prefix) {
    seed(prefix);
    authenticate("supply-chain");
    jdbc.update("UPDATE " + prefix + "_product_variants SET cost_price=20 WHERE " + prefix + "_product_id=998901");
    if (prefix.equals("finished")) lifecycle.reprice(ProductLifecycleService.Kind.FINISHED,998901L,false);
    else accessoryLifecycle.reprice(AccessoryLifecycleService.Kind.ACCESSORY,998901L,false);
    assertThat(jdbc.queryForList("SELECT price_source FROM " + prefix + "_product_guide_prices WHERE " + prefix + "_product_id=998901",String.class)).containsOnly("auto").hasSize(3);
    assertThat(jdbc.queryForList("SELECT price FROM " + prefix + "_product_guide_prices WHERE " + prefix + "_product_id=998901",BigDecimal.class)).allSatisfy(value -> assertThat(value).isEqualByComparingTo("80"));
    jdbc.update("DELETE FROM " + prefix + "_guide_price_settings WHERE id=1");
    jdbc.update("UPDATE " + prefix + "_product_guide_prices SET price_coefficient=3,price=60,price_source='manual' WHERE sku_id=998912");
    jdbc.update("UPDATE " + prefix + "_product_variants SET cost_price=30 WHERE " + prefix + "_product_id=998901");
    if (prefix.equals("finished")) lifecycle.reprice(ProductLifecycleService.Kind.FINISHED,998901L,false);
    else accessoryLifecycle.reprice(AccessoryLifecycleService.Kind.ACCESSORY,998901L,false);
    assertThat(jdbc.queryForObject("SELECT price FROM " + prefix + "_product_guide_prices WHERE sku_id=998912",BigDecimal.class)).isEqualByComparingTo("90");
    assertThat(jdbc.queryForObject("SELECT price_source FROM " + prefix + "_product_guide_prices WHERE sku_id=998912",String.class)).isEqualTo("manual");
  }
}
