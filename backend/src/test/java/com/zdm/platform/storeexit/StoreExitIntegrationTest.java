package com.zdm.platform.storeexit;

import static org.junit.jupiter.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.store.StoreService;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class StoreExitIntegrationTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("store_exit_test").withUsername("test").withPassword("test");
  private static final Path LEDGER = ledgerDirectory();
  private static final Path MEDIA = ledgerDirectory().resolve("media");
  private static final AtomicLong IDS = new AtomicLong(96000);
  @DynamicPropertySource static void properties(DynamicPropertyRegistry properties) {
    properties.add("spring.datasource.url", MYSQL::getJdbcUrl);
    properties.add("spring.datasource.username", MYSQL::getUsername);
    properties.add("spring.datasource.password", MYSQL::getPassword);
    properties.add("zdm.store-exit.ledger-directory", LEDGER::toString);
    properties.add("zdm.media.storage-path", MEDIA::toString);
    properties.add("zdm.media.retry-delay-ms", () -> "3600000");
    properties.add("zdm.store-exit.retry-delay-ms", () -> "3600000");
    properties.add("zdm.store-exit.recovery-initial-delay-ms", () -> "3600000");
  }
  @Autowired private org.springframework.transaction.PlatformTransactionManager transactionManager;
  @Autowired private com.zdm.platform.media.MediaCleanupService mediaCleanup;
  @Autowired private JdbcTemplate jdbc;
  @Autowired private StoreService stores;
  @Autowired private StoreExitCoverage coverage;
  @Autowired private StoreExitCoordinator coordinator;
  @Autowired private StoreExitTaskWorker worker;
  @Autowired private StoreExitMediaFollowup mediaFollowup;
  @Autowired private com.zdm.platform.media.MediaCleanupWorker cleanupWorker;
  @Autowired private com.zdm.platform.security.SecurityAuditService securityAudit;
  @Autowired private StoreExitJournal journal;
  @org.springframework.boot.test.mock.mockito.SpyBean private StoreExitMedia exitMedia;
  @Autowired private ObjectMapper json;
  @Autowired private StoreExitRecoveryState recoveryState;
  @Autowired private StoreExitRecoveryWorker recoveryWorker;
  @Autowired private com.zdm.platform.account.AccountLifecycleService accounts;
  @org.springframework.boot.test.mock.mockito.SpyBean private HistoricIdentifierGuard historicIdentifiers;
  @Autowired private com.zdm.platform.employee.EmployeeInviteService invites;
  @Autowired private com.zdm.platform.tenant.TenantService tenants;
  @Autowired private com.zdm.platform.media.MediaRetentionService retention;

  @BeforeEach void identity() {
    var identity = new CurrentIdentity(null, 1L, 1L, null, "admin", null, null,
        "平台管理", "all", List.of("SUPER_ADMIN"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }
  @AfterEach void clearIdentity() { SecurityContextHolder.clearContext(); org.mockito.Mockito.reset(historicIdentifiers, exitMedia, previewStorage, org.springframework.test.util.AopTestUtils.getUltimateTargetObject(previewReferenceScope)); }

  @Autowired private com.zdm.platform.inventory.ProductStateActivityService finishedActivity;
  @Autowired private com.zdm.platform.inventory.AccessoryStateActivityService accessoryActivity;
  @Autowired private com.zdm.platform.inventory.FinishedSupplyEditAuditService finishedSupply;
  @Autowired private com.zdm.platform.inventory.AccessorySupplyEditAuditService accessorySupply;
  @Autowired private com.zdm.platform.inventory.StoreFinishedSalePriceService finishedPrices;
  @Autowired private com.zdm.platform.inventory.StoreAccessorySalePriceService accessoryPrices;
  @Autowired private com.zdm.platform.media.MediaHistoryService mediaHistory;
  @Autowired private StoreExitTargetService exitTargets;

  @Autowired private com.zdm.platform.inventory.StoreFinishedUpstreamLogService finishedUpstream;
  @Autowired private com.zdm.platform.inventory.StoreAccessoryUpstreamLogService accessoryUpstream;

  @Autowired private com.zdm.platform.media.MediaAssetService previewAssets;
  @Autowired private com.zdm.platform.media.MediaCleanupScheduler previewScheduler;
  @org.springframework.boot.test.mock.mockito.SpyBean private com.zdm.platform.media.MediaPreviewReferenceService previewReferenceScope;
  @org.springframework.boot.test.mock.mockito.SpyBean private com.zdm.platform.media.MediaStorageService previewStorage;

  @Test void previewGenerationOmitsRestoredRetiredStoreAndPreservesSharedHistory() throws Exception {
    long target=restoredRetiredStore(), other=store();
    long retiredParent=previewFollowup(target), liveParent=previewFollowup(other), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",retiredParent,"HISTORY");
    reference(image,"STORE_CUSTOMER_FOLLOWUP",liveParent,"HISTORY");
    reference(image,"FINISHED_PRODUCT_LOG",IDS.incrementAndGet(),"HISTORY");
    generatePreview(image);
    Long preview=previewAssets.getById(image).getHistoryPreviewMediaId();
    assertNotNull(preview);
    assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_id=? AND reference_kind='PREVIEW'",Long.class,retiredParent));
    assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_id=? AND reference_kind='PREVIEW'",Long.class,liveParent));
    assertEquals(2L,retention.count(preview,"PREVIEW"));
    assertEquals(3L,retention.count(image,"HISTORY"));
    assertTrue(previewStorage.load(previewAssets.getById(image).getStorageKey()).exists());
    assertTrue(previewStorage.load(previewAssets.getById(preview).getStorageKey()).exists());
  }

  @Test void retiredPreviewCandidatesDoNotStarveLiveStoreWork() throws Exception {
    long target=restoredRetiredStore(), parent=previewFollowup(target);
    java.util.Set<Long> retired=new java.util.HashSet<>();
    for(int i=0;i<101;i++) {
      long asset=media(target); retired.add(asset);
      jdbc.update("INSERT INTO media_references(media_id,business_domain,business_id,field_key,owner_client_code,reference_kind) VALUES (?,'STORE_CUSTOMER_FOLLOWUP',?,?,'admin','HISTORY')",asset,parent,"retired-"+i);
    }
    long other=store(), liveParent=previewFollowup(other), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",liveParent,"HISTORY");
    var candidates=mediaHistory.pendingPreviews();
    assertTrue(candidates.contains(image));
    assertTrue(candidates.stream().noneMatch(retired::contains));
    long before=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
    generatePreview(retired.iterator().next());
    assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
  }

  @Test void aResolvedPendingStoreBackfillsTheExistingSharedPreview() throws Exception {
    long target=store(), other=store(), parent=previewFollowup(target), liveParent=previewFollowup(other), image=previewImage();
    String operation=java.util.UUID.randomUUID().toString();
    journal.intent(operation,target,1,List.of()); recoveryState.refresh();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",parent,"HISTORY");
    reference(image,"STORE_CUSTOMER_FOLLOWUP",liveParent,"HISTORY");
    try {
      generatePreview(image);
      Long preview=previewAssets.getById(image).getHistoryPreviewMediaId();
      assertNotNull(preview); assertEquals(1L,retention.count(preview,"PREVIEW"));
      assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_id=? AND reference_kind='PREVIEW'",Long.class,parent));
      journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh();
      assertTrue(mediaHistory.pendingPreviews().contains(image));
      long count=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
      generatePreview(image);
      assertEquals(preview,previewAssets.getById(image).getHistoryPreviewMediaId());
      assertEquals(count,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
      assertEquals(2L,retention.count(preview,"PREVIEW"));
    } finally { journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh(); }
  }

  @Test void previewGenerationLocksTheOwningStoreBeforeWritingAnyDerivedFile() throws Exception {
    long owner=store(), parent=previewFollowup(owner), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",parent,"HISTORY");
    var checked=new java.util.concurrent.atomic.AtomicBoolean();
    org.mockito.Mockito.doAnswer(invocation -> {
      try(var connection=java.sql.DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());var statement=connection.prepareStatement("SELECT id FROM stores WHERE id=? FOR UPDATE NOWAIT")) {
        statement.setLong(1,owner);
        java.sql.SQLException locked=assertThrows(java.sql.SQLException.class,statement::executeQuery);
        assertEquals(3572,locked.getErrorCode()); checked.set(true);
      }
      return invocation.callRealMethod();
    }).when(previewStorage).createHistoryPreview(previewAssets.getById(image).getStorageKey());
    generatePreview(image);
    assertTrue(checked.get());
    assertEquals("ready",previewAssets.getById(image).getHistoryPreviewState());
    stores.deleteStore(owner,stores.previewDelete(owner).planHash());
    assertEquals(0,count("media_references","business_id",parent));
  }

  @Test void aDeletedHistoryParentCannotReceivePreviewReferences() throws Exception {
    long image=previewImage(), missingParent=IDS.incrementAndGet();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",missingParent,"HISTORY");
    long before=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
    assertFalse(mediaHistory.pendingPreviews().contains(image));
    generatePreview(image);
    assertNull(previewAssets.getById(image).getHistoryPreviewMediaId());
    assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
    assertEquals(1L,retention.count(image,"HISTORY"));
  }

  @Test void aLateHistoryReferenceIsBackfilledWithoutDuplicatingThePreview() throws Exception {
    long first=previewFollowup(store()), second=previewFollowup(store()), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",first,"HISTORY");
    generatePreview(image);
    Long preview=previewAssets.getById(image).getHistoryPreviewMediaId(); assertNotNull(preview);
    reference(image,"STORE_CUSTOMER_FOLLOWUP",second,"HISTORY");
    assertTrue(mediaHistory.pendingPreviews().contains(image));
    long before=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
    generatePreview(image);
    assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
    assertEquals(preview,previewAssets.getById(image).getHistoryPreviewMediaId());
    assertEquals(2L,retention.count(preview,"PREVIEW"));
    assertFalse(mediaHistory.pendingPreviews().contains(image));
  }

  @Test void aLateHistoryCanReuseThePreviewAfterTheOriginalExpired() throws Exception {
    long first=previewFollowup(store()), second=previewFollowup(store()), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",first,"HISTORY"); generatePreview(image);
    Long preview=previewAssets.getById(image).getHistoryPreviewMediaId(); assertNotNull(preview);
    String original=previewAssets.getById(image).getStorageKey();
    previewStorage.delete(original);
    jdbc.update("UPDATE media_assets SET status='deleted' WHERE id=?",image);
    var since=previewAssets.getById(image).getUnreferencedSince();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",second,"HISTORY");
    assertTrue(mediaHistory.pendingPreviews().contains(image));
    long before=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
    generatePreview(image);
    assertEquals(preview,previewAssets.getById(image).getHistoryPreviewMediaId());
    assertEquals("deleted",previewAssets.getById(image).getStatus());
    assertEquals(since,previewAssets.getById(image).getUnreferencedSince());
    assertFalse(previewStorage.load(original).exists());
    assertTrue(previewStorage.load(previewAssets.getById(preview).getStorageKey()).exists());
    assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
    assertEquals(2L,retention.count(preview,"PREVIEW"));
  }

  @Test void failedBackfillRetriesWithoutDiscardingOrDuplicatingTheExistingPreview() throws Exception {
    long first=previewFollowup(store()), second=previewFollowup(store()), image=previewImage();
    reference(image,"STORE_CUSTOMER_FOLLOWUP",first,"HISTORY"); generatePreview(image);
    Long preview=previewAssets.getById(image).getHistoryPreviewMediaId(); assertNotNull(preview);
    reference(image,"STORE_CUSTOMER_FOLLOWUP",second,"HISTORY");
    long before=jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class);
    String constraint="reject_preview_"+image;
    jdbc.execute("ALTER TABLE media_references ADD CONSTRAINT "+constraint+" CHECK (NOT(media_id="+preview+" AND business_id="+second+" AND reference_kind='PREVIEW'))");
    try {
      generatePreview(image);
      var source=previewAssets.getById(image);
      assertEquals("ready",source.getHistoryPreviewState());
      assertEquals(preview,source.getHistoryPreviewMediaId());
      assertNotNull(source.getHistoryPreviewError());
      assertTrue(mediaHistory.pendingPreviews().contains(image));
      assertEquals(1L,retention.count(preview,"PREVIEW"));
      assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
    } finally { jdbc.execute("ALTER TABLE media_references DROP CHECK "+constraint); }
    generatePreview(image);
    assertEquals(preview,previewAssets.getById(image).getHistoryPreviewMediaId());
    assertNull(previewAssets.getById(image).getHistoryPreviewError());
    assertEquals(2L,retention.count(preview,"PREVIEW"));
    assertEquals(before,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets",Long.class));
  }

  @Test void oneCandidateBecomingFencedDoesNotStopOtherPreviewJobs() throws Exception {
    long blocked=previewImage(), live=previewImage();
    reference(blocked,"STORE_CUSTOMER_FOLLOWUP",previewFollowup(store()),"HISTORY");
    reference(live,"STORE_CUSTOMER_FOLLOWUP",previewFollowup(store()),"HISTORY");
    org.mockito.Mockito.doThrow(new org.springframework.security.access.AccessDeniedException("injected scope change"))
        .when(org.springframework.test.util.AopTestUtils.<com.zdm.platform.media.MediaPreviewReferenceService>getUltimateTargetObject(previewReferenceScope)).lockHistoryReferences(blocked);
    previewScheduler.retryFailedCleanup();
    IDS.accumulateAndGet(jdbc.queryForObject("SELECT MAX(id) FROM media_assets",Long.class),Math::max);
    assertNull(previewAssets.getById(blocked).getHistoryPreviewMediaId());
    assertEquals(1L,retention.count(blocked,"HISTORY"));
    assertEquals("ready",previewAssets.getById(live).getHistoryPreviewState());
    assertNotNull(previewAssets.getById(live).getHistoryPreviewMediaId());
  }

  @Test void previewProtectionCoversEveryRegisteredStoreMediaDomain() throws Exception {
    long target=restoredRetiredStore(),other=store();
    var parents=new java.util.LinkedHashMap<String,List<Long>>();
    parents.put("STORE_CUSTOMER_FOLLOWUP",List.of(previewFollowup(target),previewFollowup(other)));
    for(String kind:List.of("finished","accessory")) {
      long product=supplyListings(kind,target,other);
      parents.put("STORE_"+kind.toUpperCase(java.util.Locale.ROOT)+"_INVALIDATION",List.of(target,other));
      List<Long> logs=new java.util.ArrayList<>();
      for(long owner:List.of(target,other)) {
        long log=IDS.incrementAndGet();logs.add(log);
        jdbc.update("INSERT INTO store_"+kind+"_operation_logs(id,tenant_id,store_id,listing_id,"+kind+"_product_id,product_name,operation_type,operation_summary,operator_name) VALUES (?,1,?,?,?,'预览范围商品','UPDATE','预览范围测试','平台')",log,owner,owner,product);
      }
      parents.put("STORE_"+kind.toUpperCase(java.util.Locale.ROOT)+"_PRODUCT_LOG",logs);
    }
    assertEquals(StoreExitMediaDomains.PARENTS.keySet(),parents.keySet());
    for(var entry:parents.entrySet()) {
      long image=previewImage();
      reference(image,entry.getKey(),entry.getValue().get(0),"HISTORY");
      reference(image,entry.getKey(),entry.getValue().get(1),"HISTORY");
      generatePreview(image);
      Long preview=previewAssets.getById(image).getHistoryPreviewMediaId();assertNotNull(preview);
      assertEquals(1L,retention.count(preview,"PREVIEW"),entry.getKey());
      assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND business_id=? AND reference_kind='PREVIEW'",Long.class,entry.getKey(),entry.getValue().get(0)),entry.getKey());
      assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND business_id=? AND reference_kind='PREVIEW'",Long.class,entry.getKey(),entry.getValue().get(1)),entry.getKey());
    }
  }

  private long previewFollowup(long store) {
    long customer=IDS.incrementAndGet(),followup=IDS.incrementAndGet();
    jdbc.update("INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id) VALUES (?,1,?,'预览隔离客户','','',1)",customer,store);
    jdbc.update("INSERT INTO store_customer_followups(id,customer_id,followed_at,content) VALUES (?,?,CURRENT_TIMESTAMP,'预览隔离记录')",followup,customer);
    return followup;
  }
  private long previewImage() throws Exception {
    var bytes=new java.io.ByteArrayOutputStream();
    javax.imageio.ImageIO.write(new java.awt.image.BufferedImage(32,24,java.awt.image.BufferedImage.TYPE_INT_RGB),"png",bytes);
    long id=previewAssets.upload(new org.springframework.mock.web.MockMultipartFile("file","exit-preview.png","image/png",bytes.toByteArray()),com.zdm.platform.media.MediaStorageService.defaultImageSizeLimit()).id();
    IDS.accumulateAndGet(id,Math::max);
    jdbc.update("UPDATE media_assets SET status='active',unreferenced_since=CURRENT_TIMESTAMP WHERE id=?",id);
    return id;
  }
  private void generatePreview(long image) {
    mediaHistory.generatePreview(image);
    IDS.accumulateAndGet(jdbc.queryForObject("SELECT MAX(id) FROM media_assets",Long.class),Math::max);
  }

  @Test void upstreamStateChangesCannotRecreateRetiredStoresLogsOrInvalidationSnapshots() {
    long target=restoredRetiredStore(); long other=store();
    for (boolean accessory:List.of(false,true)) {
      String kind=accessory ? "accessory" : "finished";
      long source=supplyListings(kind,target,other);
      if (accessory) {
        accessoryUpstream.sourceChange(source,"selling","offShelf");
        accessoryUpstream.operationsChange(source,"DELETE_TO_RECYCLE","selling","recycle");
      } else {
        finishedUpstream.sourceChange(source,"selling","offShelf");
        finishedUpstream.operationsChange(source,"DELETE_TO_RECYCLE","selling","recycle");
      }
      assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM store_"+kind+"_operation_logs WHERE store_id=?",Long.class,target));
      assertEquals(2L,jdbc.queryForObject("SELECT COUNT(*) FROM store_"+kind+"_operation_logs WHERE store_id=?",Long.class,other));
      assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM store_"+kind+"_products WHERE store_id=? AND invalidated_at IS NOT NULL",Long.class,target));
      assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM store_"+kind+"_products WHERE store_id=? AND invalidated_at IS NOT NULL",Long.class,other));
      assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM "+kind+"_products WHERE id=?",Long.class,source));
    }
  }

  @Test void restoredRetiredStoresDoNotReceiveStockFanoutButOtherStoresStillDo() {
    long target = restoredRetiredStore(); long other = store();
    for (boolean accessory : List.of(false, true)) {
      String kind = accessory ? "accessory" : "finished";
      long source = supplyListings(kind, target, other);
      var activity = accessory ? accessoryActivity : null;
      new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
        jdbc.update("UPDATE " + kind + "_products SET total_stock=0 WHERE id=?", source);
        if (activity != null) { activity.storeStockChanged(source, 2, 0); }
        else { finishedActivity.storeStockChanged(source, 2, 0); }
      });
      assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM store_" + kind + "_operation_logs WHERE store_id=? AND " + kind + "_product_id=?", Long.class, target, source));
      assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM store_" + kind + "_operation_logs WHERE store_id=? AND " + kind + "_product_id=? AND operation_type='SOLD_OUT'", Long.class, other, source));
      assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM product_state_activity WHERE kind=? AND business_client_code='store' AND record_id=?", Long.class, "store-" + kind, target));
      assertEquals("soldOut", jdbc.queryForObject("SELECT state FROM product_state_activity WHERE kind=? AND business_client_code='store' AND record_id=?", String.class, "store-" + kind, other));
      assertEquals(0, jdbc.queryForObject("SELECT total_stock FROM " + kind + "_products WHERE id=?", Integer.class, source));
      assertEquals(1, count("store_" + kind + "_products", "id", target));
      assertThrows(org.springframework.security.access.AccessDeniedException.class, () ->
          new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            if (accessory) { accessoryPrices.synchronizeSupplyEdit(target, json.createObjectNode(), 1L, java.time.LocalDateTime.now()); }
            else { finishedPrices.synchronizeSupplyEdit(target, json.createObjectNode(), 1L, java.time.LocalDateTime.now()); }
          }));
    }
  }

  @Test void supplyEditFanoutKeepsRestoredRetiredStoresFrozenAndUpdatesNormalStores() {
    long target = restoredRetiredStore(); long other = store();
    for (boolean accessory : List.of(false, true)) {
      String kind = accessory ? "accessory" : "finished";
      long source = supplyListings(kind, target, other);
      java.util.Map<String,Object> before = new java.util.LinkedHashMap<>();
      before.put("商品名称", "原商品"); before.put("总库存", 2);
      for (String field : List.of("媒体", "销售规格", "层级价格", "指导价")) { before.put(field, List.of()); }
      var after = new java.util.LinkedHashMap<>(before); after.put("商品名称", "更新商品"); after.put("总库存", 3);
      Object audit = accessory ? accessorySupply : finishedSupply;
      Object product;
      if (accessory) {
        var item = new com.zdm.platform.inventory.AccessoryProduct(); item.setId(source); item.setName("更新商品"); item.setSourceStatus("selling"); product=item;
      } else {
        var item = new com.zdm.platform.inventory.FinishedProduct(); item.setId(source); item.setName("更新商品"); item.setSourceStatus("selling"); product=item;
      }
      new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
        Object prepared = org.springframework.test.util.ReflectionTestUtils.invokeMethod(audit, "prepare", product, before);
        jdbc.update("UPDATE " + kind + "_products SET name='更新商品',total_stock=3 WHERE id=?", source);
        org.springframework.test.util.ReflectionTestUtils.invokeMethod(audit, "record", product, prepared, after);
      });
      assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM store_" + kind + "_operation_logs WHERE store_id=? AND " + kind + "_product_id=?", Long.class, target, source));
      assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM store_" + kind + "_operation_logs WHERE store_id=? AND " + kind + "_product_id=? AND operation_type='SOURCE_UPDATE'", Long.class, other, source));
      assertEquals(2, count(kind + "_operation_logs", "product_id", source));
      assertEquals("更新商品", jdbc.queryForObject("SELECT name FROM " + kind + "_products WHERE id=?", String.class, source));
      assertEquals(1, count("store_" + kind + "_products", "id", target));
    }
  }

  @Test void anUndecidedTargetBlocksTheRelatedSourceTransactionWithoutSkippingALiveStoresUpdate() {
    long target=store(); long other=store(); long source=supplyListings("finished", target, other);
    String operation=java.util.UUID.randomUUID().toString();
    journal.intent(operation, target, 1, List.of()); recoveryState.refresh();
    try {
      assertThrows(org.springframework.security.access.AccessDeniedException.class, () ->
          new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            jdbc.update("UPDATE finished_products SET total_stock=0 WHERE id=?",source);
            finishedActivity.storeStockChanged(source,2,0);
          }));
      assertEquals(2,jdbc.queryForObject("SELECT total_stock FROM finished_products WHERE id=?",Integer.class,source));
      assertEquals(0,count("store_finished_operation_logs","finished_product_id",source));
      assertEquals(1,count("store_finished_products","id",target));
      assertEquals(1,count("store_finished_products","id",other));
    } finally { journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh(); }
  }

  @Test void restoredStoreCannotRegainFollowupMediaThroughAnInternalWriter() {
    long target=restoredRetiredStore(); long customer=IDS.incrementAndGet(); long followup=IDS.incrementAndGet(); long asset=media(store());
    jdbc.update("INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id) VALUES (?,1,?,'旧备份客户','','',1)",customer,target);
    jdbc.update("INSERT INTO store_customer_followups(id,customer_id,followed_at,content) VALUES (?,?,CURRENT_TIMESTAMP,'旧备份跟进')",followup,customer);
    assertThrows(IllegalArgumentException.class, () -> mediaHistory.retain("STORE_CUSTOMER_FOLLOWUP",followup,java.util.Map.of("image",asset)));
    assertEquals(0,count("media_references","business_id",followup));
    assertEquals(1,count("media_assets","id",asset));
    assertEquals(1,count("store_customer_followups","id",followup));
  }

  private long restoredRetiredStore() {
    long id=store(); stores.deleteStore(id,stores.previewDelete(id).planHash());
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'恢复待核验门店','cityPartner','enabled',1)",id);
    return id;
  }

  private long supplyListings(String kind,long target,long other) {
    long source=IDS.incrementAndGet();
    jdbc.update("INSERT INTO " + kind + "_products(id,name,sku,status,source_status,total_stock) VALUES (?,'原商品',?,'selling','selling',2)",source,"fanout-"+source);
    for(long store:List.of(target,other)) {
      jdbc.update("INSERT INTO store_" + kind + "_products(id,tenant_id,store_id," + kind + "_product_id,selected_by_account_id,status) VALUES (?,1,?,?,1,'selling')",store,store,source);
    }
    return source;
  }

  @Test void aTargetWriterHoldsTheStoreRootUntilCommitAndRequiresATransaction() throws Exception {
    long target=store(); long other=store(); long source=supplyListings("finished",target,other);
    assertThrows(org.springframework.transaction.IllegalTransactionStateException.class,()->exitTargets.lockStore(target));
    var locked=new java.util.concurrent.CountDownLatch(1);
    var release=new java.util.concurrent.CountDownLatch(1);
    var executor=java.util.concurrent.Executors.newSingleThreadExecutor();
    var writer=executor.submit(()->new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status->{
      assertTrue(exitTargets.lockStore(target)); locked.countDown();
      try { if(!release.await(5,java.util.concurrent.TimeUnit.SECONDS))throw new IllegalStateException("target lock test release missing"); }
      catch(InterruptedException error){Thread.currentThread().interrupt();throw new IllegalStateException(error);}
      jdbc.update("UPDATE finished_products SET total_stock=0 WHERE id=?",source);
      finishedActivity.storeStockChanged(source,2,0);
    }));
    try {
      assertTrue(locked.await(5,java.util.concurrent.TimeUnit.SECONDS));
      var failure=assertThrows(org.springframework.dao.DataAccessException.class,()->jdbc.queryForList("SELECT id FROM stores WHERE id=? FOR UPDATE NOWAIT",target));
      var sql=assertInstanceOf(java.sql.SQLException.class,failure.getMostSpecificCause()); assertEquals(3572,sql.getErrorCode());
    } finally { release.countDown();try{writer.get(5,java.util.concurrent.TimeUnit.SECONDS);}finally{executor.shutdownNow();} }
    stores.deleteStore(target,stores.previewDelete(target).planHash());
    assertEquals(0,count("store_finished_products","store_id",target));
    assertEquals(0,count("store_finished_operation_logs","store_id",target));
    assertEquals(1,count("finished_products","id",source));
    assertEquals(1,count("store_finished_products","store_id",other));
  }

  @Test void freshMigrationsHaveCompleteRuntimeCoverage() {
    assertEquals(64, coverage.verify().length());
  }

  @Test void allCustomerStatesAndPaymentHistoryAreRemovedWithoutTouchingAnotherStore() {
    long target = store(); long other = store();
    for (long id : List.of(target, other)) {
      jdbc.update("INSERT INTO store_payment_names(id,tenant_id,store_id,name,deleted_at) VALUES (?,1,?,'旧定金',CURRENT_TIMESTAMP)", id, id);
      jdbc.update("INSERT INTO store_payment_name_events(tenant_id,store_id,payment_name_id,action,operator_name) VALUES (1,?,?,'create','操作人')", id, id);
      jdbc.update("""
          INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id,status)
          VALUES (?,1,?,'客户','','',1,'archived')
          """, id, id);
      jdbc.update("INSERT INTO store_customer_followups(customer_id,followed_at,content) VALUES (?,CURRENT_TIMESTAMP,'历史跟进')", id);
    }
    var preview = stores.previewDelete(target);
    assertTrue(preview.eligible(), preview.blockers().toString());
    assertEquals(1L, preview.counts().get("store_payment_name_events"));
    assertEquals("CLEARED", stores.deleteStore(target, preview.planHash()).databaseStatus());
    assertEquals(0, count("stores", "id", target));
    assertEquals(0, count("store_customers", "store_id", target));
    assertEquals(0, count("store_customer_followups", "customer_id", target));
    assertEquals(0, count("store_payment_names", "store_id", target));
    assertEquals(0, count("store_payment_name_events", "store_id", target));
    assertEquals(1, count("stores", "id", other));
    assertEquals(1, count("store_customers", "store_id", other));
    assertEquals(1, count("store_payment_name_events", "store_id", other));
    assertEquals(1, count("store_exit_operations", "store_id", target));
    assertTrue(journal.entries().stream().anyMatch(e -> e.storeId() == target && "COMMITTED".equals(e.stage())));
    worker.run();
    assertEquals("COMPLETE", jdbc.queryForObject("SELECT status FROM store_exit_operations WHERE store_id=?", String.class, target));
  }

  @Test void changedPlanAndUnknownSchemaBlockBeforeAnyBusinessDeletion() {
    long target = store(); var preview = stores.previewDelete(target);
    jdbc.update("INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES(1,?,'新定金')", target);
    assertThrows(IllegalArgumentException.class, () -> stores.deleteStore(target, preview.planHash()));
    assertEquals(1, count("stores", "id", target));
    assertEquals(1, count("store_payment_names", "store_id", target));
    jdbc.execute("CREATE TABLE uncovered_exit_module(id BIGINT PRIMARY KEY, store_id BIGINT)");
    try {
      assertFalse(stores.previewDelete(target).eligible());
      assertThrows(IllegalArgumentException.class, () -> stores.deleteStore(target, preview.planHash()));
      assertEquals(1, count("store_payment_names", "store_id", target));
    } finally { jdbc.execute("DROP TABLE uncovered_exit_module"); }
  }

  @Test void failureRollsBackAllModulesButKeepsIndependentFailureEvidence() {
    long target = store();
    jdbc.update("INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES(1,?,'定金')", target);
    var preview = stores.previewDelete(target);
    org.mockito.Mockito.doThrow(new IllegalStateException("injected exit verification failure"))
        .when(exitMedia).verify(org.mockito.ArgumentMatchers.any(StoreExitScope.class));
    try {
      assertThrows(RuntimeException.class, () -> stores.deleteStore(target, preview.planHash()));
      assertEquals(1, count("stores", "id", target));
      assertEquals(1, count("store_payment_names", "store_id", target));
      assertEquals(0, count("store_exit_operations", "store_id", target));
      assertEquals(1, count("store_exit_events", "store_id", target));
      assertTrue(journal.entries().stream().anyMatch(e -> e.storeId() == target && "ROLLED_BACK".equals(e.stage())));
      var intent = journal.entries().stream().filter(e -> e.storeId() == target && "INTENT".equals(e.stage())).findFirst().orElseThrow();
      assertEquals("1", intent.receipt().get("operatorAccountId"));
      assertEquals("平台管理", intent.receipt().get("operatorName"));
      assertDoesNotThrow(() -> java.time.Instant.parse(String.valueOf(intent.receipt().get("acceptedAt"))));
    } finally { org.mockito.Mockito.reset(historicIdentifiers, exitMedia, previewStorage, org.springframework.test.util.AopTestUtils.getUltimateTargetObject(previewReferenceScope)); }
  }

  @Test void lateWriterCannotRecreateDataAfterStoreDeletion() {
    long target = store(); var preview = stores.previewDelete(target);
    stores.deleteStore(target, preview.planHash());
    assertThrows(RuntimeException.class, () -> jdbc.update(
        "INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES(1,?,'迟到款项')", target));
    assertEquals(0, count("store_payment_names", "store_id", target));
  }

  @Test void missingIndependentStorageNeverFallsBackToOnlyTheDatabase() {
    var unavailable = new StoreExitJournal("", json);
    assertThrows(IllegalStateException.class, unavailable::requireReady);
  }

  @Test void sharedDisabledIdentityKeepsTheAccountAndItsPhone() {
    long target = store(); long other = store(); long account = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'共享人员')", account, "139" + String.format("%08d", account));
    bind(account, target, "enabled"); bind(account, other, "disabled");
    var before = stores.previewDelete(target);
    stores.deleteStore(target, before.planHash());
    assertEquals(1, count("accounts", "id", account));
    assertEquals(1, count("account_identities", "store_id", other));
    String phone = jdbc.queryForObject("SELECT phone FROM accounts WHERE id=?", String.class, account);
    assertNotNull(phone);
    assertEquals(account, accounts.findOrCreate(phone, "共享账号仍有效").id());
  }

  @Test void salePriceOnlyAccountsHaveMatchingPreviewAndDeletionForBothProductKinds() {
    for (String kind : List.of("finished", "accessory")) {
      long target = store(), other = store(), account = IDS.incrementAndGet();
      String phone = "139" + String.format("%08d", account);
      jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'本店售价维护人')", account, phone);
      bind(account, target, "enabled");
      long sku = salePriceFixture(kind, target, other, account, false);
      var preview = stores.previewDelete(target);
      assertTrue(preview.eligible(), preview.blockers().toString());
      assertEquals(1L, preview.counts().get("accounts_delete"), kind);
      assertEquals(0L, preview.counts().get("accounts_retained"), kind);
      assertEquals(1L, preview.counts().get("phones_released"), kind);
      assertEquals("CLEARED", stores.deleteStore(target, preview.planHash()).databaseStatus());
      assertEquals(0, count("accounts", "id", account));
      assertEquals(0, count("store_" + kind + "_sale_prices", "listing_id", target));
      assertEquals(1, count("store_" + kind + "_products", "store_id", other));
      assertEquals(1, count(kind + "_product_variants", "id", sku));
      assertNotEquals(account, accounts.findOrCreate(phone, "重新注册").id());
    }
  }

  @Test void salePriceReferenceInAnotherStoreKeepsAccountAndPhoneInPreviewAndExecution() {
    for (String kind : List.of("finished", "accessory")) {
      long target = store(), other = store(), account = IDS.incrementAndGet();
      String phone = "139" + String.format("%08d", account);
      jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'跨店售价维护人')", account, phone);
      bind(account, target, "enabled");
      // No membership in the other store: its live price reference must itself protect the account.
      salePriceFixture(kind, target, other, account, true);
      var preview = stores.previewDelete(target);
      assertTrue(preview.eligible(), preview.blockers().toString());
      assertEquals(0L, preview.counts().get("accounts_delete"), kind);
      assertEquals(1L, preview.counts().get("accounts_retained"), kind);
      assertEquals(0L, preview.counts().get("phones_released"), kind);
      assertEquals("CLEARED", stores.deleteStore(target, preview.planHash()).databaseStatus());
      assertEquals(1, count("accounts", "id", account));
      assertEquals(phone, jdbc.queryForObject("SELECT phone FROM accounts WHERE id=?", String.class, account));
      assertEquals(1, count("store_" + kind + "_sale_prices", "listing_id", other));
      assertEquals(0, new java.math.BigDecimal("100").compareTo(jdbc.queryForObject("SELECT sale_price FROM store_"
          + kind + "_sale_prices WHERE listing_id=?", java.math.BigDecimal.class, other)));
      assertEquals("manual", jdbc.queryForObject("SELECT price_mode FROM store_" + kind
          + "_sale_prices WHERE listing_id=?", String.class, other));
      assertEquals(account, jdbc.queryForObject("SELECT updated_by_account_id FROM store_" + kind
          + "_sale_prices WHERE listing_id=?", Long.class, other));
    }
  }

  @Test void sequentialStoreDeletionReevaluatesTheLastSalePriceOnlyAccount() {
    var expectedOutcomes = new java.util.ArrayList<org.junit.jupiter.api.function.Executable>();
    for (String kind : List.of("finished", "accessory")) {
      long first = store(), second = store(), untouched = store(), account = IDS.incrementAndGet();
      String phone = "139" + String.format("%08d", account);
      jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'隔离顺序删除复现')", account, phone);
      bind(account, first, "enabled");
      long sku = salePriceFixture(kind, first, second, account, true);
      var firstPlan = stores.previewDelete(first);
      assertTrue(firstPlan.eligible(), firstPlan.blockers().toString());
      assertEquals(1L, firstPlan.counts().get("accounts_retained"));
      assertEquals("CLEARED", stores.deleteStore(first, firstPlan.planHash()).databaseStatus());
      assertEquals(1, count("accounts", "id", account));
      assertEquals(phone, jdbc.queryForObject("SELECT phone FROM accounts WHERE id=?", String.class, account));
      assertEquals(0, count("account_identities", "account_id", account));
      assertEquals(0, count("employees", "account_id", account));
      assertEquals(0, count("account_roles", "account_id", account));
      assertEquals(1, count("store_" + kind + "_sale_prices", "listing_id", second));
      var secondPlan = stores.previewDelete(second);
      assertTrue(secondPlan.eligible(), secondPlan.blockers().toString());
      assertEquals("CLEARED", stores.deleteStore(second, secondPlan.planHash()).databaseStatus());
      assertEquals(0, count("stores", "id", first));
      assertEquals(0, count("stores", "id", second));
      assertEquals(0, count("store_" + kind + "_sale_prices", "listing_id", second));
      assertEquals(1, count("stores", "id", untouched));
      assertEquals(1, count(kind + "_product_variants", "id", sku));
      // Read-only policy oracle: no live reference remains; do not call a cleanup method here.
      var disposition = new org.springframework.transaction.support.TransactionTemplate(transactionManager)
          .execute(status -> accounts.assessForExit(account, java.util.Set.of(), null));
      assertEquals(com.zdm.platform.account.AccountLifecycleService.Disposition.DELETE, disposition);
      int retained = count("accounts", "id", account);
      int retainedPhone = jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=? AND phone=?", Integer.class, account, phone);
      System.out.println("SEQUENTIAL_EXIT_REPRO kind=" + kind + " A_retained=" + firstPlan.counts().get("accounts_retained")
          + " B_preview_delete=" + secondPlan.counts().get("accounts_delete") + " B_preview_retained="
          + secondPlan.counts().get("accounts_retained") + " final_account=" + retained
          + " final_phone=" + retainedPhone + " remaining_policy=" + disposition + " other_store_preserved=true sku_preserved=true");
      expectedOutcomes.add(() -> assertEquals(1L, secondPlan.counts().get("accounts_delete"), kind + " B preview"));
      expectedOutcomes.add(() -> assertEquals(0, retained, kind + " final account"));
      expectedOutcomes.add(() -> assertEquals(0, retainedPhone, kind + " final phone"));
    }
    assertAll("Sequential exit must close the final live account reference", expectedOutcomes);
  }

  @Test void sequentialExitKeepsAThirdStoresReferenceAndNeverSweepsUnrelatedAccounts() {
    for (String kind : List.of("finished", "accessory")) {
      long first = store(), second = store(), third = store(), account = IDS.incrementAndGet(), unrelated = IDS.incrementAndGet();
      String phone = "139" + String.format("%08d", account);
      jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'第三店仍在使用')", account, phone);
      jdbc.update("INSERT INTO accounts(id,display_name) VALUES (?,'无关孤立账号')", unrelated);
      bind(account, first, "enabled");
      long sku = salePriceFixture(kind, first, second, account, true);
      long source = jdbc.queryForObject("SELECT " + kind + "_product_id FROM " + kind + "_product_variants WHERE id=?", Long.class, sku);
      jdbc.update("INSERT INTO store_" + kind + "_products(id,tenant_id,store_id," + kind
          + "_product_id,selected_by_account_id,status) VALUES (?,1,?,?,1,'selling')", third, third, source);
      jdbc.update("INSERT INTO store_" + kind + "_sale_prices(listing_id,sku_id,sale_price,price_mode,updated_by_account_id)"
          + " VALUES (?,?,100,'manual',?)", third, sku, account);
      stores.deleteStore(first, stores.previewDelete(first).planHash());
      var preview = stores.previewDelete(second);
      assertEquals(0L, preview.counts().get("accounts_delete"));
      assertEquals(0L, preview.counts().get("accounts_retained"));
      stores.deleteStore(second, preview.planHash());
      assertEquals(phone, jdbc.queryForObject("SELECT phone FROM accounts WHERE id=?", String.class, account));
      assertEquals(1, count("accounts", "id", unrelated));
      assertEquals(1, count("store_" + kind + "_sale_prices", "listing_id", third));
      assertEquals(1, count(kind + "_product_variants", "id", sku));
      assertEquals(1, count("accounts", "id", 1));
    }
  }

  @Test void liveCustomerOwnerIsCollectedButPureHistoricalActorIsNot() {
    long target = store(), owner = IDS.incrementAndGet(), history = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,display_name) VALUES (?,'客户负责人'),(?,'仅历史操作者')", owner, history);
    jdbc.update("INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id,status)"
        + " VALUES (?,1,?,'隔离客户','','',?,'archived')", target, target, owner);
    jdbc.update("INSERT INTO security_audit_logs(account_id,request_method,request_path,result_status,result)"
        + " VALUES (?,'POST','/api/admin/test',200,'success')", history);
    var preview = stores.previewDelete(target);
    assertEquals(1L, preview.counts().get("accounts_delete"));
    assertEquals(0L, preview.counts().get("accounts_retained"));
    stores.deleteStore(target, preview.planHash());
    assertEquals(0, count("accounts", "id", owner));
    assertEquals(1, count("accounts", "id", history));
    assertEquals(1, count("security_audit_logs", "account_id", history));
    assertEquals(1, count("accounts", "id", 1));
  }

  @Test void tenantExitCollectsPriceOnlyAccountsAfterTheirOriginalStoreExited() {
    var tenant = policyTenant();
    long tenantId = tenant.getId(), first = store(), second = store(tenantId), account = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'仅剩另一租户售价引用')", account, "139" + String.format("%08d", account));
    bind(account, first, "enabled");
    salePriceFixture("finished", first, second, account, true);
    jdbc.update("UPDATE store_finished_products SET tenant_id=? WHERE store_id=?", tenantId, second);
    stores.deleteStore(first, stores.previewDelete(first).planHash());
    assertEquals(1, count("accounts", "id", account));
    tenants.updateStatus(tenantId, "disabled");
    var preview = tenants.getPurgePreview(tenantId);
    assertTrue(preview.eligible(), preview.blockers().toString());
    assertTrue(preview.accountDeleteCount() > 0);
    var result = tenants.purgeTenant(tenantId, preview.tenantName(), preview.storePlans());
    assertEquals(preview.accountDeleteCount(), result.accountDeleteCount());
    assertEquals(preview.accountRetainCount(), result.accountRetainCount());
    assertEquals(preview.phoneReleaseCount(), result.phoneReleaseCount());
    assertEquals(0, count("accounts", "id", account));
  }

  @Test void rollbackPreservesAReferenceOnlyAccountAndItsPhone() {
    long target = store(), owner = IDS.incrementAndGet();
    String phone = "139" + String.format("%08d", owner);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'回滚引用账号')", owner, phone);
    jdbc.update("INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id,status)"
        + " VALUES (?,1,?,'回滚客户','','',?,'archived')", target, target, owner);
    var preview = stores.previewDelete(target);
    assertEquals(1L, preview.counts().get("accounts_delete"));
    org.mockito.Mockito.doThrow(new IllegalStateException("injected reference candidate rollback"))
        .when(exitMedia).verify(org.mockito.ArgumentMatchers.any(StoreExitScope.class));
    assertThrows(RuntimeException.class, () -> stores.deleteStore(target, preview.planHash()));
    assertEquals(1, count("stores", "id", target));
    assertEquals(1, count("store_customers", "store_id", target));
    assertEquals(phone, jdbc.queryForObject("SELECT phone FROM accounts WHERE id=?", String.class, owner));
    assertEquals(0, count("store_exit_operations", "store_id", target));
  }

  @Test void committedReceiptRecleansOlderBackupAccountWithoutRestoredBusinessRows() {
    long first = store(), second = store(), account = IDS.incrementAndGet();
    String phone = "139" + String.format("%08d", account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'恢复引用账号')", account, phone);
    bind(account, first, "enabled");
    salePriceFixture("accessory", first, second, account, true);
    stores.deleteStore(first, stores.previewDelete(first).planHash());
    var preview = stores.previewDelete(second);
    stores.deleteStore(second, preview.planHash());
    assertEquals(0, count("accounts", "id", account));
    assertEquals("CLEARED", stores.deleteStore(second, preview.planHash()).databaseStatus());
    var entry = journal.entries().stream().filter(e -> e.storeId() == second && "COMMITTED".equals(e.stage())).findFirst().orElseThrow();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'恢复出的旧账号')", account, phone);
    // Older backup lacks the committed database receipt as well as the removed business rows.
    jdbc.update("DELETE FROM store_exit_operations WHERE operation_id=?", entry.operationId());
    recoveryWorker.run();
    assertEquals(0, count("accounts", "id", account));
    recoveryWorker.run();
    assertEquals(0, count("accounts", "id", account));
  }

  @Test void tenantExitProjectsBothStoresSalePriceReferencesBeforeDeletingTheAccount() {
    var tenant = policyTenant();
    long tenantId = tenant.getId(), first = store(tenantId), second = store(tenantId), outside = store();
    long account = IDS.incrementAndGet();
    String phone = "139" + String.format("%08d", account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'租户双店售价维护人')", account, phone);
    for (long store : List.of(first, second)) {
      jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id,status)"
          + " VALUES (?,'admin','store_admin',?,?,?,'disabled')", account, store, tenantId, store);
    }
    for (String kind : List.of("finished", "accessory")) {
      salePriceFixture(kind, first, second, account, true);
      jdbc.update("UPDATE store_" + kind + "_products SET tenant_id=? WHERE store_id IN (?,?)", tenantId, first, second);
    }
    tenants.updateStatus(tenantId, "disabled");
    var preview = tenants.getPurgePreview(tenantId);
    assertTrue(preview.eligible(), preview.blockers().toString());
    assertEquals(1L, coordinator.previewForTenant(first).counts().get("accounts_delete"));
    assertEquals(1L, coordinator.previewForTenant(second).counts().get("phones_released"));
    var result = tenants.purgeTenant(tenantId, preview.tenantName(), preview.storePlans());
    assertEquals(preview.accountDeleteCount(), result.accountDeleteCount());
    assertEquals(preview.accountRetainCount(), result.accountRetainCount());
    assertEquals(preview.phoneReleaseCount(), result.phoneReleaseCount());
    assertEquals(0, count("accounts", "id", account));
    assertEquals(0, count("stores", "id", first));
    assertEquals(0, count("stores", "id", second));
    assertEquals(1, count("stores", "id", outside));
    for (String kind : List.of("finished", "accessory")) {
      assertEquals(0, count("store_" + kind + "_sale_prices", "listing_id", first));
      assertEquals(0, count("store_" + kind + "_sale_prices", "listing_id", second));
    }
  }

  private long salePriceFixture(String kind, long target, long other, long account, boolean otherReference) {
    long source = supplyListings(kind, target, other), sku = IDS.incrementAndGet();
    jdbc.update("INSERT INTO " + kind + "_product_variants(id," + kind
        + "_product_id,variant_label) VALUES (?,?,'规格')", sku, source);
    for (long listing : otherReference ? List.of(target, other) : List.of(target)) {
      jdbc.update("INSERT INTO store_" + kind
          + "_sale_prices(listing_id,sku_id,sale_price,price_mode,updated_by_account_id) VALUES (?,?,100,'manual',?)",
          listing, sku, account);
    }
    return sku;
  }

  @Test void pureAuditSurvivesWithoutKeepingTheLoginAccountAndPhoneReuseGetsANewId() {
    long target = store(); long account = IDS.incrementAndGet(); String phone = "139" + String.format("%08d", account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'原人员')", account, phone);
    bind(account, target, "enabled");
    jdbc.update("INSERT INTO security_audit_logs(account_id,request_method,request_path,result_status,result) VALUES (?,'POST','/api/admin/test',200,'success')", account);
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    assertEquals(0, count("accounts", "id", account));
    assertEquals(1, count("security_audit_logs", "account_id", account));
    assertEquals("原人员", jdbc.queryForObject("SELECT display_name_at_exit FROM store_exit_actor_snapshots WHERE account_id=?", String.class, account));
    long replacement = accounts.findOrCreate(phone, "新人员").id();
    assertNotEquals(account, replacement);
    assertEquals(1, count("security_audit_logs", "account_id", account));
    assertEquals(0, count("security_audit_logs", "account_id", replacement));
  }

  @Test void mixedStateActivityRemovesOnlyTheTargetStoreSelection() {
    long target = store(); long other = store();
    long source = IDS.incrementAndGet();
    jdbc.update("INSERT INTO finished_products(id,name,sku,status,source_status,total_stock) VALUES (?,'源商品',?,'selling','selling',3)", source, "exit-source-" + source);
    for (long id : List.of(target, other)) {
      jdbc.update("INSERT INTO store_finished_products(id,tenant_id,store_id,finished_product_id,selected_by_account_id) VALUES (?,1,?,?,1)", id, id, source);
      jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state) VALUES ('store-finished','store',?,'warehouse')", id);
    }
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM product_state_activity WHERE kind='store-finished' AND business_client_code='store' AND record_id=?", Long.class, target));
    assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM product_state_activity WHERE kind='store-finished' AND business_client_code='store' AND record_id=?", Long.class, other));
    assertEquals(1, count("finished_products", "id", source));
  }

  @Test void independentlyProvenDeletionIsReappliedBeforeRestoredStoreCanBeUsed() {
    long target = store(); stores.deleteStore(target, stores.previewDelete(target).planHash());
    jdbc.update("DELETE FROM store_exit_tasks WHERE operation_id IN (SELECT operation_id FROM store_exit_operations WHERE store_id=?)", target);
    jdbc.update("DELETE FROM store_exit_operations WHERE store_id=?", target);
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'旧备份恢复','cityPartner','enabled',1)", target);
    jdbc.update("INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES(1,?,'恢复旧款项')", target);
    // A restored ID is already fenced before any poll or explicit refresh runs.
    assertThrows(org.springframework.security.access.AccessDeniedException.class, () -> recoveryState.requireAvailable(target));
    assertTrue(stores.listForCurrentAdmin(false).stream().noneMatch(s -> s.getId() == target));
    recoveryState.refresh();
    recoveryWorker.run();
    assertEquals(0, count("stores", "id", target));
    assertEquals(0, count("store_payment_names", "store_id", target));
    assertThrows(org.springframework.security.access.AccessDeniedException.class, () -> recoveryState.requireAvailable(target));
    assertFalse(recoveryState.pendingStoreIds().contains(target));
    assertEquals("CLEARED", stores.deleteResult(target).databaseStatus());
  }

  @Test void uncertainIntentFencesOnlyItsStoreWithoutInventingDeletionSuccess() {
    long target = store(); long other = store();
    journal.intent(java.util.UUID.randomUUID().toString(), target, 1, List.of());
    recoveryState.refresh();
    assertThrows(org.springframework.security.access.AccessDeniedException.class, () -> recoveryState.requireAvailable(target));
    assertDoesNotThrow(() -> recoveryState.requireAvailable(other));
    assertThrows(IllegalArgumentException.class, () -> stores.deleteResult(other));
    assertEquals(1, count("stores", "id", target));
    assertEquals(0, count("store_exit_operations", "store_id", target));
  }

  @Test void independentIdentifierWatermarkPreventsRestoredAutoIncrementFromReusingHistoricalAccounts() {
    long watermark = 9000000L;
    journal.intent(java.util.UUID.randomUUID().toString(), 8000000L, 1, List.of(watermark));
    var created = accounts.findOrCreate("13898765432", "恢复后的新账号");
    assertTrue(created.id() > watermark);
    assertEquals(1, count("accounts", "id", created.id()));
    assertEquals(0, count("accounts", "id", watermark));
  }

  @Test void tenantDeletionUsesTheSameModulesAndRollsBackEveryStoreOnOneFailure() {
    var tenant = new com.zdm.platform.tenant.Tenant();
    long fixture = IDS.incrementAndGet();
    tenant.setName("退出租户" + fixture); tenant.setStatus("enabled"); tenant.setContactPhone("137" + String.format("%08d", fixture));
    tenant = tenants.createTenant(tenant);
    final long tenantId = tenant.getId();
    long first = store(tenantId); long second = store(tenantId);
    for (long store : List.of(first, second)) {
      jdbc.update("INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES (?,?,'定金')", tenantId, store);
    }
    tenants.updateStatus(tenantId, "disabled");
    var preview = tenants.getPurgePreview(tenantId);
    assertTrue(preview.eligible(), preview.blockers().toString());
    org.mockito.Mockito.doAnswer(call -> {
      if (((StoreExitScope) call.getArgument(0)).storeId() == second) { throw new IllegalStateException("second store failure"); }
      return call.callRealMethod();
    }).when(exitMedia).verify(org.mockito.ArgumentMatchers.any(StoreExitScope.class));
    assertThrows(RuntimeException.class, () -> tenants.purgeTenant(tenantId, preview.tenantName(), preview.storePlans()));
    assertEquals(1, count("tenants", "id", tenantId));
    assertEquals(1, count("stores", "id", first)); assertEquals(1, count("stores", "id", second));
    assertEquals(1, count("store_payment_names", "store_id", first));
    assertEquals(1, count("store_payment_names", "store_id", second));
    org.mockito.Mockito.reset(historicIdentifiers, exitMedia, previewStorage, org.springframework.test.util.AopTestUtils.getUltimateTargetObject(previewReferenceScope));
    var fresh = tenants.getPurgePreview(tenantId);
    var result = tenants.purgeTenant(tenantId, fresh.tenantName(), fresh.storePlans());
    assertEquals(2, result.storeDeleteCount());
    assertEquals(0, count("tenants", "id", tenantId));
    assertEquals(0, count("store_payment_names", "store_id", first));
    assertEquals(0, count("store_payment_names", "store_id", second));
  }

  @Test void mediaIsReleasedByBusinessDomainWhileSharedReferencesAndOriginalFilesAreProtected() {
    long target = store(); long other = store(); long customer = IDS.incrementAndGet(); long followup = IDS.incrementAndGet();
    jdbc.update("INSERT INTO store_customers(id,tenant_id,store_id,name,requirement,remark,owner_account_id) VALUES (?,1,?,'客户','','',1)", customer, target);
    jdbc.update("INSERT INTO store_customer_followups(id,customer_id,followed_at,content) VALUES (?,?,CURRENT_TIMESTAMP,'内容')", followup, customer);
    long media = media(other);
    reference(media, "STORE_CUSTOMER_FOLLOWUP", followup, "BUSINESS");
    reference(media, "SLAB", 12345678, "BUSINESS");
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain='STORE_CUSTOMER_FOLLOWUP' AND business_id=?", Long.class, followup));
    assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE media_id=? AND business_domain='SLAB'", Long.class, media));
    assertEquals(1, count("media_assets", "id", media));
    worker.run();
    assertFalse(retention.evaluate(jdbc.query("SELECT * FROM media_assets WHERE id=?", new org.springframework.jdbc.core.BeanPropertyRowMapper<>(com.zdm.platform.media.MediaAsset.class), media).getFirst()).eligible());
  }

  @Test void invalidationSnapshotsAreScopedToTheirStoreWhileUpstreamAndOtherStoresStayProtected() {
    long target = store(); long other = store(); long asset = media(other);
    for (String kind : List.of("FINISHED", "ACCESSORY")) {
      String products = kind.equals("FINISHED") ? "finished_products" : "accessory_products";
      String listings = kind.equals("FINISHED") ? "store_finished_products" : "store_accessory_products";
      String productColumn = kind.equals("FINISHED") ? "finished_product_id" : "accessory_product_id";
      long source = IDS.incrementAndGet();
      jdbc.update("INSERT INTO " + products + "(id,name,sku,status) VALUES (?,'失效快照源商品',?,'selling')", source, "snapshot-" + source);
      for (long store : List.of(target, other)) {
        jdbc.update("INSERT INTO " + listings + "(id,tenant_id,store_id," + productColumn
            + ",selected_by_account_id,invalidated_at,invalidated_snapshot) VALUES (?,1,?,?,1,CURRENT_TIMESTAMP,'{}')", store, store, source);
        invalidationReferences(asset, "STORE_" + kind + "_INVALIDATION", store);
      }
      invalidationReferences(asset, kind + "_OPERATIONS_INVALIDATION", source);
    }
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    for (String kind : List.of("FINISHED", "ACCESSORY")) {
      assertEquals(0L, jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND business_id=?", Long.class, "STORE_" + kind + "_INVALIDATION", target));
      assertEquals(2L, jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND business_id=?", Long.class, "STORE_" + kind + "_INVALIDATION", other));
      assertEquals(2L, jdbc.queryForObject("SELECT COUNT(*) FROM media_references WHERE business_domain=? AND media_id=?", Long.class, kind + "_OPERATIONS_INVALIDATION", asset));
      assertThrows(IllegalArgumentException.class, () -> new com.zdm.platform.media.StoreMediaBusinessFence(new StoreExitTargetService(jdbc, recoveryState)).requireParent("STORE_" + kind + "_INVALIDATION", target));
    }
    assertEquals(1, count("media_assets", "id", asset));
  }

  @Test void restoreKeepsTheOriginalMediaReleaseTimeInsteadOfRestartingRetention() {
    long target = store(); long media = media(target);
    jdbc.update("UPDATE media_assets SET unreferenced_since='2026-01-02 03:04:05' WHERE id=?", media);
    stores.deleteStore(target, stores.previewDelete(target).planHash()); worker.run();
    jdbc.update("DELETE FROM store_exit_tasks WHERE operation_id IN (SELECT operation_id FROM store_exit_operations WHERE store_id=?)", target);
    jdbc.update("DELETE FROM store_exit_operations WHERE store_id=?", target);
    jdbc.update("UPDATE media_assets SET unreferenced_since=NULL WHERE id=?", media);
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'恢复门店','cityPartner','enabled',1)", target);
    recoveryState.refresh(); recoveryWorker.run();
    assertEquals(0, count("stores", "id", target));
    assertEquals("2026-01-02 03:04:05", jdbc.queryForObject("SELECT DATE_FORMAT(unreferenced_since,'%Y-%m-%d %H:%i:%s') FROM media_assets WHERE id=?", String.class, media));
  }

  @Test void unknownMediaDomainBlocksDeletionWithoutTreatingUploaderAsOwnership() {
    long target = store(); long media = media(target);
    reference(media, "UNREGISTERED_MEDIA_MODULE", target, "BUSINESS");
    try { assertFalse(stores.previewDelete(target).eligible()); assertEquals(1, count("stores", "id", target)); }
    finally { jdbc.update("DELETE FROM media_references WHERE business_domain='UNREGISTERED_MEDIA_MODULE'"); }
  }


  @Test void repeatingTheSameConfirmedRequestReturnsTheOriginalVerifiedResult() {
    long target = store(); var preview = stores.previewDelete(target);
    org.mockito.Mockito.doAnswer(call -> {
      recoveryState.refresh();
      assertTrue(recoveryState.pendingStoreIds().contains(((StoreExitScope)call.getArgument(0)).storeId()));
      return call.callRealMethod();
    }).when(exitMedia).verify(org.mockito.ArgumentMatchers.any(StoreExitScope.class));
    var first = stores.deleteStore(target, preview.planHash());
    assertFalse(StoreExitRecoveryState.ownsOperation(first.operationId()));
    assertTrue(recoveryState.blocks(target));
    assertFalse(recoveryState.pendingStoreIds().contains(target));
    assertEquals("PENDING", first.cleanupStatus());
    var again = stores.deleteStore(target, preview.planHash());
    assertEquals(first.operationId(), again.operationId());
    assertEquals(1, count("store_exit_operations", "store_id", target));
    assertThrows(IllegalArgumentException.class, () -> stores.deleteStore(target, "0".repeat(64)));
  }

  @Test void concurrentLateWriterWaitsForExitAndCannotRepopulateDeletedStore() throws Exception {
    long target = store(); var preview = stores.previewDelete(target);
    var attempted = new java.util.concurrent.CountDownLatch(1);
    var future = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<?>>();
    try (var executor = java.util.concurrent.Executors.newSingleThreadExecutor()) {
      new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
        jdbc.queryForList("SELECT id FROM stores WHERE id=? FOR UPDATE", target);
        future.set(executor.submit(() -> {
          attempted.countDown();
          jdbc.update("INSERT INTO store_payment_names(tenant_id,store_id,name) VALUES(1,?,'迟到写入')", target);
        }));
        try { assertTrue(attempted.await(5, java.util.concurrent.TimeUnit.SECONDS)); }
        catch (InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
        stores.deleteStore(target, preview.planHash());
      });
      assertThrows(java.util.concurrent.ExecutionException.class, () -> future.get().get(5, java.util.concurrent.TimeUnit.SECONDS));
    }
    assertEquals(0, count("store_payment_names", "store_id", target));
  }

  @Test void historicalStateOperatorCanExitWithoutLosingTheNameOrSharingFuturePhoneHistory() {
    long target = store(); long account = IDS.incrementAndGet(); long source = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'历史操作人')", account, "139" + String.format("%08d", account));
    bind(account, target, "enabled");
    jdbc.update("INSERT INTO finished_products(id,name,sku,status) VALUES (?,'历史商品',?,'selling')", source, "historical-" + source);
    jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_account_id) VALUES ('finished','admin',?,'selling',?)", source, account);
    long media = media(target);
    jdbc.update("UPDATE media_assets SET created_by_account_id=? WHERE id=?", account, media);
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    assertEquals(0, count("accounts", "id", account));
    assertEquals(1, count("media_assets", "id", media));
    assertEquals("历史操作人", jdbc.queryForObject("SELECT display_name_at_exit FROM store_exit_actor_snapshots WHERE account_id=?", String.class, account));
    assertEquals(1L, jdbc.queryForObject("SELECT COUNT(*) FROM product_state_activity WHERE kind='finished' AND record_id=? AND operator_account_id=?", Long.class, source, account));
  }

  @Test void contradictoryIndependentOutcomesNeverAuthorizeAutomaticCleanup() {
    long target = store(); String operation = java.util.UUID.randomUUID().toString();
    journal.intent(operation, target, 1, List.of()); journal.append(operation, target, 1, "ROLLED_BACK");
    var receipt = new java.util.LinkedHashMap<String,Object>();
    receipt.put("operation_id", operation); receipt.put("store_id", target); receipt.put("tenant_id", 1L);
    receipt.put("rule_version", "V1.3"); receipt.put("plan_hash", "a".repeat(64));
    receipt.put("result_json", "{\"counts\":{},\"retained\":[],\"verified\":true,\"mediaRelease\":{},\"accountIds\":[]}");
    journal.committed(receipt); recoveryState.refresh(); recoveryWorker.run();
    assertTrue(recoveryState.blocks(target));
    assertEquals(1, count("stores", "id", target));
    assertEquals(0, count("store_exit_operations", "store_id", target));
  }


  @Test void cleanupRetriesAreBoundedAndManualRetryRemainsScopedToTheOriginalOperation() {
    long target = store(); stores.deleteStore(target, stores.previewDelete(target).planHash());
    var attempts = new java.util.concurrent.atomic.AtomicInteger();
    var failingJournal = org.mockito.Mockito.mock(StoreExitJournal.class);
    org.mockito.Mockito.doAnswer(call -> {
      java.util.Map<String,Object> receipt = call.getArgument(0);
      if (((Number) receipt.get("store_id")).longValue() == target) {
        attempts.incrementAndGet(); throw new IllegalStateException("isolated ledger outage");
      }
      journal.committed(receipt); return null;
    }).when(failingJournal).committed(org.mockito.ArgumentMatchers.anyMap());
    var failing = new StoreExitTaskWorker(jdbc, mediaCleanup, failingJournal, mediaFollowup, transactionManager, 5);
    for (int attempt=0; attempt<5; attempt++) {
      jdbc.update("UPDATE store_exit_tasks SET next_attempt_at=CURRENT_TIMESTAMP(6) WHERE operation_id IN (SELECT operation_id FROM store_exit_operations WHERE store_id=?)", target);
      failing.run();
    }
    assertEquals(5, attempts.get()); assertEquals("ATTENTION", stores.deleteResult(target).cleanupStatus());
    failing.run(); assertEquals(5, attempts.get());
    stores.retryDelete(target); worker.run();
    assertEquals("COMPLETE", stores.deleteResult(target).cleanupStatus());
    assertEquals(1, count("store_exit_operations", "store_id", target));
  }

  @Test void tenantSelfScopeCanDeleteItsStoresWithoutAcquiringOtherStoresDataAccess() {
    var tenant = new com.zdm.platform.tenant.Tenant(); long creator = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'运营创建人')", creator, "136" + String.format("%08d", creator));
    tenant.setName("自身范围租户" + creator); tenant.setStatus("enabled"); tenant.setContactPhone("135" + String.format("%08d", creator));
    tenant = tenants.createTenant(tenant); long tenantId = tenant.getId(); long target = store(tenantId);
    tenants.updateStatus(tenantId, "disabled"); jdbc.update("UPDATE tenants SET created_by_account_id=? WHERE id=?", creator, tenantId);
    var actor = new CurrentIdentity(null, creator, creator, null, "admin", null, null, "运营创建人", "self", List.of(), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(actor, null, List.of()));
    var preview = tenants.getPurgePreview(tenantId);
    var result = tenants.purgeTenant(tenantId, preview.tenantName(), preview.storePlans());
    assertEquals(1, result.storeResults().size());
    assertEquals("CLEARED", result.storeResults().getFirst().databaseStatus());
    assertThrows(org.springframework.security.access.AccessDeniedException.class, () -> stores.deleteResult(target));
  }


  @Test void expiredInvitesOfRestoredRetiredStoresCannotWriteThroughPublicEntries() {
    assertExpiredInviteEntriesBlocked(restoredRetiredStore());
  }

  @Test void expiredInvitesOfUnresolvedStoresCannotWriteThroughPublicEntries() {
    long target=store(); String operation=java.util.UUID.randomUUID().toString();
    journal.intent(operation,target,1,List.of()); recoveryState.refresh();
    try { assertExpiredInviteEntriesBlocked(target); }
    finally { journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh(); }
  }

  private void assertExpiredInviteEntriesBlocked(long target) {
    for(int entry=0;entry<4;entry++) {
      String token=expiredInvite(target); final int action=entry;
      assertThrows(org.springframework.security.access.AccessDeniedException.class,()->invokeInviteEntry(token,action));
      assertEquals("active",jdbc.queryForObject("SELECT status FROM employee_invites WHERE token=?",String.class,token));
      assertEquals(0L,jdbc.queryForObject("SELECT COUNT(*) FROM employee_invite_acceptances a JOIN employee_invites i ON i.id=a.invite_id WHERE i.token=?",Long.class,token));
    }
  }

  @Test void normalAndPlatformExpiredInvitesKeepTheirExistingPublicExpiryBehavior() {
    Long live=store();
    for(Long target:java.util.Arrays.asList(live,null)) {
      for(int entry=0;entry<2;entry++) {
        String token=expiredInvite(target); final int action=entry;
        var error=assertThrows(IllegalArgumentException.class,()->invokeInviteEntry(token,action));
        assertEquals("邀请链接已过期",error.getMessage());
        assertEquals("expired",jdbc.queryForObject("SELECT status FROM employee_invites WHERE token=?",String.class,token));
      }
    }
  }

  private String expiredInvite(Long target) {
    String token=java.util.UUID.randomUUID().toString();
    jdbc.update("INSERT INTO employee_invites(token,client_code,tenant_id,store_id,created_by_account_id,status,expires_at) VALUES (?,'admin',?,?,1,'active',DATE_SUB(NOW(),INTERVAL 1 MINUTE))",token,target==null?null:1L,target);
    return token;
  }

  private void invokeInviteEntry(String token,int entry) {
    switch(entry) {
      case 0 -> invites.inspectInvite(token);
      case 1 -> invites.requestCode(token,new com.zdm.platform.employee.RequestInviteCodeRequest("13800000000"));
      case 2 -> invites.verifyCode(token,new com.zdm.platform.employee.VerifyInviteCodeRequest("13800000000","888888"));
      case 3 -> invites.register(token,new com.zdm.platform.employee.EmployeeInviteRegisterRequest("13800000000","888888","新员工","male"));
      default -> throw new IllegalArgumentException("测试入口错误");
    }
  }

  @Test void duplicateInsertCannotReuseARetiredAccountThatAppearsAfterTheInitialLookup() {
    long target=store(),account=IDS.incrementAndGet(); String phone="134"+String.format("%08d",account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'原账号')",account,phone); bind(account,target,"enabled");
    stores.deleteStore(target,stores.previewDelete(target).planHash());
    insertConflictingAccountAfterInitialLookup(account,phone);
    var error=assertThrows(IllegalStateException.class,()->accounts.findOrCreate(phone,"不能接续历史"));
    assertEquals("该账号的退出结果尚待恢复核验，不能复用历史账号",error.getMessage());
    assertEquals("冲突回读账号",jdbc.queryForObject("SELECT display_name FROM accounts WHERE id=?",String.class,account));
    assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE phone=?",Long.class,phone));
  }

  @Test void duplicateInsertCannotReuseAnUnresolvedExclusiveAccount() {
    long target=store(),account=IDS.incrementAndGet(); String phone="134"+String.format("%08d",account);
    String operation=java.util.UUID.randomUUID().toString();
    journal.intent(operation,target,1,List.of(account)); recoveryState.refresh();
    try {
      insertConflictingAccountAfterInitialLookup(account,phone);
      var error=assertThrows(IllegalStateException.class,()->accounts.findOrCreate(phone,"不能接续历史"));
      assertEquals("该账号的退出结果尚待恢复核验，不能复用历史账号",error.getMessage());
      assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE phone=?",Long.class,phone));
    } finally { journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh(); }
  }

  @Test void duplicateInsertStillReusesANormalAccountWithoutChangingItsProfile() {
    long account=IDS.incrementAndGet(); String phone="134"+String.format("%08d",account);
    insertConflictingAccountAfterInitialLookup(account,phone);
    var result=accounts.findOrCreate(phone,"不覆盖姓名");
    assertEquals(account,result.id()); assertFalse(result.created()); assertEquals("冲突回读账号",result.name());
    assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE phone=?",Long.class,phone));
  }

  @Test void duplicateInsertPreservesAnAccountSharedWithAnotherStoreDuringAnUnresolvedExit() {
    long target=store(),other=store(),account=IDS.incrementAndGet(); String phone="134"+String.format("%08d",account);
    String operation=java.util.UUID.randomUUID().toString();
    journal.intent(operation,target,1,List.of(account)); recoveryState.refresh();
    try {
      insertConflictingAccountAfterInitialLookup(account,phone,other);
      var result=accounts.findOrCreate(phone,"不覆盖共享账号");
      assertEquals(account,result.id()); assertFalse(result.created()); assertEquals("冲突回读账号",result.name());
      assertEquals(1,count("account_identities","account_id",account));
    } finally { journal.append(operation,target,1,"ROLLED_BACK"); recoveryState.refresh(); }
  }

  private void insertConflictingAccountAfterInitialLookup(long account,String phone) {
    insertConflictingAccountAfterInitialLookup(account,phone,null);
  }

  private void insertConflictingAccountAfterInitialLookup(long account,String phone,Long otherStore) {
    // Commit from another connection in the exact gap before the real INSERT, without sleeps or mocked SQL results.
    org.mockito.Mockito.doAnswer(call->{
      Object watermark=call.callRealMethod();
      try(var connection=java.sql.DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());
          var statement=connection.prepareStatement("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'冲突回读账号')")) {
        statement.setLong(1,account); statement.setString(2,phone); assertEquals(1,statement.executeUpdate());
        if(otherStore!=null) {
          try(var binding=connection.prepareStatement("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES (?,'admin','store_admin',?,1,?,'enabled')")) {
            binding.setLong(1,account); binding.setLong(2,otherStore); binding.setLong(3,otherStore);
            assertEquals(1,binding.executeUpdate());
          }
        }
      }
      return watermark;
    }).when(historicIdentifiers).reserve("accounts");
  }

  @Test void restoredRetiredAccountCannotBeReusedByPhoneBeforeRecoveryCompletes() {
    long target = store(); long account = IDS.incrementAndGet(); String phone = "134" + String.format("%08d", account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'旧账号')", account, phone); bind(account,target,"enabled");
    stores.deleteStore(target, stores.previewDelete(target).planHash());
    assertEquals(0, count("accounts", "id", account));
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'旧备份门店','cityPartner','enabled',1)", target);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'恢复旧账号')", account, phone); bind(account,target,"enabled");
    recoveryState.refresh();
    assertThrows(IllegalStateException.class, () -> accounts.findOrCreate(phone,"禁止复用"));
    assertEquals(1, count("accounts", "id", account));
    recoveryWorker.run();
    assertEquals(0, count("accounts", "id", account));
    assertNotEquals(account, accounts.findOrCreate(phone,"新账号").id());
  }

  @Test void unknownMixedTableDomainCannotSilentlyInheritSharedRetention() {
    long target = store(); long record = IDS.incrementAndGet();
    jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state) VALUES ('new-store-kind','store',?,'warehouse')", record);
    try { assertFalse(stores.previewDelete(target).eligible()); assertEquals(1,count("stores","id",target)); }
    finally { jdbc.update("DELETE FROM product_state_activity WHERE kind='new-store-kind' AND record_id=?",record); }
  }


  @Test void preflightDoesNotCountAnAlreadyReleasedPhoneAsANewRelease() {
    long target = store(); long account = IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,NULL,'无手机号历史账号')", account); bind(account,target,"disabled");
    var preview=stores.previewDelete(target);
    assertEquals(1L,preview.counts().get("accounts_delete"));
    assertEquals(0L,preview.counts().get("phones_released"));
    stores.deleteStore(target,preview.planHash()); assertEquals(0,count("accounts","id",account));
  }

  @Test void databaseRejectsWrongSupplierOwnershipAndExitPreservesPlatformSuppliers() {
    long target=store(); long supplier=IDS.incrementAndGet();
    assertThrows(org.springframework.dao.DataAccessException.class, () -> jdbc.update(
        "INSERT INTO suppliers(id,owner_scope,owner_id,tenant_id,store_id,name,status) VALUES (?,'platform',0,1,?,'错配归属供应商','enabled')",supplier,target));
    assertEquals(1,count("stores","id",target)); assertEquals(0,count("suppliers","id",supplier));
    jdbc.update("INSERT INTO suppliers(id,owner_scope,owner_id,tenant_id,store_id,name,status) VALUES (?,'platform',0,NULL,NULL,'公共供应商','enabled')",supplier);
    var preview=stores.previewDelete(target); assertTrue(preview.eligible());
    stores.deleteStore(target,preview.planHash());
    assertEquals(0,count("stores","id",target)); assertEquals(1,count("suppliers","id",supplier));
  }

  @Test void tenantExitBlocksBindingsPointingIntoAnotherTenantsStore() {
    long foreignStore=store(); long fixture=IDS.incrementAndGet();
    var tenant=new com.zdm.platform.tenant.Tenant();tenant.setName("错配关系租户"+fixture);tenant.setStatus("enabled");tenant.setContactPhone("133"+String.format("%08d",fixture));
    tenant=tenants.createTenant(tenant); long tenantId=tenant.getId();tenants.updateStatus(tenantId,"disabled");
    jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES (1,'admin','store_admin',?,?,?,'disabled')",foreignStore,tenantId,foreignStore);
    try {
      var preview=tenants.getPurgePreview(tenantId);assertFalse(preview.eligible());
      assertThrows(IllegalArgumentException.class,()->tenants.purgeTenant(tenantId,preview.tenantName(),preview.storePlans()));
      assertEquals(1,count("stores","id",foreignStore));assertEquals(1,count("tenants","id",tenantId));
    } finally {jdbc.update("DELETE FROM account_identities WHERE tenant_id=? AND store_id=?",tenantId,foreignStore);}
  }

  @Test void exitingAnAccountWithoutRetainedHistoryDoesNotCopyItsName() {
    long target=store(),account=IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'无需保留姓名')",account,"132"+String.format("%08d",account));
    bind(account,target,"enabled");
    stores.deleteStore(target,stores.previewDelete(target).planHash());
    assertEquals(0,count("accounts","id",account));
    assertEquals(0,count("store_exit_actor_snapshots","account_id",account));
  }

  @Test void necessaryActorNamesSurviveAnOlderBackupWithoutChangingToTheRestoredName() throws Exception {
    long target=store(),account=IDS.incrementAndGet(),source=IDS.incrementAndGet();
    String phone="132"+String.format("%08d",account);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'删除时姓名')",account,phone);bind(account,target,"enabled");
    jdbc.update("INSERT INTO finished_products(id,name,sku,status) VALUES (?,'历史商品',?,'selling')",source,"name-proof-"+source);
    jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_account_id) VALUES ('finished','admin',?,'selling',?)",source,account);
    stores.deleteStore(target,stores.previewDelete(target).planHash());
    var receipt=journal.entries().stream().filter(e->e.storeId()==target&&"COMMITTED".equals(e.stage())).findFirst().orElseThrow();
    assertEquals("删除时姓名",json.readTree(String.valueOf(receipt.receipt().get("result_json"))).path("actorSnapshots").path(String.valueOf(account)).asText());
    jdbc.update("DELETE FROM store_exit_actor_snapshots WHERE account_id=?",account);
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'旧备份门店','cityPartner','enabled',1)",target);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'更旧的姓名')",account,phone);bind(account,target,"enabled");
    var result=(com.fasterxml.jackson.databind.node.ObjectNode)json.readTree(String.valueOf(receipt.receipt().get("result_json")));
    result.set("actorSnapshots",json.createObjectNode());
    for(boolean legacy:List.of(false,true)) {
      if(legacy) { result.remove("actorSnapshots"); }
      var incomplete=new java.util.LinkedHashMap<>(receipt.receipt());incomplete.put("result_json",json.writeValueAsString(result));
      var entry=new StoreExitJournal.Entry(receipt.operationId(),target,1L,"COMMITTED",incomplete);
      assertThrows(IllegalStateException.class,()->org.springframework.test.util.ReflectionTestUtils.invokeMethod(
          (Object)org.springframework.test.util.AopTestUtils.getUltimateTargetObject(coordinator),"restoreActorSnapshots",entry));
      assertEquals(0,count("store_exit_actor_snapshots","account_id",account));
    }
    recoveryState.refresh();recoveryWorker.run();
    assertEquals(0,count("stores","id",target));assertEquals(0,count("accounts","id",account));
    assertEquals("删除时姓名",jdbc.queryForObject("SELECT display_name_at_exit FROM store_exit_actor_snapshots WHERE account_id=?",String.class,account));
  }

  @Test void tenantWithoutStoresKeepsItsOriginalHistoricalAccountPolicy() {
    var tenant=policyTenant();long id=tenant.getId();
    long account=jdbc.queryForObject("SELECT account_id FROM tenants WHERE id=?",Long.class,id);
    jdbc.update("INSERT INTO security_audit_logs(account_id,request_method,request_path,result_status,result) VALUES (?,'POST','/api/admin/test',200,'success')",account);
    tenants.updateStatus(id,"disabled");var preview=tenants.getPurgePreview(id);
    assertEquals(0,preview.accountDeleteCount());assertEquals(1,preview.accountRetainCount());assertEquals(1,preview.phoneReleaseCount());
    var result=tenants.purgeTenant(id,preview.tenantName(),preview.storePlans());
    assertEquals(0,result.accountDeleteCount());assertEquals(1,result.accountRetainCount());assertEquals(1,result.phoneReleaseCount());
    assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM accounts WHERE id=? AND phone IS NULL AND status='disabled'",Long.class,account));
    assertEquals(0,count("store_exit_actor_snapshots","account_id",account));
  }

  @Test void tenantDeletionSeparatesTenantAccountsFromStoreOnlyAccountsAndPreservesOtherStores() {
    var tenant=policyTenant();long id=tenant.getId(),target=store(id),other=store(),account=IDS.incrementAndGet();
    long tenantAccount=jdbc.queryForObject("SELECT account_id FROM tenants WHERE id=?",Long.class,id);
    jdbc.update("INSERT INTO security_audit_logs(account_id,request_method,request_path,result_status,result) VALUES (?,'POST','/api/admin/test',200,'success')",tenantAccount);
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'仅属门店')",account,"132"+String.format("%08d",account));
    jdbc.update("INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES (?,'admin','store_admin',?,?,?,'disabled')",account,target,id,target);
    tenants.updateStatus(id,"disabled");var preview=tenants.getPurgePreview(id);
    assertEquals(1,preview.accountDeleteCount());assertEquals(1,preview.accountRetainCount());assertEquals(2,preview.phoneReleaseCount());
    var result=tenants.purgeTenant(id,preview.tenantName(),preview.storePlans());
    assertEquals(1,result.accountDeleteCount());assertEquals(1,result.accountRetainCount());assertEquals(2,result.phoneReleaseCount());
    assertEquals(0,count("accounts","id",account));assertEquals(1,count("accounts","id",tenantAccount));
    assertEquals(1,count("stores","id",other));assertEquals(0,count("stores","id",target));
  }

  @Test void downstreamMediaFailuresCannotBeReportedAsCompletedExitAndRecoveryClearsTheWarning() throws Exception {
    long target=store(),asset=media(target);
    String fixtureKey="media/"+java.util.UUID.randomUUID()+".jpg";
    jdbc.update("UPDATE media_assets SET storage_key=?,file_size=3 WHERE id=?",fixtureKey,asset);
    var flags=jdbc.queryForMap("SELECT deletion_enabled,migration_completed FROM media_lifecycle_control WHERE id=1");
    try {
      jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=1,migration_completed=1 WHERE id=1");
      var result=stores.deleteStore(target,stores.previewDelete(target).planHash());
      worker.run();
      long job=jdbc.queryForObject("SELECT MAX(id) FROM media_cleanup_tasks WHERE media_id=?",Long.class,asset);
      assertEquals("PENDING",stores.deleteResult(target).cleanupStatus());
      cleanupWorker.process(job);worker.run();
      assertEquals("COMPLETE",stores.deleteResult(target).cleanupStatus());
      assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM media_assets WHERE id=? AND status<>'deleted'",Long.class,asset));
      jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 48 HOUR) WHERE id=?",asset);
      long later=mediaCleanup.enqueue(asset,"scheduled","隔离测试到期回收",false);
      assertEquals("PENDING",stores.deleteResult(target).cleanupStatus());
      assertTrue(cleanupWorker.process(later).failed());
      jdbc.update("INSERT INTO media_cleanup_tasks(media_id,trigger_type,reason,status,retry_count) VALUES (?,'scheduled','另一个已处理候选','success',0)",asset);
      var failed=stores.deleteResult(target);
      assertEquals("ATTENTION",failed.cleanupStatus());assertEquals(1,failed.pendingTasks());
      assertEquals("COMPLETE",jdbc.queryForObject("SELECT status FROM store_exit_operations WHERE operation_id=?",String.class,result.operationId()));
      Files.createDirectories(MEDIA.resolve("media"));Files.write(MEDIA.resolve(fixtureKey),new byte[]{1,2,3});
      jdbc.update("UPDATE media_cleanup_tasks SET next_retry_at=NOW() WHERE id=?",later);
      assertTrue(cleanupWorker.process(later).deleted());
      assertEquals("COMPLETE",stores.deleteResult(target).cleanupStatus());
    } finally {
      jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=?,migration_completed=? WHERE id=1",flags.get("deletion_enabled"),flags.get("migration_completed"));
    }
  }

  @Test void logicallyDeletedMediaStillReportsPendingAndFailedPhysicalCleanup() {
    long target=store(),asset=media(target);
    var flags=jdbc.queryForMap("SELECT deletion_enabled,migration_completed FROM media_lifecycle_control WHERE id=1");
    try {
      jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=1,migration_completed=1 WHERE id=1");
      stores.deleteStore(target,stores.previewDelete(target).planHash());
      worker.run();
      long job=jdbc.queryForObject("SELECT MAX(id) FROM media_cleanup_tasks WHERE media_id=?",Long.class,asset);
      jdbc.update("UPDATE media_assets SET status='deleted',deleted_at=NOW() WHERE id=?",asset);
      jdbc.update("UPDATE media_cleanup_tasks SET status='failed',last_error='isolated physical finish failure' WHERE id=?",job);
      assertEquals("ATTENTION",stores.deleteResult(target).cleanupStatus());
      assertEquals(1,stores.deleteResult(target).pendingTasks());
      jdbc.update("UPDATE media_cleanup_tasks SET status='pending',last_error=NULL WHERE id=?",job);
      assertEquals("PENDING",stores.deleteResult(target).cleanupStatus());
      assertEquals(1,stores.deleteResult(target).pendingTasks());
      jdbc.update("UPDATE media_cleanup_tasks SET status='success' WHERE id=?",job);
      worker.run();
      assertEquals("COMPLETE",stores.deleteResult(target).cleanupStatus());
      assertEquals(0,stores.deleteResult(target).pendingTasks());
    } finally {
      jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=?,migration_completed=? WHERE id=1",flags.get("deletion_enabled"),flags.get("migration_completed"));
    }
  }

  @Test void sharedOrManuallyHeldMediaRemainsProtectedWithoutAnExitFailure() {
    long target=store(),asset=media(target);reference(asset,"MANUAL_HOLD",IDS.incrementAndGet(),"MANUAL");
    stores.deleteStore(target,stores.previewDelete(target).planHash());worker.run();
    long job=jdbc.queryForObject("SELECT MAX(id) FROM media_cleanup_tasks WHERE media_id=?",Long.class,asset);
    assertFalse(cleanupWorker.process(job).failed());worker.run();
    assertEquals("COMPLETE",stores.deleteResult(target).cleanupStatus());
    assertEquals(1,count("media_assets","id",asset));assertEquals(1L,retention.count(asset,"MANUAL"));
  }

  @Test void securityAuditScopeSurvivesIdentityDeletionWithoutInventingHistoricalNames() {
    long target=store(),other=store(),account=IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'跨店人员')",account,"130"+String.format("%08d",account));
    bind(account,target,"enabled");bind(account,other,"disabled");
    long identity=jdbc.queryForObject("SELECT id FROM account_identities WHERE account_id=? AND store_id=?",Long.class,account,target);
    long otherIdentity=jdbc.queryForObject("SELECT id FROM account_identities WHERE account_id=? AND store_id=?",Long.class,account,other);
    var actor=new CurrentIdentity(null,account,identity,null,"admin",1L,target,"事件时姓名","all",List.of(),List.of());
    String original=jdbc.queryForObject("SELECT name FROM stores WHERE id=?",String.class,target);
    var captured=securityAudit.capture(actor);
    jdbc.update("INSERT INTO security_audit_logs(account_id,identity_id,client_code,request_method,request_path,result_status,result) VALUES (?,?,'admin','POST','/api/admin/legacy-scope',200,'success')",account,identity);
    jdbc.update("INSERT INTO security_audit_logs(account_id,identity_id,client_code,request_method,request_path,result_status,result) VALUES (?,?,'admin','POST','/api/admin/other-scope',200,'success')",account,otherIdentity);
    jdbc.update("UPDATE stores SET name='退出时门店名称' WHERE id=?",target);
    stores.deleteStore(target,stores.previewDelete(target).planHash());
    securityAudit.recordCaptured(captured,"POST","/api/admin/request-scope",200);
    var legacy=jdbc.queryForMap("SELECT * FROM security_audit_logs WHERE identity_id=? AND request_path='/api/admin/legacy-scope'",identity);
    assertEquals(target,((Number)legacy.get("store_id_snapshot")).longValue());assertEquals("退出时门店名称",legacy.get("store_name_snapshot"));
    assertEquals("store-exit",legacy.get("scope_snapshot_source"));assertNotNull(legacy.get("scope_snapshot_at"));
    var event=jdbc.queryForMap("SELECT * FROM security_audit_logs WHERE identity_id=? AND request_path='/api/admin/request-scope'",identity);
    assertEquals(original,event.get("store_name_snapshot"));assertEquals("事件时姓名",event.get("actor_name_snapshot"));assertEquals("request-start",event.get("scope_snapshot_source"));
    assertEquals(0,count("account_identities","id",identity));assertEquals(1,count("accounts","id",account));
    assertEquals(1L,jdbc.queryForObject("SELECT COUNT(*) FROM security_audit_logs WHERE identity_id=? AND scope_snapshot_source IS NULL",Long.class,otherIdentity));
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,1,'更旧备份中的门店','cityPartner','enabled',1)",target);
    jdbc.update("INSERT INTO account_identities(id,account_id,client_code,identity_type,subject_id,tenant_id,store_id,status) VALUES (?,?,'admin','store_admin',?,1,?,'enabled')",identity,account,target,target);
    jdbc.update("UPDATE security_audit_logs SET tenant_id_snapshot=NULL,tenant_name_snapshot=NULL,store_id_snapshot=NULL,store_name_snapshot=NULL,scope_snapshot_source=NULL,scope_snapshot_at=NULL WHERE identity_id=? AND request_path='/api/admin/legacy-scope'",identity);
    recoveryState.refresh();recoveryWorker.run();
    var restored=jdbc.queryForMap("SELECT * FROM security_audit_logs WHERE identity_id=? AND request_path='/api/admin/legacy-scope'",identity);
    assertEquals("退出时门店名称",restored.get("store_name_snapshot"));assertEquals("exit-recovery",restored.get("scope_snapshot_source"));
    assertEquals(0,count("stores","id",target));assertEquals(1,count("accounts","id",account));
  }

  @Test void unverifiableLegacyAuditAssociationBlocksExitInsteadOfGuessingScope() {
    long target=store(),account=IDS.incrementAndGet();
    jdbc.update("INSERT INTO accounts(id,phone,display_name) VALUES (?,?,'待核验人员')",account,"130"+String.format("%08d",account));bind(account,target,"enabled");
    long identity=jdbc.queryForObject("SELECT id FROM account_identities WHERE account_id=? AND store_id=?",Long.class,account,target);
    jdbc.update("INSERT INTO security_audit_logs(account_id,identity_id,client_code,request_method,request_path,result_status,result) VALUES (1,?,'admin','POST','/api/admin/invalid-scope',200,'success')",identity);
    assertFalse(stores.previewDelete(target).eligible());assertThrows(IllegalArgumentException.class,()->stores.deleteStore(target,"invalid"));
    assertEquals(1,count("stores","id",target));
  }

  private com.zdm.platform.tenant.Tenant policyTenant() {
    long suffix=IDS.incrementAndGet();var tenant=new com.zdm.platform.tenant.Tenant();
    tenant.setName("账号边界租户"+suffix);tenant.setStatus("enabled");tenant.setContactPhone("131"+String.format("%08d",suffix));
    return tenants.createTenant(tenant);
  }

  private long media(long store) {
    long id = IDS.incrementAndGet();
    jdbc.update("""
        INSERT INTO media_assets(id,public_id,storage_key,media_type,mime_type,owner_client_code,tenant_id,store_id,status)
        VALUES (?,?,?,'image','image/jpeg','admin',1,?,'active')
        """, id, java.util.UUID.randomUUID().toString(), "exit-fixture-" + id, store);
    return id;
  }
  private void reference(long media, String domain, long business, String kind) {
    jdbc.update("""
        INSERT INTO media_references(media_id,business_domain,business_id,field_key,owner_client_code,reference_kind)
        VALUES (?,?,?,'image','admin',?)
        """, media, domain, business, kind);
  }

  private void invalidationReferences(long media, String domain, long business) {
    reference(media, domain, business, "HISTORY");
    jdbc.update("""
        INSERT INTO media_references(media_id,business_domain,business_id,field_key,owner_client_code,reference_kind)
        VALUES (?,?,?,'image:preview','admin','PREVIEW')
        """, media, domain, business);
  }

  private void bind(long account, long store, String state) {
    jdbc.update("""
        INSERT INTO account_identities(account_id,client_code,identity_type,subject_id,tenant_id,store_id,status)
        VALUES (?,'admin','store_admin',?,1,?,?)
        """, account, store, store, state);
  }

  @Test void selectionTenantMismatchBlocksDeletionWithoutRemovingAnyRows() {
    long target=store();
    jdbc.update("INSERT INTO store_selection_items(tenant_id,store_id,account_id,product_type,product_id) VALUES(999999,?,1,'finished',1)",target);
    try {
      var preview=stores.previewDelete(target);
      assertFalse(preview.eligible());
      assertTrue(preview.blockers().contains("该门店仍有跨组织引用，不能彻底删除"));
      assertThrows(IllegalArgumentException.class,()->stores.deleteStore(target,preview.planHash()));
      assertEquals(1,count("stores","id",target));
      assertEquals(1,count("store_selection_items","store_id",target));
    } finally { jdbc.update("DELETE FROM store_selection_items WHERE store_id=?",target); }
  }

  @Test void selectionAllAccountsAndBatchStatesAreDeletedWithoutTouchingOtherStoresOrPublicProducts() {
    long target=store(), other=store(), product=IDS.incrementAndGet();
    jdbc.update("INSERT INTO finished_products(id,name,sku,total_stock,status,source_status) VALUES(?,? ,?,7,'selling','selling')",
        product,"共享商品","selection-exit-"+product);
    List<Long> batches=new java.util.ArrayList<>();
    for (long owner : List.of(1L, 2L)) {
      for (long store : List.of(target,other)) {
        jdbc.update("INSERT INTO store_selection_items(tenant_id,store_id,account_id,product_type,product_id) VALUES(1,?,?,'finished',?)",store,owner,product);
        for (String state : List.of("processing","completed")) {
          long batch=IDS.incrementAndGet();
          jdbc.update("INSERT INTO store_selection_batches(id,tenant_id,store_id,account_id,request_id,status) VALUES(?,1,?,?,?,?)",batch,store,owner,"exit-"+batch,state);
          for (String itemState : List.of("pending","success","failure")) {
            jdbc.update("INSERT INTO store_selection_batch_items(batch_id,selection_id,product_type,product_id,product_name,status) VALUES(?,1,'finished',?,'快照',?)",batch,IDS.incrementAndGet(),itemState);
          }
          if (store==target) { batches.add(batch); }
        }
      }
    }
    var preview=stores.previewDelete(target);
    assertTrue(preview.eligible(),preview.blockers().toString());
    assertEquals(2L,preview.counts().get("store_selection_items"));
    assertEquals(4L,preview.counts().get("store_selection_batches"));
    assertEquals(12L,preview.counts().get("store_selection_batch_items"));
    stores.deleteStore(target,preview.planHash());
    assertEquals(0,count("store_selection_items","store_id",target));
    assertEquals(0,count("store_selection_batches","store_id",target));
    batches.forEach(batch -> assertEquals(0,count("store_selection_batch_items","batch_id",batch)));
    assertEquals(2,count("store_selection_items","store_id",other));
    assertEquals(4,count("store_selection_batches","store_id",other));
    assertEquals(12L,jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_batch_items i JOIN store_selection_batches b ON b.id=i.batch_id WHERE b.store_id=?",Long.class,other));
    assertEquals(7,jdbc.queryForObject("SELECT total_stock FROM finished_products WHERE id=?",Integer.class,product));
    assertEquals(1,count("stores","id",other));
  }

  private long store() {
    return store(1);
  }
  private long store(long tenant) {
    long id = IDS.incrementAndGet();
    jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status,created_by_account_id) VALUES (?,?,?,'cityPartner','disabled',1)", id, tenant, "退出测试" + id);
    return id;
  }
  private int count(String table, String column, long id) {
    return jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE " + column + "=?", Integer.class, id);
  }
  private static Path ledgerDirectory() {
    try { return Files.createTempDirectory("zdm-store-exit-test-"); }
    catch (java.io.IOException exception) { throw new ExceptionInInitializerError(exception); }
  }
}
