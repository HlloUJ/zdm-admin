package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@TableName("product_attribute_values")
public class ProductAttributeValue extends BaseEntity {
  @NotNull
  private Long attributeId;

  @NotBlank
  private String scope;

  @NotBlank
  private String value;

  @NotBlank
  private String code;

  private String createdByName;

  @TableField(exist = false)
  private Long useCount;

  public Long getAttributeId() {
    return attributeId;
  }

  public void setAttributeId(Long attributeId) {
    this.attributeId = attributeId;
  }

  public String getScope() {
    return scope;
  }

  public void setScope(String scope) {
    this.scope = scope;
  }

  public String getValue() {
    return value;
  }

  public void setValue(String value) {
    this.value = value;
  }

  public String getCode() {
    return code;
  }

  public void setCode(String code) {
    this.code = code;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }

  public Long getUseCount() {
    return useCount;
  }

  public void setUseCount(Long useCount) {
    this.useCount = useCount;
  }
}
