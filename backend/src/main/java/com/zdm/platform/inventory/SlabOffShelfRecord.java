package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;

@TableName("slab_off_shelf_records")
public class SlabOffShelfRecord {
  @TableId(type = IdType.AUTO)
  private Long id;
  private Long slabId;
  private String standardReason;
  private String detailReason;
  private LocalDateTime offShelvedAt;
  private String offShelvedByName;
  private Long offShelvedByAccountId;

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }

  public Long getSlabId() {
    return slabId;
  }

  public void setSlabId(Long slabId) {
    this.slabId = slabId;
  }

  public String getStandardReason() {
    return standardReason;
  }

  public void setStandardReason(String standardReason) {
    this.standardReason = standardReason;
  }

  public String getDetailReason() {
    return detailReason;
  }

  public void setDetailReason(String detailReason) {
    this.detailReason = detailReason;
  }

  public LocalDateTime getOffShelvedAt() {
    return offShelvedAt;
  }

  public void setOffShelvedAt(LocalDateTime offShelvedAt) {
    this.offShelvedAt = offShelvedAt;
  }

  public String getOffShelvedByName() {
    return offShelvedByName;
  }

  public void setOffShelvedByName(String offShelvedByName) {
    this.offShelvedByName = offShelvedByName;
  }

  public Long getOffShelvedByAccountId() {
    return offShelvedByAccountId;
  }

  public void setOffShelvedByAccountId(Long offShelvedByAccountId) {
    this.offShelvedByAccountId = offShelvedByAccountId;
  }
}
