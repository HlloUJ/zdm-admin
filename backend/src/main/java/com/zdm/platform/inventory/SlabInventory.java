package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
import java.util.List;

@TableName("slab_inventory")
public class SlabInventory extends BaseEntity {
  private Long supplierId;
  private Long varietyId;
  private Long originId;
  private Long textureId;
  private Long colorId;
  private Long gradeId;

  @NotBlank
  private String name;

  @NotBlank
  private String serialNo;

  private String warehouse;
  private String publisherType;
  private String mainImageUrl;
  private String scanImageUrl;
  private String designImageUrl;
  private String videoUrl;
  private String videoCoverUrl;
  private String createdByName;
  private Long createdByAccountId;

  @TableField(exist = false)
  private String originName;

  @TableField(exist = false)
  private String varietyName;

  @TableField(exist = false)
  private String supplierName;
  private BigDecimal lengthMm;
  private BigDecimal widthMm;
  private BigDecimal thicknessMm;
  private BigDecimal toleranceMm;
  private BigDecimal corner1LengthMm;
  private BigDecimal corner1WidthMm;
  private BigDecimal corner2LengthMm;
  private BigDecimal corner2WidthMm;
  private BigDecimal corner3LengthMm;
  private BigDecimal corner3WidthMm;
  private BigDecimal corner4LengthMm;
  private BigDecimal corner4WidthMm;
  private BigDecimal areaSquareMeter;
  private BigDecimal costPrice;
  private BigDecimal guidePrice;

  @Valid
  @TableField(exist = false)
  private List<SlabPrice> markupPrices;

  public Long getSupplierId() {
    return supplierId;
  }

  public void setSupplierId(Long supplierId) {
    this.supplierId = supplierId;
  }

  public Long getVarietyId() {
    return varietyId;
  }

  public void setVarietyId(Long varietyId) {
    this.varietyId = varietyId;
  }

  public Long getOriginId() {
    return originId;
  }

  public void setOriginId(Long originId) {
    this.originId = originId;
  }

  public Long getTextureId() {
    return textureId;
  }

  public void setTextureId(Long textureId) {
    this.textureId = textureId;
  }

  public Long getColorId() {
    return colorId;
  }

  public void setColorId(Long colorId) {
    this.colorId = colorId;
  }

  public Long getGradeId() {
    return gradeId;
  }

  public void setGradeId(Long gradeId) {
    this.gradeId = gradeId;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getSerialNo() {
    return serialNo;
  }

  public void setSerialNo(String serialNo) {
    this.serialNo = serialNo;
  }

  public String getWarehouse() {
    return warehouse;
  }

  public void setWarehouse(String warehouse) {
    this.warehouse = warehouse;
  }

  public String getPublisherType() {
    return publisherType;
  }

  public void setPublisherType(String publisherType) {
    this.publisherType = publisherType;
  }

  public String getMainImageUrl() {
    return mainImageUrl;
  }

  public void setMainImageUrl(String mainImageUrl) {
    this.mainImageUrl = mainImageUrl;
  }

  public String getScanImageUrl() {
    return scanImageUrl;
  }

  public void setScanImageUrl(String scanImageUrl) {
    this.scanImageUrl = scanImageUrl;
  }

  public String getDesignImageUrl() {
    return designImageUrl;
  }

  public void setDesignImageUrl(String designImageUrl) {
    this.designImageUrl = designImageUrl;
  }

  public String getVideoUrl() {
    return videoUrl;
  }

  public void setVideoUrl(String videoUrl) {
    this.videoUrl = videoUrl;
  }

  public String getVideoCoverUrl() {
    return videoCoverUrl;
  }

  public void setVideoCoverUrl(String videoCoverUrl) {
    this.videoCoverUrl = videoCoverUrl;
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

  public String getOriginName() {
    return originName;
  }

  public void setOriginName(String originName) {
    this.originName = originName;
  }

  public String getVarietyName() {
    return varietyName;
  }

  public void setVarietyName(String varietyName) {
    this.varietyName = varietyName;
  }

  public String getSupplierName() {
    return supplierName;
  }

  public void setSupplierName(String supplierName) {
    this.supplierName = supplierName;
  }

  public BigDecimal getLengthMm() {
    return lengthMm;
  }

  public void setLengthMm(BigDecimal lengthMm) {
    this.lengthMm = lengthMm;
  }

  public BigDecimal getWidthMm() {
    return widthMm;
  }

  public void setWidthMm(BigDecimal widthMm) {
    this.widthMm = widthMm;
  }

  public BigDecimal getThicknessMm() {
    return thicknessMm;
  }

  public void setThicknessMm(BigDecimal thicknessMm) {
    this.thicknessMm = thicknessMm;
  }

  public BigDecimal getToleranceMm() {
    return toleranceMm;
  }

  public void setToleranceMm(BigDecimal toleranceMm) {
    this.toleranceMm = toleranceMm;
  }

  public BigDecimal getCorner1LengthMm() {
    return corner1LengthMm;
  }

  public void setCorner1LengthMm(BigDecimal value) {
    this.corner1LengthMm = value;
  }

  public BigDecimal getCorner1WidthMm() {
    return corner1WidthMm;
  }

  public void setCorner1WidthMm(BigDecimal value) {
    this.corner1WidthMm = value;
  }

  public BigDecimal getCorner2LengthMm() {
    return corner2LengthMm;
  }

  public void setCorner2LengthMm(BigDecimal value) {
    this.corner2LengthMm = value;
  }

  public BigDecimal getCorner2WidthMm() {
    return corner2WidthMm;
  }

  public void setCorner2WidthMm(BigDecimal value) {
    this.corner2WidthMm = value;
  }

  public BigDecimal getCorner3LengthMm() {
    return corner3LengthMm;
  }

  public void setCorner3LengthMm(BigDecimal value) {
    this.corner3LengthMm = value;
  }

  public BigDecimal getCorner3WidthMm() {
    return corner3WidthMm;
  }

  public void setCorner3WidthMm(BigDecimal value) {
    this.corner3WidthMm = value;
  }

  public BigDecimal getCorner4LengthMm() {
    return corner4LengthMm;
  }

  public void setCorner4LengthMm(BigDecimal value) {
    this.corner4LengthMm = value;
  }

  public BigDecimal getCorner4WidthMm() {
    return corner4WidthMm;
  }

  public void setCorner4WidthMm(BigDecimal value) {
    this.corner4WidthMm = value;
  }

  public BigDecimal getAreaSquareMeter() {
    return areaSquareMeter;
  }

  public void setAreaSquareMeter(BigDecimal areaSquareMeter) {
    this.areaSquareMeter = areaSquareMeter;
  }

  public BigDecimal getCostPrice() {
    return costPrice;
  }

  public void setCostPrice(BigDecimal costPrice) {
    this.costPrice = costPrice;
  }

  public BigDecimal getGuidePrice() {
    return guidePrice;
  }

  public void setGuidePrice(BigDecimal guidePrice) {
    this.guidePrice = guidePrice;
  }

  public List<SlabPrice> getMarkupPrices() {
    return markupPrices == null ? null : List.copyOf(markupPrices);
  }

  public void setMarkupPrices(List<SlabPrice> markupPrices) {
    this.markupPrices = markupPrices == null ? null : List.copyOf(markupPrices);
  }
}
