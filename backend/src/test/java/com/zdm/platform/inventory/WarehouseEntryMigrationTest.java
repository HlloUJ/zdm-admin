package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class WarehouseEntryMigrationTest {
 @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create().withDatabaseName("warehouse_entry_migration");
 @Test void upgradeUsesLatestRealIngressAndPreservesProductsLogsAndIndependentClientScopes() throws Exception {
  Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).target("164").load().migrate();
  try(var connection=DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());var statement=connection.createStatement()) {
   statement.executeUpdate("INSERT INTO finished_products(id,name,status,source_status,off_shelf_reason,source_off_shelf_reason) VALUES(99171,'迁移商品','warehouse','warehouse','旧运营下架原因','真实供应链下架原因'),(99172,'未知入库商品','warehouse','warehouse',NULL,'保留但不推断来源的说明')");
   statement.executeUpdate("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,occurred_at) VALUES('finished','supply-chain',99171,'warehouse','2026-10-20'),('finished','admin',99171,'warehouse','2026-10-21'),('finished','supply-chain',99172,'warehouse',NULL)");
   statement.executeUpdate("INSERT INTO finished_operation_logs(product_id,product_name,business_client_code,operation_type,operation_summary,before_status,after_status,standard_reason,detail_reason,change_details,operator_name,operated_at) VALUES(99171,'迁移商品','supply-chain','OFF_SHELF','下架','selling','warehouse','真实供应链下架原因','供应链说明',JSON_OBJECT(),'供应链操作人','2026-10-20'),(99171,'迁移商品','admin','OFF_SHELF','旧下架','selling','warehouse','旧运营下架原因','旧说明',JSON_OBJECT(),'运营操作人','2026-10-19'),(99171,'迁移商品','admin','DELETE_TO_RECYCLE','删除','warehouse','recycle',NULL,NULL,JSON_OBJECT(),'运营操作人','2026-10-20'),(99171,'迁移商品','admin','RESTORE','恢复','recycle','warehouse',NULL,NULL,JSON_OBJECT(),'恢复人','2026-10-21'),(99171,'迁移商品','admin','UPDATE','普通编辑','warehouse','warehouse',NULL,NULL,JSON_OBJECT(),'编辑人','2026-10-22')");
   statement.executeUpdate("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,occurred_at) VALUES('store-finished','store',99173,'warehouse','2026-10-23')");
   statement.executeUpdate("INSERT INTO store_finished_operation_logs(tenant_id,store_id,listing_id,finished_product_id,product_name,operation_type,operation_summary,before_status,after_status,change_details,operator_name,operated_at) VALUES(1,99173,99173,99171,'门店迁移商品','OFF_SHELF','下架','selling','warehouse',JSON_OBJECT('下架原因','门店价格调整','详细说明','门店说明'),'门店人','2026-10-23 08:00:00')");
   String productsBefore;try(var rows=statement.executeQuery("SELECT CONCAT(name,':',created_at) FROM finished_products WHERE id=99171")){rows.next();productsBefore=rows.getString(1);}
   Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).load().migrate();
   try(var rows=statement.executeQuery("SELECT business_client_code,warehouse_entry_type,warehouse_entry_reason,warehouse_entry_detail FROM product_state_activity WHERE kind='finished' AND record_id=99171 ORDER BY business_client_code")) {
    assertThat(rows.next()).isTrue(); assertThat(rows.getString(1)).isEqualTo("admin"); assertThat(rows.getString(2)).isEqualTo("recycleRestore"); assertThat(rows.getString(3)).isNull(); assertThat(rows.getString(4)).isNull();
    assertThat(rows.next()).isTrue(); assertThat(rows.getString(1)).isEqualTo("supply-chain"); assertThat(rows.getString(2)).isEqualTo("offShelf"); assertThat(rows.getString(3)).isEqualTo("真实供应链下架原因"); assertThat(rows.getString(4)).isEqualTo("供应链说明");
   }
   try(var rows=statement.executeQuery("SELECT warehouse_entry_type,warehouse_entry_reason FROM product_state_activity WHERE kind='store-finished' AND record_id=99173")){rows.next();assertThat(rows.getString(1)).isEqualTo("offShelf");assertThat(rows.getString(2)).isEqualTo("门店价格调整");}
   try(var rows=statement.executeQuery("SELECT warehouse_entry_type,warehouse_entry_reason FROM product_state_activity WHERE kind='finished' AND business_client_code='supply-chain' AND record_id=99172")){rows.next();assertThat(rows.getString(1)).isNull();assertThat(rows.getString(2)).isEqualTo("保留但不推断来源的说明");}
   try(var rows=statement.executeQuery("SELECT COUNT(*) FROM finished_operation_logs WHERE product_id=99171")){rows.next();assertThat(rows.getInt(1)).isEqualTo(5);}
   try(var rows=statement.executeQuery("SELECT CONCAT(name,':',created_at) FROM finished_products WHERE id=99171")){rows.next();assertThat(rows.getString(1)).isEqualTo(productsBefore);}
   try(var rows=statement.executeQuery("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN ('finished_products','accessory_products','store_finished_products','store_accessory_products') AND column_name IN ('off_shelf_reason','off_shelf_detail','off_shelf_at','source_off_shelf_reason','source_off_shelf_detail','source_off_shelf_at')")){rows.next();assertThat(rows.getInt(1)).isZero();}
  }
 }
}
