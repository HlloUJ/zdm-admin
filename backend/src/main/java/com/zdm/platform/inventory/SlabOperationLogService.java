package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.BeanPropertyRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class SlabOperationLogService extends ServiceImpl<SlabOperationLogMapper, SlabOperationLog> {
  private static final String EXTERNAL_API_SOURCE = "EXTERNAL_API";

  private final CurrentIdentityProvider identityProvider;
  private final ObjectMapper objectMapper;
  private final JdbcTemplate jdbcTemplate;

  public SlabOperationLogService(
      CurrentIdentityProvider identityProvider,
      ObjectMapper objectMapper,
      JdbcTemplate jdbcTemplate) {
    this.identityProvider = identityProvider;
    this.objectMapper = objectMapper;
    this.jdbcTemplate = jdbcTemplate;
  }

  public SlabOperationLogPage listPage(
      String keyword,
      String operationType,
      String operatorName,
      LocalDate startDate,
      LocalDate endDate,
      int requestedPage,
      int requestedPageSize) {
    int page = Math.max(requestedPage, 1);
    int pageSize = Math.min(Math.max(requestedPageSize, 1), 100);
    List<Object> parameters = new ArrayList<>();
    String where = buildWhereClause(
        keyword, operationType, operatorName, startDate, endDate, parameters);
    Long total = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_operation_logs" + where,
        Long.class,
        parameters.toArray());
    List<Object> pageParameters = new ArrayList<>(parameters);
    pageParameters.add(pageSize);
    pageParameters.add((page - 1) * pageSize);
    List<SlabOperationLog> records = jdbcTemplate.query(
        "SELECT * FROM slab_operation_logs" + where
            + " ORDER BY operated_at DESC, id DESC LIMIT ? OFFSET ?",
        BeanPropertyRowMapper.newInstance(SlabOperationLog.class),
        pageParameters.toArray());
    return new SlabOperationLogPage(records, total == null ? 0 : total, page, pageSize);
  }

  public void record(
      SlabInventory slab,
      String operationType,
      String operationSummary,
      String beforeStatus,
      String afterStatus,
      String standardReason,
      String detailReason,
      String operationSource,
      String batchNo,
      Map<String, ?> changes) {
    boolean externalOperation = EXTERNAL_API_SOURCE.equals(operationSource);
    CurrentIdentity identity = externalOperation ? null : identityProvider.require();
    LocalDateTime now = LocalDateTime.now();
    SlabOperationLog log = new SlabOperationLog();
    log.setSlabId(slab.getId());
    log.setSlabSerialNo(slab.getSerialNo());
    log.setSlabName(slab.getName());
    log.setPublisherType(slab.getPublisherType());
    log.setOperationType(operationType);
    log.setOperationSummary(operationSummary);
    log.setBeforeStatus(beforeStatus);
    log.setAfterStatus(afterStatus);
    log.setStandardReason(standardReason);
    log.setDetailReason(detailReason);
    log.setChangeDetails(serializeChanges(changes));
    log.setOperationSource(operationSource);
    log.setBatchNo(batchNo);
    log.setOperatorName(externalOperation ? "外部系统" : identity.displayName());
    log.setOperatorAccountId(externalOperation ? null : identity.accountId());
    log.setOperatedAt(now);
    log.setCreatedAt(now);
    save(log);
  }

  private String buildWhereClause(
      String keyword,
      String operationType,
      String operatorName,
      LocalDate startDate,
      LocalDate endDate,
      List<Object> parameters) {
    List<String> conditions = new ArrayList<>();
    if (keyword != null && !keyword.isBlank()) {
      String normalizedKeyword = "%" + keyword.trim() + "%";
      conditions.add("(slab_name LIKE ? OR slab_serial_no LIKE ? OR CAST(slab_id AS CHAR) LIKE ?)");
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
      parameters.add(normalizedKeyword);
    }
    if (operationType != null && !operationType.isBlank()) {
      conditions.add("operation_type = ?");
      parameters.add(operationType.trim());
    }
    if (operatorName != null && !operatorName.isBlank()) {
      conditions.add("operator_name LIKE ?");
      parameters.add("%" + operatorName.trim() + "%");
    }
    if (startDate != null) {
      conditions.add("operated_at >= ?");
      parameters.add(startDate.atStartOfDay());
    }
    if (endDate != null) {
      conditions.add("operated_at < ?");
      parameters.add(endDate.plusDays(1).atStartOfDay());
    }
    return conditions.isEmpty() ? "" : " WHERE " + String.join(" AND ", conditions);
  }

  private String serializeChanges(Map<String, ?> changes) {
    if (changes == null || changes.isEmpty()) {
      return null;
    }
    try {
      return objectMapper.writeValueAsString(changes);
    } catch (JsonProcessingException exception) {
      throw new IllegalStateException("大板操作日志序列化失败", exception);
    }
  }
}
