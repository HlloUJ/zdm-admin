package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

@TableName("finished_product_variants")
public class FinishedProductVariant extends BaseEntity {
  private Long finishedProductId;

  @NotBlank
  private String variantKey;

  @NotBlank
  private String variantLabel;

  private String displayMode;
  private String material;
  private String lengthValue;
  private String color;
  private String sizeValue;

  @Min(0)
  private Integer stock;

  public Long getFinishedProductId() { return finishedProductId; }
  public void setFinishedProductId(Long finishedProductId) { this.finishedProductId = finishedProductId; }
  public String getVariantKey() { return variantKey; }
  public void setVariantKey(String variantKey) { this.variantKey = variantKey; }
  public String getVariantLabel() { return variantLabel; }
  public void setVariantLabel(String variantLabel) { this.variantLabel = variantLabel; }
  public String getDisplayMode() { return displayMode; }
  public void setDisplayMode(String displayMode) { this.displayMode = displayMode; }
  public String getMaterial() { return material; }
  public void setMaterial(String material) { this.material = material; }
  public String getLengthValue() { return lengthValue; }
  public void setLengthValue(String lengthValue) { this.lengthValue = lengthValue; }
  public String getColor() { return color; }
  public void setColor(String color) { this.color = color; }
  public String getSizeValue() { return sizeValue; }
  public void setSizeValue(String sizeValue) { this.sizeValue = sizeValue; }
  public Integer getStock() { return stock; }
  public void setStock(Integer stock) { this.stock = stock; }
}
