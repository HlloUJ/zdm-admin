package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class ProductStateActivityMigrationTest {
 @Container static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
  .withDatabaseName("state_activity").withUsername("test").withPassword("test");
 @Test void preservesHistoryAndTracksOnlyRealTransitionsAcrossClients() throws Exception {
  var configuration=Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());
  configuration.target("156").load().migrate();
  try(var connection=DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());var statement=connection.createStatement()) {
   statement.executeUpdate("INSERT INTO finished_products(id,name,sku,status,source_status,total_stock,operations_deleted,created_by_account_id) VALUES(99701,'状态测试','STATE-99701','selling','selling',2,FALSE,1)");
   statement.executeUpdate("INSERT INTO finished_operation_logs(product_id,product_name,merchant_code,operation_summary,operation_type,business_client_code,operator_client_code,before_status,after_status,operator_account_id,operator_name,change_details,operated_at) VALUES(99701,'状态测试','STATE-99701','上架','SHELF','admin','admin','warehouse','selling',1,'测试','{}','2020-01-02 12:00:00')");
   statement.executeUpdate("INSERT INTO stores(id,tenant_id,name,type,status) VALUES(99741,1,'历史状态门店','cityPartner','enabled')");
   statement.executeUpdate("INSERT INTO store_finished_products(id,tenant_id,store_id,finished_product_id,status,selected_by_account_id) VALUES(99741,1,99741,99701,'offShelf',1)");
   statement.executeUpdate("INSERT INTO store_finished_operation_logs(tenant_id,store_id,listing_id,finished_product_id,product_name,operation_type,operation_summary,before_status,after_status,operator_account_id,operator_name,operated_at) VALUES(1,99741,99741,99701,'历史商品','SOURCE_UPDATE','价格缺失自动下架','selling','offShelf',1,'历史操作员','2020-01-02 20:00:00')");
   configuration.target("157").load().migrate();
   assertThat(value(statement,"SELECT operator_client_code FROM product_state_activity WHERE kind='store-finished' AND record_id=99741")).isEqualTo("supply-chain");
   assertThat(value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='store-finished' AND record_id=99741")).startsWith("2020-01-02 12:00:00");
   var activity=new ProductStateActivityService(new org.springframework.jdbc.core.JdbcTemplate(new org.springframework.jdbc.datasource.DriverManagerDataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword())));
   assertThat(value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).startsWith("2020-01-02");
   statement.executeUpdate("UPDATE finished_products SET name='普通编辑' WHERE id=99701");
   activity.record("finished","admin",99701L,"selling","selling",1L,"admin");
   assertThat(value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).startsWith("2020-01-02");
   statement.executeUpdate("UPDATE finished_products SET source_status='offShelf' WHERE id=99701");
   activity.record("finished","supply-chain",99701L,"selling","offShelf",1L,"supply-chain");
   assertThat(value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).startsWith("2020-01-02");
   statement.executeUpdate("UPDATE finished_products SET status='offShelf' WHERE id=99701");
   activity.record("finished","admin",99701L,"selling","offShelf",1L,"admin");
   assertThat(value(statement,"SELECT operator_account_id FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).isEqualTo("1");
   String time=value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701");
   statement.executeUpdate("UPDATE finished_products SET status='offShelf',operations_invalidated_at=NOW() WHERE id=99701");
   assertThat(value(statement,"SELECT occurred_at FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).isEqualTo(time);
   statement.executeUpdate("UPDATE finished_products SET operations_deleted=TRUE WHERE id=99701");
   statement.executeUpdate("UPDATE finished_products SET operations_deleted=FALSE,status='warehouse' WHERE id=99701");
   activity.record("finished","admin",99701L,null,"warehouse",1L,"supply-chain");
   assertThat(value(statement,"SELECT operator_client_code FROM product_state_activity WHERE kind='finished' AND business_client_code='admin' AND record_id=99701")).isEqualTo("supply-chain");
  }
 }
 private static String value(java.sql.Statement statement,String sql) throws Exception {
  try(var result=statement.executeQuery(sql)) { assertThat(result.next()).isTrue(); return result.getString(1); }
 }
}
