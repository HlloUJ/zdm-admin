package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@TableName("finished_product_attribute_entries")
public class FinishedProductAttributeEntry extends BaseEntity {
  private Long finishedProductId;

  @NotNull
  private Long attributeId;

  @NotBlank
  private String attributeName;

  @NotBlank
  private String value;

  public Long getFinishedProductId() { return finishedProductId; }
  public void setFinishedProductId(Long finishedProductId) { this.finishedProductId = finishedProductId; }
  public Long getAttributeId() { return attributeId; }
  public void setAttributeId(Long attributeId) { this.attributeId = attributeId; }
  public String getAttributeName() { return attributeName; }
  public void setAttributeName(String attributeName) { this.attributeName = attributeName; }
  public String getValue() { return value; }
  public void setValue(String value) { this.value = value; }
}
