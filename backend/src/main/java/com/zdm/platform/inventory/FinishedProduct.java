package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.FieldStrategy;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
import java.util.List;

@TableName(value = "finished_products", autoResultMap = true)
public class FinishedProduct extends BaseEntity implements com.zdm.platform.security.CreatorOwned {
  @TableField(typeHandler = com.baomidou.mybatisplus.extension.handlers.JacksonTypeHandler.class)
  private List<FinishedSpecDimension> specDimensions;

  public List<FinishedSpecDimension> getSpecDimensions() {
    return specDimensions == null ? null : List.copyOf(specDimensions);
  }

  public void setSpecDimensions(List<FinishedSpecDimension> value) {
    specDimensions = value == null ? null : List.copyOf(value);
  }

  private Long categoryId;
  private Long supplierId;

  @NotBlank
  private String name;

  @TableField(updateStrategy = FieldStrategy.ALWAYS)
  private String sku;

  /** @deprecated kept only for compatibility with pre-media rows. */
  @Deprecated(forRemoval = false)
  private String coverImage;
  private Long mainImageMediaId;
  private Long videoMediaId;

  @TableField(exist = false)
  private List<Long> mainImageMediaIds;

  @TableField(exist = false)
  private List<String> mainImageUrls;

  @TableField(exist = false)
  private String mainImageUrl;

  @TableField(exist = false)
  private String videoUrl;

  private String detail;
  private String publisherType;
  private Integer totalStock;
  private BigDecimal guidePrice;
  private String offShelfReason;
  private java.time.LocalDateTime offShelfAt;
  public java.time.LocalDateTime getOffShelfAt() { return offShelfAt; }
  public void setOffShelfAt(java.time.LocalDateTime value) { this.offShelfAt = value; }
  @TableField(updateStrategy = FieldStrategy.ALWAYS)
  private String offShelfDetail;
  public String getOffShelfDetail() { return offShelfDetail; }
  public void setOffShelfDetail(String value) { this.offShelfDetail = value; }
  private String createdByName;
  private Long createdByAccountId;

  @Valid
  @TableField(exist = false)
  private List<FinishedProductPrice> markupPrices;

  @Valid
  @TableField(exist = false)
  private List<FinishedProductGuidePrice> guidePrices;

  @Valid
  @TableField(exist = false)
  private List<FinishedProductAttributeEntry> attributes;

  @Valid
  @TableField(exist = false)
  private List<FinishedProductVariant> variants;

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

  public Long getMainImageMediaId() { return mainImageMediaId; }
  public void setMainImageMediaId(Long mainImageMediaId) { this.mainImageMediaId = mainImageMediaId; }
  public List<Long> getMainImageMediaIds() {
    return mainImageMediaIds == null ? null : new java.util.ArrayList<>(mainImageMediaIds);
  }
  public void setMainImageMediaIds(List<Long> mainImageMediaIds) {
    this.mainImageMediaIds = mainImageMediaIds == null ? null : new java.util.ArrayList<>(mainImageMediaIds);
  }
  public List<String> getMainImageUrls() {
    return mainImageUrls == null ? null : List.copyOf(mainImageUrls);
  }
  public void setMainImageUrls(List<String> mainImageUrls) {
    this.mainImageUrls = mainImageUrls == null ? null : List.copyOf(mainImageUrls);
  }
  public Long getVideoMediaId() { return videoMediaId; }
  public void setVideoMediaId(Long videoMediaId) { this.videoMediaId = videoMediaId; }
  public String getMainImageUrl() { return mainImageUrl; }
  public void setMainImageUrl(String mainImageUrl) { this.mainImageUrl = mainImageUrl; }
  public String getVideoUrl() { return videoUrl; }
  public void setVideoUrl(String videoUrl) { this.videoUrl = videoUrl; }
  public String getDetail() { return detail; }
  public void setDetail(String detail) { this.detail = detail; }

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

  public String getOffShelfReason() { return offShelfReason; }
  public void setOffShelfReason(String offShelfReason) { this.offShelfReason = offShelfReason; }
  public String getCreatedByName() { return createdByName; }
  public void setCreatedByName(String createdByName) { this.createdByName = createdByName; }
  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long createdByAccountId) { this.createdByAccountId = createdByAccountId; }

  public List<FinishedProductPrice> getMarkupPrices() {
    return markupPrices == null ? null : List.copyOf(markupPrices);
  }

  public void setMarkupPrices(List<FinishedProductPrice> markupPrices) {
    this.markupPrices = markupPrices == null ? null : List.copyOf(markupPrices);
  }

  public List<FinishedProductGuidePrice> getGuidePrices() {
    return guidePrices == null ? null : List.copyOf(guidePrices);
  }

  public void setGuidePrices(List<FinishedProductGuidePrice> guidePrices) {
    this.guidePrices = guidePrices == null ? null : List.copyOf(guidePrices);
  }

  public List<FinishedProductAttributeEntry> getAttributes() {
    return attributes == null ? null : List.copyOf(attributes);
  }

  public void setAttributes(List<FinishedProductAttributeEntry> attributes) {
    this.attributes = attributes == null ? null : List.copyOf(attributes);
  }

  public List<FinishedProductVariant> getVariants() {
    return variants == null ? null : List.copyOf(variants);
  }

  public void setVariants(List<FinishedProductVariant> variants) {
    this.variants = variants == null ? null : List.copyOf(variants);
  }
}
