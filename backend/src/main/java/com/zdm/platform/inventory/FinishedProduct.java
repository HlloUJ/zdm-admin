package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

@TableName("finished_products")
public class FinishedProduct extends BaseEntity {
  private Long categoryId;
  private Long supplierId;

  @NotBlank
  private String name;

  @NotBlank
  private String sku;

  private String coverImage;
  private String publisherType;
  private Integer totalStock;
  private BigDecimal guidePrice;

  public Long getCategoryId() {
    return categoryId;
  }

  public void setCategoryId(Long categoryId) {
    this.categoryId = categoryId;
  }

  public Long getSupplierId() {
    return supplierId;
  }

  public void setSupplierId(Long supplierId) {
    this.supplierId = supplierId;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getSku() {
    return sku;
  }

  public void setSku(String sku) {
    this.sku = sku;
  }

  public String getCoverImage() {
    return coverImage;
  }

  public void setCoverImage(String coverImage) {
    this.coverImage = coverImage;
  }

  public String getPublisherType() {
    return publisherType;
  }

  public void setPublisherType(String publisherType) {
    this.publisherType = publisherType;
  }

  public Integer getTotalStock() {
    return totalStock;
  }

  public void setTotalStock(Integer totalStock) {
    this.totalStock = totalStock;
  }

  public BigDecimal getGuidePrice() {
    return guidePrice;
  }

  public void setGuidePrice(BigDecimal guidePrice) {
    this.guidePrice = guidePrice;
  }
}
