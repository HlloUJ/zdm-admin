package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("product_attributes")
public class ProductAttribute extends BaseEntity {
  @NotBlank
  private String scope;

  @NotBlank
  private String name;

  @NotBlank
  private String valueType;

  private String attributeRole;

  private String createdByName;

  @TableField(exist = false)
  private Long templateCount;

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

  public String getValueType() {
    return valueType;
  }

  public void setValueType(String valueType) {
    this.valueType = valueType;
  }

  public String getAttributeRole() {
    return attributeRole;
  }

  public void setAttributeRole(String attributeRole) {
    this.attributeRole = attributeRole;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }

  public Long getTemplateCount() {
    return templateCount;
  }

  public void setTemplateCount(Long templateCount) {
    this.templateCount = templateCount;
  }
}
