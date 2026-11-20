package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/** Independent of SQL backups. No fallback to an in-database-only success receipt. */
@Component
public class StoreExitJournal {
  private static final String UUID_PATTERN = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
  private final Path directory;
  private final ObjectMapper json;
  private final StoreExitRemoteLedger remote;

  @org.springframework.beans.factory.annotation.Autowired
  public StoreExitJournal(@Value("${zdm.store-exit.ledger-directory:}") String directory, ObjectMapper json,
      StoreExitRemoteLedger remote) {
    this.remote = remote;
    this.directory = directory.isBlank() ? null : Path.of(directory).toAbsolutePath().normalize();
    this.json = json;
  }

  public StoreExitJournal(String directory, ObjectMapper json) { this(directory, json, null); }

  public void requireReady() {
    if (directory == null && remote != null && remote.configured()) { remote.requireReady(); return; }
    if (directory == null || Files.isSymbolicLink(directory) || !Files.isDirectory(directory) || !Files.isWritable(directory)) {
      throw new IllegalStateException("门店退出独立恢复记录未配置或不可用，禁止执行彻底删除");
    }
  }

  public synchronized void append(String operationId, long storeId, long tenantId, String stage) {
    persist(operationId, storeId, tenantId, stage, Map.of());
  }

  public synchronized void intent(String operationId, long storeId, long tenantId, List<Long> accountIds) {
    persist(operationId, storeId, tenantId, "INTENT", Map.of("accountIds", accountIds.stream().map(String::valueOf).toList()));
  }

  public synchronized void intent(String operationId, long storeId, long tenantId, List<Long> accountIds,
      com.zdm.platform.security.CurrentIdentity actor) {
    if (actor.accountId() == null || actor.accountId() <= 0) { throw new IllegalArgumentException("退出操作缺少有效操作者"); }
    persist(operationId, storeId, tenantId, "INTENT", Map.of(
        "accountIds", accountIds.stream().map(String::valueOf).toList(),
        "operatorAccountId", actor.accountId().toString(), "operatorName", actor.displayName(),
        "operatorIdentity", actor.clientCode() + ":" + actor.identityId(),
        "acceptedAt", java.time.Instant.now().toString()));
  }

  public synchronized void committed(Map<String, Object> receipt) {
    Map<String, Object> minimal = new java.util.LinkedHashMap<>();
    for (String field : List.of("operation_id", "store_id", "tenant_id", "store_name", "tenant_name",
        "store_created_by_account_id", "operator_account_id", "operator_name", "operator_identity", "rule_version", "plan_hash", "result_json", "created_at")) {
      Object value = receipt.get(field);
      minimal.put(field, value != null && (value instanceof java.sql.Timestamp || field.endsWith("_id")) ? value.toString() : value);
    }
    persist(String.valueOf(receipt.get("operation_id")), ((Number) receipt.get("store_id")).longValue(),
        ((Number) receipt.get("tenant_id")).longValue(), "COMMITTED", minimal);
  }

  private void persist(String operationId, long storeId, long tenantId, String stage, Map<String, Object> receipt) {
    requireReady();
    if (storeId <= 0 || tenantId <= 0 || !operationId.matches(UUID_PATTERN) || !List.of("INTENT", "COMMITTED", "ROLLED_BACK").contains(stage)) {
      throw new IllegalArgumentException("退出记录标识不合法");
    }
    try {
      byte[] bytes = json.writeValueAsBytes(Map.of("operationId", operationId, "storeId", String.valueOf(storeId),
          "tenantId", String.valueOf(tenantId), "stage", stage, "ruleVersion", "V1.3", "receipt", receipt));
      decode(json.readTree(bytes), operationId + "-" + stage + ".json");
      if (directory == null) { remote.persist(json.readTree(bytes)); return; }
      Path target = directory.resolve(operationId + "-" + stage + ".json");
      if (Files.exists(target)) {
        if (Files.isSymbolicLink(target)) { throw new IllegalStateException("独立退出记录不能使用链接文件"); }
        if (!json.readTree(Files.readAllBytes(target)).equals(json.readTree(bytes))) {
          throw new IllegalStateException("独立退出记录内容冲突");
        }
        try (FileChannel dir = FileChannel.open(directory, StandardOpenOption.READ)) { dir.force(true); }
        return;
      }
      Path temporary = Files.createTempFile(directory, operationId, ".tmp");
      try {
        try (FileChannel file = FileChannel.open(temporary, StandardOpenOption.WRITE)) {
          ByteBuffer buffer = ByteBuffer.wrap(bytes);
          while (buffer.hasRemaining()) { file.write(buffer); }
          file.force(true);
        }
        try { Files.createLink(target, temporary); }
        catch (java.nio.file.FileAlreadyExistsException existing) {
          if (Files.isSymbolicLink(target) || !json.readTree(Files.readAllBytes(target)).equals(json.readTree(bytes))) {
            throw new IllegalStateException("独立退出记录内容冲突");
          }
        }
        try (FileChannel dir = FileChannel.open(directory, StandardOpenOption.READ)) { dir.force(true); }
      } finally { Files.deleteIfExists(temporary); }
    } catch (IOException exception) {
      throw new IllegalStateException("独立退出记录持久化失败", exception);
    }
  }

