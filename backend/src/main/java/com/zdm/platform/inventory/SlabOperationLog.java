package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;

@TableName("slab_operation_logs")
public class SlabOperationLog {
  @TableId(type = IdType.AUTO)
  private Long id;
  private Long slabId;
  private String slabSerialNo;
  private String slabName;
  private String publisherType;
  private String operationType;
  private String operationSummary;
  private String beforeStatus;
  private String afterStatus;
  private String standardReason;
  private String detailReason;
  private String changeDetails;
  private String operationSource;
  private String batchNo;
  private String operatorName;
  private Long operatorAccountId;
  private LocalDateTime operatedAt;
  private LocalDateTime createdAt;

  public Long getId() { return id; }
  public void setId(Long id) { this.id = id; }
  public Long getSlabId() { return slabId; }
  public void setSlabId(Long slabId) { this.slabId = slabId; }
  public String getSlabSerialNo() { return slabSerialNo; }
  public void setSlabSerialNo(String slabSerialNo) { this.slabSerialNo = slabSerialNo; }
  public String getSlabName() { return slabName; }
  public void setSlabName(String slabName) { this.slabName = slabName; }
  public String getPublisherType() { return publisherType; }
  public void setPublisherType(String publisherType) { this.publisherType = publisherType; }
  public String getOperationType() { return operationType; }
  public void setOperationType(String operationType) { this.operationType = operationType; }
  public String getOperationSummary() { return operationSummary; }
  public void setOperationSummary(String operationSummary) { this.operationSummary = operationSummary; }
  public String getBeforeStatus() { return beforeStatus; }
  public void setBeforeStatus(String beforeStatus) { this.beforeStatus = beforeStatus; }
  public String getAfterStatus() { return afterStatus; }
  public void setAfterStatus(String afterStatus) { this.afterStatus = afterStatus; }
  public String getStandardReason() { return standardReason; }
  public void setStandardReason(String standardReason) { this.standardReason = standardReason; }
  public String getDetailReason() { return detailReason; }
  public void setDetailReason(String detailReason) { this.detailReason = detailReason; }
  public String getChangeDetails() { return changeDetails; }
  public void setChangeDetails(String changeDetails) { this.changeDetails = changeDetails; }
  public String getOperationSource() { return operationSource; }
  public void setOperationSource(String operationSource) { this.operationSource = operationSource; }
  public String getBatchNo() { return batchNo; }
  public void setBatchNo(String batchNo) { this.batchNo = batchNo; }
  public String getOperatorName() { return operatorName; }
  public void setOperatorName(String operatorName) { this.operatorName = operatorName; }
  public Long getOperatorAccountId() { return operatorAccountId; }
  public void setOperatorAccountId(Long operatorAccountId) { this.operatorAccountId = operatorAccountId; }
  public LocalDateTime getOperatedAt() { return operatedAt; }
  public void setOperatedAt(LocalDateTime operatedAt) { this.operatedAt = operatedAt; }
  public LocalDateTime getCreatedAt() { return createdAt; }
  public void setCreatedAt(LocalDateTime createdAt) { this.createdAt = createdAt; }
}
