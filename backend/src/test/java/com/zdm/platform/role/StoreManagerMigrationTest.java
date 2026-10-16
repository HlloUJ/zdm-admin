package com.zdm.platform.role;

import static org.assertj.core.api.Assertions.assertThat;
import java.sql.DriverManager;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@Testcontainers(disabledWithoutDocker=true)
class StoreManagerMigrationTest {
  @Container private static final MySQLContainer<?> MYSQL=new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("manager_migration").withUsername("test").withPassword("test");
  @Test void upgradesExistingRoleInPlaceAndBackfillsMissingStoresWithoutClearingGrantsOrLinks() throws Exception {
    Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).target("160").load().migrate();
    try (var connection=DriverManager.getConnection(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword());
         var s=connection.createStatement()) {
      s.executeUpdate("INSERT INTO stores(id,tenant_id,name,type) VALUES(991801,1,'迁移有店长','cityPartner'),(991802,1,'迁移无店长','slabSupplier')");
      s.executeUpdate("INSERT INTO roles(id,client_code,tenant_id,store_id,name,code,function_permissions,remark) VALUES(991801,'admin',1,991801,'店长','OLD_MANAGER_CODE','store.customer-management.daily.view','原备注')");
      s.executeUpdate("INSERT INTO account_roles(account_id,role_id,client_code,tenant_id,store_id) VALUES(1,991801,'admin',1,991801)");
      s.executeUpdate("INSERT INTO employees(id,account_id,client_code,tenant_id,store_id,role_ids,status) VALUES(991801,1,'admin',1,991801,'991801','enabled')");
      s.executeUpdate("INSERT INTO store_price_rules(tenant_id,store_id,kind,scope,role_id,target_key,coefficient,created_by_account_id) VALUES(1,991801,'discount','finished',991801,991801,0.8,1)");
      Flyway.configure().dataSource(MYSQL.getJdbcUrl(),MYSQL.getUsername(),MYSQL.getPassword()).target("161").load().migrate();
      try(var rows=s.executeQuery("SELECT code,builtin_key,function_permissions,remark FROM roles WHERE id=991801")) {
        assertThat(rows.next()).isTrue();assertThat(rows.getString(1)).isEqualTo("OLD_MANAGER_CODE");
        assertThat(rows.getString(2)).isEqualTo("STORE_MANAGER");
        assertThat(rows.getString(3)).isEqualTo("store.customer-management.daily.view");assertThat(rows.getString(4)).isEqualTo("原备注");
      }
      try(var rows=s.executeQuery("SELECT COUNT(*) FROM account_roles WHERE role_id=991801")) { rows.next();assertThat(rows.getInt(1)).isEqualTo(1); }
      try(var rows=s.executeQuery("SELECT role_ids FROM employees WHERE id=991801")) { rows.next();assertThat(rows.getString(1)).isEqualTo("991801"); }
      try(var rows=s.executeQuery("SELECT role_id FROM store_price_rules WHERE store_id=991801")) { rows.next();assertThat(rows.getLong(1)).isEqualTo(991801); }
      try(var rows=s.executeQuery("SELECT function_permissions FROM roles WHERE store_id=991802 AND builtin_key='STORE_MANAGER'")) { assertThat(rows.next()).isTrue();assertThat(rows.getString(1)).isEmpty();assertThat(rows.next()).isFalse(); }
    }
  }
}
