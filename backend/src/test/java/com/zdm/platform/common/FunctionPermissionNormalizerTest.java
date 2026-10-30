package com.zdm.platform.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class FunctionPermissionNormalizerTest {
  @Test
  void productGlobalEntriesNeverImplyViewsLogsOrShelf() {
    for (String module : List.of("finished-stock-management", "accessory-management", "slab-management")) {
      String prefix = "supply-chain." + module;
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".publish"))).containsExactly(prefix + ".publish");
      for (String scope : List.of("warehouse", "selling")) {
        assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + "." + scope + ".publish")))
            .containsExactly(prefix + "." + scope + ".view", prefix + ".publish");
      }
    }
    for (String module : List.of("finished-stock-management", "accessory-management")) {
      String prefix = "store." + module;
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".select"))).containsExactly(prefix + ".select");
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".warehouse.select")))
          .containsExactly(prefix + ".warehouse.view", prefix + ".select");
    }
    assertThat(FunctionPermissionNormalizer.normalize(List.of("admin.slab-management.warehouse.edit")))
        .containsExactly("admin.slab-management.warehouse.view", "admin.slab-management.warehouse.edit");
  }

  @Test
  void operationsBatchShelfIsGlobalWithoutGrantingSingleShelfOrViews() {
    for (String module : List.of("finished-stock-management", "accessory-management", "slab-management")) {
      String prefix = "admin." + module;
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".batch-shelf")))
          .containsExactly(prefix + ".batch-shelf");
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".warehouse.batch-shelf")))
          .containsExactly(prefix + ".warehouse.view", prefix + ".warehouse.batch-shelf", prefix + ".batch-shelf");
    }
  }

  @Test
  void terminalAllBatchGlobalGrantsAndLegacyAliasesDoNotGrantOtherActions() {
    for (String prefix : List.of("supply-chain.finished-stock-management", "supply-chain.accessory-management",
        "supply-chain.slab-management", "store.finished-stock-management", "store.accessory-management")) {
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix+".batch-shelf"))).containsExactly(prefix+".batch-shelf");
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix+".warehouse.batch-shelf")))
          .containsExactly(prefix+".warehouse.view",prefix+".warehouse.batch-shelf",prefix+".batch-shelf");
    }
    assertThat(FunctionPermissionNormalizer.isProductGlobalAction("store.slab-management.batch-shelf")).isFalse();
  }

  @Test
  void retiredStorePricePermissionsNeverExpandIntoNewGrants() {
    String retired = "store.price-configuration.view,store.price-configuration.create,"
        + "store.price-configuration.edit,store.price-configuration.toggle-status,store.price-configuration.delete";
    assertThat(FunctionPermissionNormalizer.normalize(List.of(retired))).isEmpty();
    assertThat(FunctionPermissionNormalizer.normalize(List.of(retired,
        "store.price-configuration.discount.finished.edit")))
        .containsExactly("store.price-configuration.discount.finished.view",
            "store.price-configuration.discount.finished.edit");
  }

  @Test
  void retiredSingleCustomerAssignmentNeverGrantsEditOrDropsBatchAssignment() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of("store.customer-management.daily.assign",
        "store.customer-management.archived.assign"))).isEmpty();
    assertThat(FunctionPermissionNormalizer.normalize(List.of("store.customer-management.daily.assign",
        "store.customer-management.daily.batch-assign")))
        .containsExactly("store.customer-management.daily.view", "store.customer-management.daily.batch-assign")
        .doesNotContain("store.customer-management.daily.edit");
  }

  @Test
  void categoryMovementGrantsBecomeSortWithoutChangingStoreCategories() {
    for (String scope : List.of("finished", "accessory")) {
      String prefix = "admin.product-data-center.category." + scope;
      assertThat(FunctionPermissionNormalizer.normalize(List.of(prefix + ".move-up", prefix + ".move-down")))
          .containsExactly(prefix + ".view", prefix + ".sort");
    }
    assertThat(FunctionPermissionNormalizer.normalize(List.of("admin.tenant.store-category-management.move-up")))
        .contains("admin.tenant.store-category-management.move-up")
        .doesNotContain("admin.tenant.store-category-management.sort");
  }

  @Test
  void replacesQueryAndDropsResetPermissions() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.query,"
            + "admin.permission-management.employee-management.reset")))
        .containsExactly("admin.permission-management.employee-management.view");
  }

  @Test
  void addsViewBeforeEveryMutatingOrSensitiveAction() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.edit",
        "admin.slab-management.warehouse.view-price")))
        .containsExactly(
            "admin.permission-management.employee-management.view",
            "admin.permission-management.employee-management.edit",
            "admin.slab-management.warehouse.view",
            "admin.slab-management.warehouse.view-price");
  }

  @Test
  void keepsAllAsTheOnlyPermission() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.edit",
        "all")))
        .containsExactly("all");
  }

  @Test
  void expandsLegacyTenantPagePermissionsAcrossLifecycleTabs() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.tenant.tenant-management.view",
        "admin.tenant.tenant-management.create",
        "admin.tenant.tenant-management.toggle-status",
        "admin.tenant.tenant-management.delete")))
        .containsExactly(
            "admin.tenant.tenant-management.unarchived.view",
            "admin.tenant.tenant-management.archived.view",
            "admin.tenant.tenant-management.unarchived.create",
            "admin.tenant.tenant-management.unarchived.archive",
            "admin.tenant.tenant-management.archived.restore",
            "admin.tenant.tenant-management.archived.delete");
  }

  @Test
  void dropsRemovedLegacyStoreToggleStatusPermission() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.tenant.tenant-store-management.toggle-status",
        "admin.tenant.tenant-store-management.operating.toggle-status")))
        .isEmpty();
  }

  @Test
  void expandsLegacyAttributePagePermissionsAcrossAllTabs() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.product-data-center.attribute.view",
        "admin.product-data-center.attribute.create",
        "admin.product-data-center.attribute.edit",
        "admin.product-data-center.attribute.delete")))
        .containsExactly(
            "admin.product-data-center.attribute.shared.view",
            "admin.product-data-center.attribute.finished.view",
            "admin.product-data-center.attribute.accessory.view",
            "admin.product-data-center.attribute.shared.create",
            "admin.product-data-center.attribute.finished.create",
            "admin.product-data-center.attribute.accessory.create",
            "admin.product-data-center.attribute.shared.toggle-status",
            "admin.product-data-center.attribute.finished.toggle-status",
            "admin.product-data-center.attribute.accessory.toggle-status",
            "admin.product-data-center.attribute.shared.delete",
            "admin.product-data-center.attribute.finished.delete",
            "admin.product-data-center.attribute.accessory.delete");
  }

  @Test
  void expandsLegacyAttributeValuePagePermissionsAcrossAllTabs() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.product-data-center.attribute-value.query",
        "admin.product-data-center.attribute-value.create",
        "admin.product-data-center.attribute-value.edit",
        "admin.product-data-center.attribute-value.delete")))
        .containsExactly(
            "admin.product-data-center.attribute-value.shared.view",
            "admin.product-data-center.attribute-value.finished.view",
            "admin.product-data-center.attribute-value.accessory.view",
            "admin.product-data-center.attribute-value.shared.create",
            "admin.product-data-center.attribute-value.finished.create",
            "admin.product-data-center.attribute-value.accessory.create",
            "admin.product-data-center.attribute-value.shared.toggle-status",
            "admin.product-data-center.attribute-value.finished.toggle-status",
            "admin.product-data-center.attribute-value.accessory.toggle-status",
            "admin.product-data-center.attribute-value.shared.delete",
            "admin.product-data-center.attribute-value.finished.delete",
            "admin.product-data-center.attribute-value.accessory.delete");
  }

  @Test
  void mergesLegacyCategoryEnableAndDisablePermissionsIntoToggleStatus() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.tenant.store-category-management.disable",
        "admin.tenant.store-category-management.enable",
        "admin.product-data-center.category.finished.disable",
        "admin.product-data-center.category.accessory.enable")))
        .containsExactly(
            "admin.tenant.store-category-management.view",
            "admin.tenant.store-category-management.toggle-status",
            "admin.product-data-center.category.finished.view",
            "admin.product-data-center.category.finished.toggle-status",
            "admin.product-data-center.category.accessory.view",
            "admin.product-data-center.category.accessory.toggle-status");
  }
}
