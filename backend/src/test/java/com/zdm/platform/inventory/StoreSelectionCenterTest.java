package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.PermissionGuard;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers
class StoreSelectionCenterTest {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("selection_center").withUsername("selection_test").withPassword("selection_test");
  private final ThreadLocal<CityPartnerStoreScope.Store> identity = ThreadLocal.withInitial(() -> new CityPartnerStoreScope.Store(1L, 10L, 1L, 1L, "员工"));
  private JdbcTemplate jdbc;
  private StoreSelectionCatalog catalog;
  private StoreSelectionService service;
  private StoreFinishedProductService finished;
  private PermissionGuard guard;
  private DataSourceTransactionManager transactions;
  private com.zdm.platform.storeexit.StoreExitTargetService targets;

  @BeforeEach
  void setup() throws Exception {
    var datasource = new DriverManagerDataSource(MYSQL.getJdbcUrl(), MYSQL.getUsername(), MYSQL.getPassword());
    jdbc = org.mockito.Mockito.spy(new JdbcTemplate(datasource));
    for (String table : List.of("store_selection_batch_items", "store_selection_batches", "store_selection_items", "store_finished_products", "store_accessory_products", "finished_products", "accessory_products", "product_categories", "stores")) {
      jdbc.execute("DROP TABLE IF EXISTS " + table);
    }
    String migration = Files.readString(Path.of("src/main/resources/db/migration/V173__store_selection_center.sql"));
    for (String sql : migration.split(";")) { if (!sql.isBlank()) { jdbc.execute(sql); } }
    jdbc.execute("CREATE TABLE stores(id BIGINT PRIMARY KEY,tenant_id BIGINT,name VARCHAR(60))");
    jdbc.update("INSERT INTO stores VALUES(10,1,'门店甲'),(20,1,'门店乙')");
    jdbc.execute("CREATE TABLE product_categories(id BIGINT,parent_id BIGINT,scope VARCHAR(16),name VARCHAR(60),tenant_id BIGINT,sort_order INT)");
    jdbc.update("INSERT INTO product_categories VALUES(1,NULL,'finished','桌',NULL,0),(2,1,'finished','餐桌',NULL,0),(3,2,'finished','岩板餐桌',NULL,0),(4,3,'finished','白色',NULL,0),(5,NULL,'accessory','桌脚',NULL,0)");
    for (String type : List.of("finished", "accessory")) {
      jdbc.execute("CREATE TABLE " + type + "_products(id BIGINT PRIMARY KEY,name VARCHAR(100),category_id BIGINT,created_at DATETIME(6),total_stock INT,source_status VARCHAR(16),status VARCHAR(16),operations_deleted BOOLEAN,operations_invalidated_at DATETIME(6))");
      jdbc.execute("CREATE TABLE store_" + type + "_products(id BIGINT PRIMARY KEY AUTO_INCREMENT,store_id BIGINT," + type + "_product_id BIGINT,selection_generation BIGINT DEFAULT 0,status VARCHAR(16),UNIQUE(store_id," + type + "_product_id,selection_generation))");
    }
    seed("finished", 1, "餐桌", 4, "2026-01-01 00:00:00");
    seed("accessory", 1, "桌脚", 5, "2026-02-01 00:00:00");
    var scopes = mock(CityPartnerStoreScope.class); when(scopes.require()).thenAnswer(i -> identity.get());
    guard = mock(PermissionGuard.class); when(guard.hasPermission(any())).thenReturn(true);
    finished = mock(StoreFinishedProductService.class);
    var accessory = mock(StoreAccessoryProductService.class);
    when(finished.selectionCenterDetail(anyLong())).thenAnswer(i -> finishedDetail(i.getArgument(0)));
    when(accessory.selectionCenterDetail(anyLong())).thenAnswer(i -> new StoreAccessoryProductService.PoolDetail(i.getArgument(0),"配件","",10,null,List.of(),null,"","桌脚",Map.of(),List.of(),List.of(),List.of(new StoreAccessoryProductService.PoolSku(1L,"金属",10,null,new BigDecimal("12"),"single",Map.of(),null,null,null,null)),Map.of(),"门店级别"));
    when(finished.select(any())).thenAnswer(i -> {
      Long id = ((List<Long>) i.getArgument(0)).getFirst();
      jdbc.update("INSERT INTO store_finished_products(store_id,finished_product_id,status) VALUES(?,?,'warehouse')", identity.get().storeId(), id);
      var view = mock(StoreFinishedProductService.ProductView.class);when(view.id()).thenReturn(id);return List.of(view);
    });
    catalog = new StoreSelectionCatalog(jdbc,scopes,guard,finished,accessory,new ObjectMapper());
    transactions = new DataSourceTransactionManager(datasource);
    targets = org.mockito.Mockito.spy(new com.zdm.platform.storeexit.StoreExitTargetService(jdbc,
        mock(com.zdm.platform.storeexit.StoreExitRecoveryState.class)));
    service = new StoreSelectionService(jdbc,catalog,finished,accessory,transactions,targets);
  }

