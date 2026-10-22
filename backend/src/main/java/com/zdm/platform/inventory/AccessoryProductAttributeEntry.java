package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@TableName("accessory_product_attribute_entries")
public class AccessoryProductAttributeEntry extends BaseEntity {
  private Long accessoryProductId;

  @NotNull
  private Long attributeId;

  @NotBlank
  private String attributeName;

  @NotBlank
  private String value;

  public Long getAccessoryProductId() { return accessoryProductId; }
  public void setAccessoryProductId(Long accessoryProductId) { this.accessoryProductId = accessoryProductId; }
  public Long getAttributeId() { return attributeId; }
  public void setAttributeId(Long attributeId) { this.attributeId = attributeId; }
  public String getAttributeName() { return attributeName; }
  public void setAttributeName(String attributeName) { this.attributeName = attributeName; }
  public String getValue() { return value; }
  public void setValue(String value) { this.value = value; }
}
