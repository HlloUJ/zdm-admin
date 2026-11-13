package com.zdm.platform.catalog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.store.StoreCategory;
import com.zdm.platform.store.StoreCategoryCreateRequest;
import com.zdm.platform.store.StoreCategoryService;
import com.zdm.platform.store.StoreCategorySortRequest;
import com.zdm.platform.store.StoreCategoryUpdateRequest;
import com.zdm.platform.support.SpringContainerTestSupport;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class CategoryProductCountRollupTest extends SpringContainerTestSupport {
  @Container private static final MySQLContainer<?> MYSQL = com.zdm.platform.support.MySqlTestDatabase.create()
      .withDatabaseName("category_rollup_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  @Autowired private JdbcTemplate jdbc;
  @Autowired private org.mybatis.spring.SqlSessionTemplate sqlSession;
  @Autowired private ProductCategoryService categories;
  @Autowired private StoreCategoryService storeCategories;

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
  }

  @AfterEach
  void clearIdentity() {
    SecurityContextHolder.clearContext();
  }

  private void identity(Long storeId) {
    var identity = new CurrentIdentity(1L, 1L, 1L, null, "admin", 1L, storeId,
        "分类计数测试", "all", List.of("SUPER_ADMIN"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(identity, null, List.of()));
  }

  private void category(long id, Long parentId, String scope) {
    jdbc.update("INSERT INTO product_categories(id,parent_id,scope,name,product_count,status,created_by_account_id) VALUES(?,?,?,?,99,'enabled',1)",
        id, parentId, scope, "分类" + id);
  }

  private void product(String scope, long id, Long categoryId) {
    jdbc.update("INSERT INTO " + scope + "_products(id,category_id,name,sku,total_stock,status) VALUES(?,?,?,?,100,'warehouse')",
        id, categoryId, "商品" + id, "ROLLUP-" + id);
  }

  private int count(long id, String scope) {
    return categories.listNewestFirst(List.of(scope)).stream()
        .filter(category -> category.getId() == id).findFirst().orElseThrow().getProductCount();
  }

  private int storeCount(long id, String scope) {
    return storeCategories.listOrdered(scope).stream()
        .filter(category -> category.getId() == id).findFirst().orElseThrow().getProductCount();
  }

  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory"})
  @Transactional
  void platformCountsRollUpFourLevelsAndFollowEditsMovesAndDeletions(String scope) {
    identity(null);
    category(9601001, null, scope);
    category(9601002, 9601001L, scope);
    category(9601003, 9601002L, scope);
    category(9601004, 9601003L, scope);
    category(9601005, 9601002L, scope);
    category(9601006, null, scope);
    product(scope, 9601011, 9601001L);
    product(scope, 9601012, 9601002L);
    product(scope, 9601013, 9601002L);
    product(scope, 9601014, 9601004L);
    product(scope, 9601015, 9601004L);
    product(scope, 9601016, 9601005L);
    assertThat(count(9601001, scope)).isEqualTo(6);
    assertThat(count(9601002, scope)).isEqualTo(5);
    assertThat(count(9601003, scope)).isEqualTo(2);
    assertThat(count(9601004, scope)).isEqualTo(2);
    assertThat(count(9601005, scope)).isEqualTo(1);
    assertThat(count(9601006, scope)).isZero();
    assertThat(jdbc.queryForObject("SELECT product_count FROM product_categories WHERE id=9601001", Integer.class)).isEqualTo(99);

    jdbc.update("INSERT INTO accounts(id,phone,display_name,status) VALUES(9609001,'15926629991','其他分类创建人','enabled')");
    jdbc.update("UPDATE product_categories SET created_by_account_id=9609001 WHERE id=9601004");
    // JDBC fixtures bypass MyBatis cache invalidation; model the next request with a fresh session cache.
    sqlSession.clearCache();
    assertThat(categories.getById(9601004L).getCreatedByAccountId()).isEqualTo(9609001L);
    var restrictedIdentity = new CurrentIdentity(1L, 1L, 1L, null, "admin", 1L, null,
        "仅本人分类", "self", List.of(), List.of("self"));
    SecurityContextHolder.getContext().setAuthentication(
        new UsernamePasswordAuthenticationToken(restrictedIdentity, null, List.of()));
    assertThat(count(9601001, scope)).isEqualTo(4);
    jdbc.update("UPDATE product_categories SET created_by_account_id=1 WHERE id=9601004");
    sqlSession.clearCache();
    identity(null);

    ProductCategory payload = new ProductCategory();
    payload.setScope(scope);
    payload.setName("累计数量编辑测试");
    payload.setSortOrder(2);
    payload.setStatus("disabled");
    payload.setProductCount(999);
    assertThat(categories.updateCategory(9601001L, payload).getProductCount()).isEqualTo(6);
    assertThat(jdbc.queryForObject("SELECT product_count FROM product_categories WHERE id=9601001", Integer.class)).isEqualTo(1);
    assertThat(count(9601001, scope)).isEqualTo(6);
    assertThatThrownBy(() -> categories.deleteCategory(9601001L)).hasMessageContaining("下级分类");
    assertThatThrownBy(() -> categories.deleteCategory(9601004L)).hasMessageContaining("已关联商品");

    jdbc.update("UPDATE " + scope + "_products SET category_id=9601005 WHERE id=9601014");
    assertThat(count(9601001, scope)).isEqualTo(6);
    assertThat(count(9601003, scope)).isEqualTo(1);
    assertThat(count(9601005, scope)).isEqualTo(2);
    jdbc.update("DELETE FROM " + scope + "_products WHERE id=9601014");
    assertThat(count(9601001, scope)).isEqualTo(5);
  }

  private void storeCategory(long id, long storeId, Long parentId, String scope) {
    jdbc.update("INSERT INTO store_categories(id,store_id,parent_id,scope,name,sort_order,product_count,status,created_by_account_id) VALUES(?,?,?,?,?,1,99,'enabled',1)",
        id, storeId, parentId, scope, "门店分类" + id);
  }

  private void listing(String scope, long id, long storeId, long categoryId, long productId) {
    jdbc.update("INSERT INTO store_" + scope + "_products(id,tenant_id,store_id,store_category_id," + scope
        + "_product_id,status,selected_by_account_id) VALUES(?,1,?,?,?,'warehouse',1)", id, storeId, categoryId, productId);
  }

  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory"})
  @Transactional
  void storeCountsStayScopedAndNeverPersistSubtreeTotalsDuringCategoryWrites(String scope) {
    for (long storeId : List.of(9602001L, 9602002L)) {
      jdbc.update("INSERT INTO stores(id,tenant_id,name,type,status) VALUES(?,1,?,'cityPartner','enabled')", storeId, "计数门店" + storeId);
    }
    identity(9602001L);
    storeCategory(9602101, 9602001, null, scope);
    storeCategory(9602102, 9602001, 9602101L, scope);
    storeCategory(9602103, 9602001, 9602102L, scope);
    storeCategory(9602104, 9602001, 9602101L, scope);
    storeCategory(9602105, 9602001, null, scope);
    storeCategory(9602201, 9602002, null, scope);
    String otherScope = "finished".equals(scope) ? "accessory" : "finished";
    storeCategory(9602301, 9602001, null, otherScope);
    for (int index = 0; index < 5; index++) {
      long productId = 9602401L + index;
      product(scope, productId, null);
      long categoryId = List.of(9602101L, 9602102L, 9602103L, 9602103L, 9602104L).get(index);
      listing(scope, productId, 9602001, categoryId, productId);
    }
    listing(scope, 9602501, 9602002, 9602201, 9602401);
    assertThat(storeCount(9602101, scope)).isEqualTo(5);
    assertThat(storeCount(9602102, scope)).isEqualTo(3);
    assertThat(storeCount(9602103, scope)).isEqualTo(2);
    assertThat(storeCount(9602105, scope)).isZero();
    assertThat(storeCategories.listOrdered(scope)).extracting(StoreCategory::getId)
        .doesNotContain(9602201L, 9602301L);
    assertThat(storeCategories.updateCategory(9602101L, scope,
        new StoreCategoryUpdateRequest("已编辑父分类", null)).getProductCount()).isEqualTo(5);
    assertThat(storeCategories.updateStatus(9602101L, scope, "disabled").getProductCount()).isEqualTo(5);
    var sorted = storeCategories.sortCategories(new StoreCategorySortRequest(scope, null, List.of(9602105L, 9602101L)));
    assertThat(sorted.stream().filter(category -> category.getId() == 9602101L).findFirst().orElseThrow().getProductCount()).isEqualTo(5);
    storeCategories.createCategory(new StoreCategoryCreateRequest(scope, null, "新增根分类", "enabled", false));
    assertThat(jdbc.queryForObject("SELECT product_count FROM store_categories WHERE id=9602101", Integer.class)).isEqualTo(1);
    assertThatThrownBy(() -> storeCategories.deleteCategory(9602101L, scope)).hasMessageContaining("下级分类");
    assertThatThrownBy(() -> storeCategories.deleteCategory(9602103L, scope)).hasMessageContaining("已关联商品");
    jdbc.update("UPDATE store_" + scope + "_products SET store_category_id=9602104 WHERE id=9602403");
    assertThat(storeCount(9602101, scope)).isEqualTo(5);
    assertThat(storeCount(9602102, scope)).isEqualTo(2);
    jdbc.update("DELETE FROM store_" + scope + "_products WHERE id=9602403");
    assertThat(storeCount(9602101, scope)).isEqualTo(4);
    identity(9602002L);
    assertThat(storeCount(9602201, scope)).isEqualTo(1);
  }
}
