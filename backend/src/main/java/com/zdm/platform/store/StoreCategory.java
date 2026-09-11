package com.zdm.platform.store;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;

@TableName("store_categories")
public class StoreCategory extends BaseEntity implements com.zdm.platform.security.CreatorOwned {
  private Long storeId;
  private Long parentId;
  private String name;
  private Integer sortOrder;
  private Integer productCount;
  private String createdByName;

  public Long getStoreId() {
    return storeId;
  }

  public void setStoreId(Long storeId) {
    this.storeId = storeId;
  }

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
  private Long createdByAccountId;

  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long accountId) { this.createdByAccountId = accountId; }
}
