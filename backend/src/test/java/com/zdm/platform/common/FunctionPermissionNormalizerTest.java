package com.zdm.platform.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class FunctionPermissionNormalizerTest {
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