  public synchronized List<Entry> entries() {
    if (directory == null) {
      if (remote == null || !remote.configured()) { return List.of(); }
      var result = remote.entries();
      if (!result.isArray()) { throw new IllegalStateException("独立记录响应不完整"); }
      List<Entry> records = new java.util.ArrayList<>();
      for (var node : result) {
        records.add(decode(node, node.path("operationId").asText() + "-" + node.path("stage").asText() + ".json"));
      }
      return List.copyOf(records);
    }
    requireReady();
    try (var paths = Files.list(directory)) {
      return paths.filter(path -> java.util.Objects.requireNonNull(path.getFileName()).toString().endsWith(".json")).sorted().map(path -> {
        try {
          if (Files.isSymbolicLink(path)) { throw new IllegalStateException("独立退出记录不能使用链接文件"); }
          var node = json.readTree(Files.readAllBytes(path));
          return decode(node, java.util.Objects.requireNonNull(path.getFileName()).toString());
        } catch (IOException exception) { throw new IllegalStateException("独立退出记录不可读", exception); }
      }).toList();
    } catch (IOException exception) { throw new IllegalStateException("独立退出记录不可枚举", exception); }
  }

  private Entry decode(com.fasterxml.jackson.databind.JsonNode node, String filename) {
          String id = node.path("operationId").asText();
          String stage = node.path("stage").asText();
          if (!id.matches(UUID_PATTERN) || !List.of("INTENT", "COMMITTED", "ROLLED_BACK").contains(stage)
              || !filename.equals(id + "-" + stage + ".json")
              || node.path("storeId").asLong() <= 0 || node.path("tenantId").asLong() <= 0
              || !"V1.3".equals(node.path("ruleVersion").asText())) {
            throw new IllegalStateException("独立退出记录损坏或版本不兼容");
          }
          Map<String, Object> receipt = json.convertValue(node.path("receipt"),
              new com.fasterxml.jackson.core.type.TypeReference<java.util.LinkedHashMap<String, Object>>() { });
          if ("COMMITTED".equals(stage) && (receipt == null || !id.equals(receipt.get("operation_id"))
              || !"V1.3".equals(receipt.get("rule_version"))
              || !node.path("storeId").asText().equals(String.valueOf(receipt.get("store_id")))
              || !node.path("tenantId").asText().equals(String.valueOf(receipt.get("tenant_id")))
              || !String.valueOf(receipt.get("plan_hash")).matches("[a-f0-9]{64}"))) {
            throw new IllegalStateException("独立退出成功凭证缺失或不一致");
          }
          if ("INTENT".equals(stage) && !node.path("receipt").path("accountIds").isArray()) {
            throw new IllegalStateException("独立退出意图缺少历史账号标识集合");
          }
          if ("INTENT".equals(stage) && receipt.containsKey("operatorAccountId")) {
            try {
              if (Long.parseLong(String.valueOf(receipt.get("operatorAccountId"))) <= 0
                  || !(receipt.get("operatorName") instanceof String name) || name.length() > 200
                  || !(receipt.get("operatorIdentity") instanceof String identity) || identity.length() > 200) {
                throw new IllegalStateException("独立退出受理记录缺少有效操作者快照");
              }
              java.time.Instant.parse(String.valueOf(receipt.get("acceptedAt")));
            } catch (IllegalArgumentException | java.time.DateTimeException exception) { throw new IllegalStateException("退出受理记录不可核实", exception); }
          }
          if ("COMMITTED".equals(stage)) {
            try {
              var result = json.readTree(String.valueOf(receipt.get("result_json")));
              if (!result.path("verified").asBoolean() || !result.path("counts").isObject()
                  || !result.path("retained").isArray() || !result.path("mediaRelease").isObject()
                  || !result.path("accountIds").isArray()) {
                throw new IllegalStateException("独立退出成功凭证未包含完整核验结果");
              }
            } catch (IOException exception) { throw new IllegalStateException("独立退出成功凭证内容损坏", exception); }
          }
          return new Entry(id, node.path("storeId").asLong(), node.path("tenantId").asLong(), stage,
              receipt == null ? Map.of() : java.util.Collections.unmodifiableMap(receipt));
  }

  public record Entry(String operationId, long storeId, long tenantId, String stage, Map<String, Object> receipt) {
    public Entry { receipt = java.util.Collections.unmodifiableMap(new java.util.LinkedHashMap<>(receipt)); }
  }
}