  @Test void deletionHoldingRootRejectsLateAddAndBatchCreation() throws Exception {
    service.add(context(), "finished", 1L);
    for (boolean join : List.of(false, true)) {
      if (join) { jdbc.update("INSERT INTO stores VALUES(10,1,'门店甲')"); }
      var attempted = new java.util.concurrent.CountDownLatch(1);
      org.mockito.Mockito.doAnswer(call -> { attempted.countDown(); return call.callRealMethod(); }).when(targets).lockStore(10L);
      var pending = new java.util.concurrent.atomic.AtomicReference<java.util.concurrent.Future<?>>();
      try (var executor = Executors.newSingleThreadExecutor()) {
        new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
          jdbc.queryForList("SELECT id FROM stores WHERE id=10 FOR UPDATE");
          pending.set(executor.submit(() -> {
            employee(1,10);
            if (join) { service.join(context(), "late-batch-request-01"); }
            else { service.add(context(), "accessory", 1L); }
          }));
          await(attempted);
          jdbc.update("DELETE FROM store_selection_items WHERE store_id=10");
          jdbc.update("DELETE FROM stores WHERE id=10");
        });
        assertThatThrownBy(() -> pending.get().get(10, java.util.concurrent.TimeUnit.SECONDS))
            .isInstanceOf(java.util.concurrent.ExecutionException.class)
            .hasCauseInstanceOf(org.springframework.security.access.AccessDeniedException.class);
      }
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE store_id=10", Long.class)).isZero();
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_batches WHERE store_id=10", Long.class)).isZero();
    }
  }

  @Test void acceptedAddFinishesBeforeDeletionCapturesAndCleansItsRows() throws Exception {
    var writerLocked = new java.util.concurrent.CountDownLatch(1);
    var deleteAttempted = new java.util.concurrent.CountDownLatch(1);
    org.mockito.Mockito.doAnswer(call -> {
      writerLocked.countDown(); await(deleteAttempted); return finishedDetail(call.getArgument(0));
    }).when(finished).selectionCenterDetail(1L);
    try (var executor = Executors.newFixedThreadPool(2)) {
      var writer = executor.submit(() -> { employee(1,10); service.add(context(),"finished",1L); });
      await(writerLocked);
      var deletion = executor.submit(() -> new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
        deleteAttempted.countDown();
        jdbc.queryForList("SELECT id FROM stores WHERE id=10 FOR UPDATE");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE store_id=10",Long.class)).isEqualTo(1);
        jdbc.update("DELETE FROM store_selection_items WHERE store_id=10");
        jdbc.update("DELETE FROM stores WHERE id=10");
      }));
      writer.get(10,java.util.concurrent.TimeUnit.SECONDS); deletion.get(10,java.util.concurrent.TimeUnit.SECONDS);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE store_id=10",Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM finished_products WHERE id=1",Long.class)).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM stores WHERE id=20",Long.class)).isEqualTo(1);
  }

  @Test void deletionBetweenBatchSnapshotAndItemCommitCannotCreateWarehouseRows() throws Exception {
    service.add(context(),"finished",1L);
    var itemAttempted=new java.util.concurrent.CountDownLatch(1);
    var deletionCommitted=new java.util.concurrent.CountDownLatch(1);
    var calls=new java.util.concurrent.atomic.AtomicInteger();
    org.mockito.Mockito.doAnswer(call -> {
      if (calls.incrementAndGet()==2) { itemAttempted.countDown(); await(deletionCommitted); }
      return call.callRealMethod();
    }).when(targets).lockStore(10L);
    try (var executor=Executors.newSingleThreadExecutor()) {
      var joining=executor.submit(() -> { employee(1,10); return service.join(context(),"deletion-between-items-01"); });
      try {
        await(itemAttempted);
        new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
          jdbc.queryForList("SELECT id FROM stores WHERE id=10 FOR UPDATE");
          jdbc.update("DELETE i FROM store_selection_batch_items i JOIN store_selection_batches b ON b.id=i.batch_id WHERE b.store_id=10");
          jdbc.update("DELETE FROM store_selection_batches WHERE store_id=10");
          jdbc.update("DELETE FROM store_selection_items WHERE store_id=10");
          jdbc.update("DELETE FROM stores WHERE id=10");
        });
      } finally { deletionCommitted.countDown(); }
      assertThatThrownBy(() -> joining.get(10,java.util.concurrent.TimeUnit.SECONDS))
          .isInstanceOf(java.util.concurrent.ExecutionException.class)
          .hasCauseInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE store_id=10",Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_batch_items",Long.class)).isZero();
  }

  @Test void changedBatchSourceAfterMetadataReadIsRejectedBeforeAnyWarehouseWrite() {
    service.add(context(),"finished",1L);
    seed("finished",2,"替换商品",4,"2026-01-01 00:00:00");
    var changed=new java.util.concurrent.atomic.AtomicBoolean();
    org.mockito.Mockito.doAnswer(call -> {
      if (changed.compareAndSet(false,true)) {
        var independent=new org.springframework.transaction.support.TransactionTemplate(transactions);
        independent.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        independent.executeWithoutResult(status -> jdbc.update("UPDATE store_selection_batch_items SET product_id=2 WHERE product_id=1"));
      }
      return call.callRealMethod();
    }).when(jdbc).queryForList(org.mockito.ArgumentMatchers.eq("SELECT id FROM finished_products WHERE id=? FOR UPDATE"),org.mockito.ArgumentMatchers.eq((Object)1L));
    var result=service.join(context(),"changed-batch-source-01");
    assertThat(changed).isTrue(); assertThat(result.successCount()).isZero(); assertThat(result.failureCount()).isEqualTo(1);
    assertThat(result.failures().getFirst().reason()).isEqualTo("选品批次内容已变化，请重新提交");
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products",Long.class)).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items",Long.class)).isEqualTo(1);
  }

  @Test void originalOppositeRootAndSourceOrderReallyDeadlocksInMysql() throws Exception {
    for (String type : List.of("finished","accessory")) {
      var rootHeld=new java.util.concurrent.CountDownLatch(1);
      var sourceHeld=new java.util.concurrent.CountDownLatch(1);
      try (var executor=Executors.newFixedThreadPool(2)) {
        var oldSelection=executor.submit(() -> {
          try {
            new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
              jdbc.queryForList("SELECT id FROM stores WHERE id=10 FOR UPDATE"); rootHeld.countDown(); await(sourceHeld);
              jdbc.queryForList("SELECT id FROM " + type + "_products WHERE id=1 FOR UPDATE");
            }); return false;
          } catch (org.springframework.dao.PessimisticLockingFailureException deadlock) { return true; }
        });
        var upstream=executor.submit(() -> {
          try {
            new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
              jdbc.queryForList("SELECT id FROM " + type + "_products WHERE id=1 FOR UPDATE"); sourceHeld.countDown(); await(rootHeld);
              targets.lockStore(10L);
            }); return false;
          } catch (org.springframework.dao.PessimisticLockingFailureException deadlock) { return true; }
        });
        assertThat(List.of(oldSelection.get(10,java.util.concurrent.TimeUnit.SECONDS),upstream.get(10,java.util.concurrent.TimeUnit.SECONDS)))
            .containsExactlyInAnyOrder(true,false);
      }
    }
  }

  @Test void finishedSelectionUsesSameSourceThenRootOrderAsUpstreamEditing() throws Exception {
    selectionWithUpstreamSourceAndRootLocks("finished");
  }

  @Test void accessorySelectionUsesSameSourceThenRootOrderAsUpstreamEditing() throws Exception {
    selectionWithUpstreamSourceAndRootLocks("accessory");
  }

  private void selectionWithUpstreamSourceAndRootLocks(String type) throws Exception {
    service.add(context(),type,1L);
    // Both repeated add and batch processing must release any earlier root lock before awaiting source.
    for (boolean join : List.of(false,true)) {
      var sourceHeld=new java.util.concurrent.CountDownLatch(1);
      var selectionAttempted=new java.util.concurrent.CountDownLatch(1);
      var selectedThread=new java.util.concurrent.atomic.AtomicReference<Thread>();
      String sourceSql="SELECT id FROM " + type + "_products WHERE id=? FOR UPDATE";
      org.mockito.Mockito.doAnswer(call -> {
        if (Thread.currentThread()==selectedThread.get()) { selectionAttempted.countDown(); }
        return call.callRealMethod();
      }).when(jdbc).queryForList(org.mockito.ArgumentMatchers.eq(sourceSql),org.mockito.ArgumentMatchers.eq((Object)1L));
      try (var executor=Executors.newFixedThreadPool(2)) {
        var upstream=executor.submit(() -> new org.springframework.transaction.support.TransactionTemplate(transactions).executeWithoutResult(status -> {
          jdbc.queryForList(sourceSql,1L); sourceHeld.countDown(); await(selectionAttempted);
          assertThat(targets.lockStore(10L)).isTrue();
          jdbc.update("UPDATE " + type + "_products SET name='供应链编辑后' WHERE id=1");
          if (join) {
            // Existing listing matches the reported stale-personal-list case. The batch must not duplicate it.
            jdbc.update("INSERT INTO store_"+type+"_products(store_id,"+type+"_product_id,status) VALUES(10,1,'warehouse')");
          }
        }));
        await(sourceHeld);
        var selection=executor.submit(() -> {
          employee(1,10); selectedThread.set(Thread.currentThread());
          if (join) { var result=service.join(context(),"source-root-order-"+type); assertThat(result.successCount()).isZero(); assertThat(result.failureCount()).isEqualTo(1); }
          else { service.add(context(),type,1L); }
        });
        upstream.get(10,java.util.concurrent.TimeUnit.SECONDS); selection.get(10,java.util.concurrent.TimeUnit.SECONDS);
      }
      assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_selection_items WHERE store_id=10 AND product_type=?",Long.class,type)).isEqualTo(1);
      assertThat(jdbc.queryForObject("SELECT name FROM "+type+"_products WHERE id=1",String.class)).isEqualTo("供应链编辑后");
    }
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_"+type+"_products WHERE store_id=10",Long.class)).isEqualTo(1);
  }

  private static void await(java.util.concurrent.CountDownLatch latch) {
    try { assertThat(latch.await(10,java.util.concurrent.TimeUnit.SECONDS)).isTrue(); }
    catch (InterruptedException error) { Thread.currentThread().interrupt(); throw new IllegalStateException(error); }
  }

  private StoreFinishedProductService.PoolDetail finishedDetail(Long id) {
    return new StoreFinishedProductService.PoolDetail(id,"餐桌","",10,null,List.of(),null,"","餐桌",Map.of(),List.of(),List.of(),List.of(new StoreFinishedProductService.PoolSku(1L,"白色",10,new BigDecimal("99"),new BigDecimal("20"),"single",Map.of(),null,null,null,null)),Map.of(),"门店级别");
  }
  private void seed(String type,long id,String name,long category,String time) {
    jdbc.update("INSERT INTO " + type + "_products VALUES(?,?,?,?,10,'selling','selling',FALSE,NULL)",id,name,category,time);
  }
  private String context() { return StoreSelectionCatalog.key(identity.get()); }
  private void employee(long account,long store) { identity.set(new CityPartnerStoreScope.Store(1L,store,1L,account,"员工")); }

  @Test void mixedCatalogSortLiteralSearchCategoriesAndScope() {
    var all = catalog.products(context(),"",List.of(),List.of(),null,null,1,20);
    assertThat(all.total()).isEqualTo(2); assertThat(all.records().getFirst().type()).isEqualTo("accessory");
    assertThat(catalog.products(context(),"1",List.of(),List.of(),null,null,1,20).total()).isZero();
    assertThat(catalog.products(context(),"%",List.of(),List.of(),null,null,1,20).total()).isZero();
    for (long category : List.of(1L,2L,3L,4L)) {
      assertThat(catalog.products(context(),"",List.of(),List.of(),"finished",category,1,20).total()).isEqualTo(1);
    }
    assertThatThrownBy(() -> catalog.products(context(),"",List.of(),List.of(),"accessory",1L,1,20)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> catalog.counts("1:20:1")).isInstanceOf(org.springframework.security.access.AccessDeniedException.class);
    assertThat(catalog.detail(context(),"finished",1L).information().get("skus").toString()).doesNotContain("guidePrice");
    jdbc.update("UPDATE finished_products SET total_stock=0,source_status='soldOut' WHERE id=1");
    var sold=catalog.products(context(),"餐桌",List.of(),List.of(),null,null,1,20).records().getFirst();
    assertThat(sold.soldOut()).isTrue();assertThat(sold.canAdd()).isFalse();
  }

  @Test void personalPersistenceOrderingRemovalAndPermissionChanges() {
    service.add(context(),"finished",1L);service.add(context(),"finished",1L);
    assertThat(catalog.counts(context()).get("finished")).isEqualTo(1);
    Long selection=catalog.selection(context(),"finished",1,5).records().getFirst().selectionId();
    employee(2,10);assertThat(catalog.counts(context()).get("finished")).isZero();
    assertThatThrownBy(() -> service.remove(context(),selection)).isInstanceOf(IllegalArgumentException.class);
    service.add(context(),"finished",1L);assertThat(catalog.counts(context()).get("finished")).isEqualTo(1);
    when(guard.hasPermission(StoreSelectionCatalog.FINISHED_PERMISSION)).thenReturn(false);
    assertThat(catalog.products(context(),"",List.of("finished"),List.of(),null,null,1,20).records().getFirst().canAdd()).isFalse();
    var result=service.join(context(),"permission-request-001");assertThat(result.failureCount()).isEqualTo(1);
    assertThat(result.failures().getFirst().code()).isEqualTo("NO_TYPE_PERMISSION");
  }

  @Test void selectionTimeIsStableUntilRemovedAndReadded() {
    seed("finished",2,"餐椅",4,"2026-01-01 00:00:00");
    service.add(context(),"finished",1L); service.add(context(),"finished",2L);
    jdbc.update("UPDATE store_selection_items SET added_at='2020-01-01 00:00:00' WHERE product_id=1");
    jdbc.update("UPDATE store_selection_items SET added_at='2020-02-01 00:00:00' WHERE product_id=2");
    service.add(context(),"finished",1L);
    var records=catalog.selection(context(),"finished",1,5).records();
    assertThat(records).extracting(StoreSelectionCatalog.Product::id).containsExactly(2L,1L);
    service.remove(context(),records.get(1).selectionId()); service.add(context(),"finished",1L);
    assertThat(catalog.selection(context(),"finished",1,5).records().getFirst().id()).isEqualTo(1L);
    assertThatThrownBy(() -> catalog.products(context(),"",List.of(),List.of(),null,1L,1,20)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test void partialFailureReplayAndRecycleCountAsAdded() {
    seed("finished",2,"餐椅",4,"2026-03-01 00:00:00");
    service.add(context(),"finished",1L);service.add(context(),"finished",2L);
    jdbc.update("UPDATE finished_products SET source_status='offShelf' WHERE id=2");
    var result=service.join(context(),"partial-request-0001");
    assertThat(result.total()).isEqualTo(2);assertThat(result.successCount()).isEqualTo(1);assertThat(result.failureCount()).isEqualTo(1);
    assertThat(catalog.counts(context()).get("finished")).isEqualTo(1);
    assertThat(service.join(context(),"partial-request-0001")).isEqualTo(result);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products",Long.class)).isEqualTo(1);
    employee(2,10);jdbc.update("UPDATE store_finished_products SET status='recycle'");
    assertThat(catalog.products(context(),"餐桌",List.of(),List.of("added"),null,null,1,20).total()).isEqualTo(1);
    assertThatThrownBy(() -> service.result(context(),result.id())).isInstanceOf(IllegalArgumentException.class);
  }

  @Test void concurrentEmployeesOnlyOneWarehouseWriteAndOtherStoreIndependent() throws Exception {
    service.add(context(),"finished",1L);employee(2,10);service.add(context(),"finished",1L);
    try(var executor=Executors.newFixedThreadPool(2)) {
      var a=executor.submit(() -> {employee(1,10);return service.join(context(),"concurrent-request-a1");});
      var b=executor.submit(() -> {employee(2,10);return service.join(context(),"concurrent-request-b2");});
      var results=List.of(a.get(),b.get());assertThat(results.stream().mapToLong(StoreSelectionService.Result::successCount).sum()).isEqualTo(1);
      assertThat(results.stream().mapToLong(StoreSelectionService.Result::failureCount).sum()).isEqualTo(1);
      assertThat(results.stream().flatMap(r->r.failures().stream()).map(StoreSelectionService.Failure::reason)).containsExactly("该商品已加入门店，请勿重复添加。");
    }
    employee(1,20);service.add(context(),"finished",1L);assertThat(service.join(context(),"another-store-000001").successCount()).isEqualTo(1);
  }

  @Test void sourceFailureRollsBackOnlyThatItemAndMoreThanOneHundredNotTruncated() {
    for(long id=2;id<=102;id++){seed("finished",id,"商品",4,"2026-01-01 00:00:00");}
    for(long id=1;id<=102;id++){service.add(context(),"finished",id);}
    org.mockito.Mockito.doAnswer(i->{jdbc.update("INSERT INTO store_finished_products(store_id,finished_product_id,status) VALUES(10,2,'warehouse')");throw new IllegalArgumentException("商品当前不可用");}).when(finished).select(List.of(2L));
    var result=service.join(context(),"large-request-000001");assertThat(result.total()).isEqualTo(102);assertThat(result.successCount()).isEqualTo(101);assertThat(result.failureCount()).isEqualTo(1);
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM store_finished_products WHERE finished_product_id=2",Long.class)).isZero();
  }
}
