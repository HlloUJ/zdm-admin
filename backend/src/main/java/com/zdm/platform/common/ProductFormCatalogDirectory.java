package com.zdm.platform.common;

import java.util.List;

/** Read-only catalog options, filtered to the current identity's data scope. */
public interface ProductFormCatalogDirectory {
  record Category(Long id, Long parentId, String scope, String name, Integer sortOrder, String status) {}
  record Attribute(Long id, String scope, String name, String valueType, String attributeRole, String status) {}

  List<Category> finishedCategories();
  List<Attribute> finishedAttributes();
}
