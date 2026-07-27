package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("product_categories")
public class ProductCategory extends BaseEntity {
  private Long tenantId;
  private Long parentId;

  @NotBlank
  private String scope;

  @NotBlank
  private String name;

  private Integer sortOrder;
  private Integer productCount;

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Long getParentId() {
    return parentId;
  }

  public void setParentId(Long parentId) {
    this.parentId = parentId;
  }

  public String getScope() {
    return scope;
  }

  public void setScope(String scope) {
    this.scope = scope;
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
}
