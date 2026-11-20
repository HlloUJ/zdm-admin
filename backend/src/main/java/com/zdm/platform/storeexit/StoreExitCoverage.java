package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** A schema declaration is required even for shared/system datasets; unknown structure blocks exit only. */
@Component
public class StoreExitCoverage {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final StoreExitRegistry registry;

  public StoreExitCoverage(JdbcTemplate jdbc, ObjectMapper json, StoreExitRegistry registry) {
    this.jdbc = jdbc; this.json = json; this.registry = registry;
  }

  public String verify() {
    try (var input = new ClassPathResource("store-exit-coverage.json").getInputStream()) {
      JsonNode manifest = json.readTree(input);
      Map<String, TreeSet<String>> expected = new TreeMap<>();
      manifest.path("tables").fields().forEachRemaining(entry -> {
        JsonNode definition = entry.getValue();
        if (!java.util.Set.of("module", "media", "account", "root", "tenant", "shared", "system").contains(definition.path("disposition").asText()) || definition.path("basis").asText().isBlank()) {
          throw new IllegalStateException("门店退出覆盖声明缺少处理依据");
        }
        TreeSet<String> columns = new TreeSet<>();
        definition.path("columns").forEach(column -> columns.add(column.asText()));
        if (columns.isEmpty()) { throw new IllegalStateException("门店退出覆盖声明为空"); }
        if ("module".equals(definition.path("disposition").asText()) && !registry.tables().contains(entry.getKey())) {
          throw new IllegalStateException("门店退出缺少实际模块：" + entry.getKey());
        }
        expected.put(entry.getKey(), columns);
      });
      Map<String, TreeSet<String>> actual = new TreeMap<>();
      jdbc.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()",
          (org.springframework.jdbc.core.RowCallbackHandler) rs -> actual.computeIfAbsent(rs.getString(1), key -> new TreeSet<>()).add(rs.getString(2)));
      if (!actual.equals(expected) || !expected.keySet().containsAll(registry.tables())) {
        throw new IllegalStateException("数据库结构与门店退出覆盖登记不一致，请先补齐模块接入和验证");
      }
      List<String> foreignKeys = jdbc.query("""
          SELECT k.TABLE_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.DELETE_RULE
          FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r
            ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME AND r.TABLE_NAME=k.TABLE_NAME
          WHERE k.TABLE_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL
          ORDER BY BINARY k.TABLE_NAME,BINARY k.COLUMN_NAME,BINARY k.REFERENCED_TABLE_NAME,BINARY k.REFERENCED_COLUMN_NAME,BINARY r.DELETE_RULE
          """, (rs, row) -> rs.getString(1) + "/" + rs.getString(2) + "/" + rs.getString(3) + "/" + rs.getString(4) + "/" + rs.getString(5));
      List<String> registeredKeys = json.convertValue(manifest.path("foreignKeys"),
          new com.fasterxml.jackson.core.type.TypeReference<List<String>>() { });
      if (!foreignKeys.equals(registeredKeys)) {
        throw new IllegalStateException("数据库引用关系与门店退出登记不一致");
      }
      TreeSet<String> accountFields = new TreeSet<>();
      actual.forEach((table, columns) -> columns.stream()
          .filter(column -> column.equals("account_id") || column.endsWith("_account_id"))
          .forEach(column -> accountFields.add(table + "." + column)));
      TreeSet<String> declaredAccountFields = new TreeSet<>();
      manifest.path("accountReferences").fields().forEachRemaining(entry -> {
        if (!java.util.Set.of("history", "live").contains(entry.getValue().path("kind").asText())
            || entry.getValue().path("basis").asText().isBlank()) {
          throw new IllegalStateException("账号引用缺少有效用途及处理依据");
        }
        declaredAccountFields.add(entry.getKey());
      });
      if (!accountFields.equals(declaredAccountFields)) { throw new IllegalStateException("账号引用用途登记不完整"); }
      JsonNode activityDomains = manifest.path("stateActivityDomains");
      activityDomains.fields().forEachRemaining(entry -> {
        var definition = entry.getValue();
        String disposition = definition.path("disposition").asText();
        if (!java.util.Set.of("module", "shared").contains(disposition) || definition.path("basis").asText().isBlank()
            || ("module".equals(disposition) && !definition.path("parent").asText().equals(StoreExitRegistry.STATE_ACTIVITY_PARENTS.get(entry.getKey())))) {
          throw new IllegalStateException("商品状态业务域缺少实际处理能力或依据");
        }
      });
      for (String domain : jdbc.queryForList("SELECT DISTINCT CONCAT(kind,'/',business_client_code) FROM product_state_activity", String.class)) {
        if (!activityDomains.has(domain)) { throw new IllegalStateException("商品状态业务域未登记退出处理：" + domain); }
      }
      JsonNode domains = manifest.path("mediaDomains");
      for (String domain : jdbc.queryForList("SELECT DISTINCT business_domain FROM media_references", String.class)) {
        if (!domains.has(domain)) { throw new IllegalStateException("媒体业务域未登记门店退出处理"); }
      }
      domains.fields().forEachRemaining(entry -> {
        String parent = entry.getValue().path("parent").asText();
        if ("module".equals(entry.getValue().path("disposition").asText())
            && (!parent.equals(StoreExitMediaDomains.PARENTS.get(entry.getKey())) || !registry.tables().contains(parent))) {
          throw new IllegalStateException("门店媒体业务域缺少实际处理能力");
        }
      });
      return hash(json.writeValueAsString(expected) + json.writeValueAsString(foreignKeys) + json.writeValueAsString(domains) + json.writeValueAsString(manifest.path("accountReferences")) + json.writeValueAsString(activityDomains));
    } catch (IOException exception) {
      throw new IllegalStateException("门店退出覆盖登记不可读取", exception);
    }
  }

  public static String hash(String value) {
    try {
      return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    } catch (NoSuchAlgorithmException exception) {
      throw new IllegalStateException(exception);
    }
  }
}
