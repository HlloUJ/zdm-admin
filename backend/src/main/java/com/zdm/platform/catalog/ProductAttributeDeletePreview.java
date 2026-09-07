package com.zdm.platform.catalog;

import java.util.List;

public record ProductAttributeDeletePreview(
    String deletionMode,
    long attributeValueCount,
    long unfinishedProductCount,
    long soldOutProductCount,
    List<String> templateScopes,
    String message) {

  public ProductAttributeDeletePreview {
    templateScopes = List.copyOf(templateScopes);
  }

  public ProductAttributeDeletePreview withMessage(String updatedMessage) {
    return new ProductAttributeDeletePreview(
        deletionMode,
        attributeValueCount,
        unfinishedProductCount,
        soldOutProductCount,
        templateScopes,
        updatedMessage);
  }
}
