package com.zdm.platform.store;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;

@TableName("store_categories")
public class StoreCategory extends BaseEntity {
  private Long parentId;
  private String name;
  private Integer sortOrder;
  private Integer productCount;
  private String createdByName;

  public Long getParentId() {
    return parentId;
  }

  public void setParentId(Long parentId) {
    this.parentId = parentId;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public Integer getSortOrder() {
    return sortOrder;
  }

  public void setSortOrder(Integer sortOrder) {
    this.sortOrder = sortOrder;
  }

  public Integer getProductCount() {
    return productCount;
  }

  public void setProductCount(Integer productCount) {
    this.productCount = productCount;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }
}
