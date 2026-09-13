package com.zdm.platform.catalog;

import com.zdm.platform.common.ProductFormCatalogDirectory;
import com.zdm.platform.security.PermissionGuard;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class ProductFormCatalogService implements ProductFormCatalogDirectory {
  private final ProductCategoryService categories;
  private final ProductAttributeService attributes;
  private final PermissionGuard guard;

  public ProductFormCatalogService(ProductCategoryService categories,
      ProductAttributeService attributes, PermissionGuard guard) {
    this.categories = categories;
    this.attributes = attributes;
    this.guard = guard;
  }

  @Override
  public List<Category> finishedCategories() {
    return guard.filterData(categories.listNewestFirst(List.of("finished"))).stream()
        .map(item -> new Category(item.getId(), item.getParentId(), item.getScope(), item.getName(),
            item.getSortOrder(), item.getStatus())).toList();
  }

  @Override
  public List<Attribute> finishedAttributes() {
    return guard.filterData(attributes.listWithTemplateCounts(List.of("shared", "finished"))).stream()
        .map(item -> new Attribute(item.getId(), item.getScope(), item.getName(), item.getValueType(),
            item.getAttributeRole(), item.getStatus())).toList();
  }
}
