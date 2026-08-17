package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotNull;

@TableName("category_attributes")
public class CategoryAttribute extends BaseEntity {
  @NotNull
  private Long categoryId;

  @NotNull
  private Long attributeId;

  private String attributeRole;
  private Boolean requiredFlag;
  private Boolean skuFlag;
  private Integer sortOrder;
  private String publishStatus;
  private String createdByName;
  private Long createdByAccountId;

  @TableField(exist = false)
  private Long optionCount;

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

  public String getAttributeRole() {
    return attributeRole;
  }

  public void setAttributeRole(String attributeRole) {
    this.attributeRole = attributeRole;
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

  public String getPublishStatus() {
    return publishStatus;
  }

  public void setPublishStatus(String publishStatus) {
    this.publishStatus = publishStatus;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }

  public Long getCreatedByAccountId() {
    return createdByAccountId;
  }

  public void setCreatedByAccountId(Long createdByAccountId) {
    this.createdByAccountId = createdByAccountId;
  }

  public Long getOptionCount() {
    return optionCount;
  }

  public void setOptionCount(Long optionCount) {
    this.optionCount = optionCount;
  }
}
