package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker = true)
class ProductAttributeVersionMigrationTest {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("product_binding_migration_test");
  @Test void bindsOnlyAuditedMatchingRecordsWithoutRewritingBusinessData() throws Exception {
    var config=Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());
    config.target("165").load().migrate();
    try(var connection=DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());var s=connection.createStatement()) {
      s.executeUpdate("INSERT INTO product_categories(id,name,scope) VALUES(110,'旧配件类目','accessory')");
      s.executeUpdate("INSERT INTO category_template_versions(id,category_id,version_no,state,revision,content) VALUES(34,110,1,'published',3,'[{\"attributeId\":53},{\"attributeId\":55},{\"attributeId\":56},{\"attributeId\":57}]')");
      s.executeUpdate("INSERT INTO product_attributes(id,scope,name,value_type,attribute_role) VALUES(53,'shared','原名称1','text','product'),(55,'shared','原名称2','number','product')");
      String order="{\"product\":[\"53\",\"55\"],\"sales\":[\"attribute_56\",\"attribute_57\"]}";
      s.executeUpdate("INSERT INTO accessory_products(id,name,category_id,attribute_display_order,created_at,updated_at) VALUES(6,'应补绑',110,'"+order+"','2026-10-01','2026-10-02'),(7,'不应猜版本',110,'"+order+"','2026-10-01','2026-10-02')");
      s.executeUpdate("INSERT INTO accessory_product_attribute_entries(accessory_product_id,attribute_id,attribute_name,value) VALUES(6,53,'原名称1','旧值'),(6,55,'原名称2','历史文本'),(7,53,'原名称1','旧值'),(7,55,'原名称2','历史文本')");
      s.executeUpdate("INSERT INTO accessory_product_variants(id,accessory_product_id,variant_label,sales_attributes,stock) VALUES(9001,6,'规格','{\"attribute_56\":\"原值\",\"attribute_57\":\"选项1\"}',3)");
      s.executeUpdate("INSERT INTO accessory_operation_logs(product_id,product_name,operation_type,operation_summary,operator_name,operated_at,business_client_code,change_details) VALUES(6,'应补绑','CREATE','创建','原人员',NOW(),'supply-chain',JSON_OBJECT('字段顺序',JSON_OBJECT('after',CAST('"+order+"' AS JSON))))");
      String before;
      try(var r=s.executeQuery("SELECT CAST(JSON_OBJECT('name',name,'created',created_at,'updated',updated_at,'order',attribute_display_order,'status',status,'stock',total_stock) AS CHAR) FROM accessory_products WHERE id=6")){r.next();before=r.getString(1);}
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).load().migrate();
      try(var r=s.executeQuery("SELECT template_version_id,template_revision,JSON_LENGTH(attribute_template_snapshot),CAST(JSON_OBJECT('name',name,'created',created_at,'updated',updated_at,'order',attribute_display_order,'status',status,'stock',total_stock) AS CHAR) FROM accessory_products WHERE id=6")) {
        assertThat(r.next()).isTrue();assertThat(r.getLong(1)).isEqualTo(34);assertThat(r.getInt(2)).isEqualTo(3);assertThat(r.getInt(3)).isEqualTo(4);assertThat(r.getString(4)).isEqualTo(before);
      }
      try(var r=s.executeQuery("SELECT template_version_id FROM accessory_products WHERE id=7")){r.next();assertThat(r.getObject(1)).isNull();}
      try(var r=s.executeQuery("SELECT value FROM accessory_product_attribute_entries WHERE accessory_product_id=6 AND attribute_id=55")){r.next();assertThat(r.getString(1)).isEqualTo("历史文本");}
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).load().migrate();
      try(var r=s.executeQuery("SELECT COUNT(*) FROM accessory_operation_logs WHERE product_id=6")){r.next();assertThat(r.getInt(1)).isEqualTo(1);}
    }
  }
}
