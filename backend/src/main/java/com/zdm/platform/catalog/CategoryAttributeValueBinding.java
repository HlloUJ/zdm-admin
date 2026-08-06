package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;

@TableName("category_attribute_value_bindings")
public class CategoryAttributeValueBinding {
  @TableId(type = IdType.AUTO)
  private Long id;
  private Long categoryAttributeId;
  private Long attributeValueId;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getCategoryAttributeId() {
    return categoryAttributeId;
  }

  public void setCategoryAttributeId(Long categoryAttributeId) {
    this.categoryAttributeId = categoryAttributeId;
  }

  public Long getAttributeValueId() {
    return attributeValueId;
  }

  public void setAttributeValueId(Long attributeValueId) {
    this.attributeValueId = attributeValueId;
  }
}
