package com.zdm.platform.storeexit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** Explicitly reviewed purpose per field; an unknown account reference cannot silently keep or remove an account. */
@Component
public final class StoreExitAccountReferences {
  private final JsonNode references;
  public StoreExitAccountReferences(ObjectMapper json) {
    try (var input = new ClassPathResource("store-exit-coverage.json").getInputStream()) {
      references = json.readTree(input).path("accountReferences");
    } catch (java.io.IOException exception) { throw new IllegalStateException("账号退出引用登记不可读", exception); }
  }
  public java.util.Set<String> historicalFields() {
    java.util.Set<String> fields = new java.util.HashSet<>();
    references.fields().forEachRemaining(entry -> {
      if ("history".equals(entry.getValue().path("kind").asText())) { fields.add(entry.getKey()); }
    });
    return java.util.Set.copyOf(fields);
  }

  public java.util.Set<String> liveFields(String table) {
    java.util.Set<String> fields = new java.util.TreeSet<>();
    references.fields().forEachRemaining(entry -> {
      if (entry.getKey().startsWith(table + ".") && "live".equals(entry.getValue().path("kind").asText())) {
        fields.add(entry.getKey().substring(table.length() + 1));
      }
    });
    return java.util.Set.copyOf(fields);
  }

  public boolean historical(String field) {
    String kind = references.path(field).path("kind").asText();
    if (!java.util.Set.of("history", "live").contains(kind)) { throw new IllegalStateException("账号引用用途尚未登记：" + field); }
    return "history".equals(kind);
  }
}
