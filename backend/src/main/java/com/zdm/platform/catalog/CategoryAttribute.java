package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotNull;

@TableName("category_attributes")
public class CategoryAttribute extends BaseEntity {
  @NotNull
  private Long categoryId;

  @NotNull
  private Long attributeId;

  private Boolean requiredFlag;
  private Boolean skuFlag;
  private Integer sortOrder;

  public Long getCategoryId() {
    return categoryId;
  }

  public void setCategoryId(Long categoryId) {
    this.categoryId = categoryId;
  }

  public Long getAttributeId() {
    return attributeId;
  }

  public void setAttributeId(Long attributeId) {
    this.attributeId = attributeId;
  }

  public Boolean getRequiredFlag() {
    return requiredFlag;
  }

  public void setRequiredFlag(Boolean requiredFlag) {
    this.requiredFlag = requiredFlag;
  }

  public Boolean getSkuFlag() {
    return skuFlag;
  }

  public void setSkuFlag(Boolean skuFlag) {
    this.skuFlag = skuFlag;
  }

  public Integer getSortOrder() {
    return sortOrder;
  }

  public void setSortOrder(Integer sortOrder) {
    this.sortOrder = sortOrder;
  }
}
