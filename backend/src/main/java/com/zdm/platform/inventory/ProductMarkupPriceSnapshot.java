package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

@TableName("product_markup_price_snapshots")
public class ProductMarkupPriceSnapshot extends BaseEntity {
  private String productType;
  private Long productId;
  private String variantKey;
  private String variantLabel;
  private Long snapshotVersion;
  private Boolean isCurrent;

  @NotNull
  private Long markupConfigurationId;

  private String markupNameSnapshot;

  @NotNull
  @DecimalMin("0.0000")
  @Digits(integer = 3, fraction = 4)
  private BigDecimal markupRateSnapshot;

  @NotNull
  @DecimalMin("0.00")
  private BigDecimal costPriceSnapshot;

  @NotNull
  @DecimalMin("0.00")
  private BigDecimal salePrice;

  @TableField(exist = false)
  private String currentName;

  public String getProductType() { return productType; }
  public void setProductType(String productType) { this.productType = productType; }
  public Long getProductId() { return productId; }
  public void setProductId(Long productId) { this.productId = productId; }
  public String getVariantKey() { return variantKey; }
  public void setVariantKey(String variantKey) { this.variantKey = variantKey; }
  public String getVariantLabel() { return variantLabel; }
  public void setVariantLabel(String variantLabel) { this.variantLabel = variantLabel; }
  public Long getSnapshotVersion() { return snapshotVersion; }
  public void setSnapshotVersion(Long snapshotVersion) { this.snapshotVersion = snapshotVersion; }
  public Boolean getIsCurrent() { return isCurrent; }
  public void setIsCurrent(Boolean isCurrent) { this.isCurrent = isCurrent; }
  public Long getMarkupConfigurationId() { return markupConfigurationId; }
  public void setMarkupConfigurationId(Long markupConfigurationId) { this.markupConfigurationId = markupConfigurationId; }
  public String getMarkupNameSnapshot() { return markupNameSnapshot; }
  public void setMarkupNameSnapshot(String markupNameSnapshot) { this.markupNameSnapshot = markupNameSnapshot; }
  public BigDecimal getMarkupRateSnapshot() { return markupRateSnapshot; }
  public void setMarkupRateSnapshot(BigDecimal markupRateSnapshot) { this.markupRateSnapshot = markupRateSnapshot; }
  public BigDecimal getCostPriceSnapshot() { return costPriceSnapshot; }
  public void setCostPriceSnapshot(BigDecimal costPriceSnapshot) { this.costPriceSnapshot = costPriceSnapshot; }
  public BigDecimal getSalePrice() { return salePrice; }
  public void setSalePrice(BigDecimal salePrice) { this.salePrice = salePrice; }
  public String getCurrentName() { return currentName; }
  public void setCurrentName(String currentName) { this.currentName = currentName; }
}
