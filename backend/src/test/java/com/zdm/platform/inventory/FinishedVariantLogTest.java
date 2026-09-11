package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FinishedVariantLogTest {
  private final ObjectMapper json = new ObjectMapper();
  private final FinishedOperationLogService service = new FinishedOperationLogService(null, json, null, null);

  private Map<String, Object> snapshot() throws Exception {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("销售规格", json.readTree("[{\"variantKey\":\"a\",\"variantLabel\":\"规格1\",\"stock\":1},{\"variantKey\":\"b\",\"variantLabel\":\"规格2\",\"stock\":2}]"));
    result.put("指导价", json.readTree("[{\"variantKey\":\"a\",\"costPrice\":10,\"price\":20},{\"variantKey\":\"b\",\"costPrice\":30,\"price\":40}]"));
    result.put("层级价格", json.readTree("[{\"variantKey\":\"a\",\"storeLevelId\":1,\"price\":15},{\"variantKey\":\"b\",\"storeLevelId\":1,\"price\":35}]"));
    return result;
  }

  @Test void stockChangeRetainsAllPricesForOnlyChangedVariant() throws Exception {
    var before = snapshot(); var after = snapshot();
    var rows = (com.fasterxml.jackson.databind.node.ArrayNode) after.get("销售规格");
    ((com.fasterxml.jackson.databind.node.ObjectNode) rows.get(0)).put("stock", 3);
    Map<String, Object> changes = new LinkedHashMap<>(); changes.put("销售规格", Map.of());
    service.retainChangedVariants(before, after, changes);
    var data = json.valueToTree(changes);
    for (String field : new String[]{"销售规格", "指导价", "层级价格"}) {
      assertThat(data.path(field).path("before").size()).isEqualTo(1);
      assertThat(data.path(field).path("after").get(0).path("variantKey").asText()).isEqualTo("a");
    }
    assertThat(data.path("指导价").path("before").get(0).path("costPrice").asInt()).isEqualTo(10);
  }

  @Test void priceOnlyChangeIncludesSpecificationAndUnchangedGuidePrice() throws Exception {
    var before = snapshot(); var after = snapshot();
    ((com.fasterxml.jackson.databind.node.ObjectNode) ((com.fasterxml.jackson.databind.JsonNode) after.get("层级价格")).get(1)).put("price", 36);
    Map<String, Object> changes = new LinkedHashMap<>(); changes.put("层级价格", Map.of());
    service.retainChangedVariants(before, after, changes);
    var data = json.valueToTree(changes);
    assertThat(data.path("销售规格").path("before").size()).isEqualTo(1);
    assertThat(data.path("销售规格").path("before").get(0).path("variantKey").asText()).isEqualTo("b");
    assertThat(data.path("指导价").path("after").get(0).path("price").asInt()).isEqualTo(40);
  }

  @Test void merchantCodeChangeKeepsBothSidesWithoutIncludingOtherVariant() throws Exception {
    var before = snapshot(); var after = snapshot();
    for (String field : new String[]{"销售规格", "指导价", "层级价格"}) {
      ((com.fasterxml.jackson.databind.node.ObjectNode) ((com.fasterxml.jackson.databind.JsonNode) after.get(field)).get(0)).put("variantKey", "new-code");
    }
    Map<String, Object> changes = new LinkedHashMap<>(); changes.put("销售规格", Map.of());
    service.retainChangedVariants(before, after, changes);
    var data = json.valueToTree(changes);
    assertThat(data.path("销售规格").path("before").size()).isEqualTo(1);
    assertThat(data.path("销售规格").path("after").size()).isEqualTo(1);
    assertThat(data.path("销售规格").path("before").get(0).path("variantKey").asText()).isEqualTo("a");
    assertThat(data.path("销售规格").path("after").get(0).path("variantKey").asText()).isEqualTo("new-code");
  }
  @Test void recordsAllVariantsOnlyWhenAllChanged() throws Exception {
    var before = snapshot(); var after = snapshot();
    ((com.fasterxml.jackson.databind.JsonNode) after.get("销售规格")).forEach(row ->
        ((com.fasterxml.jackson.databind.node.ObjectNode) row).put("stock", 9));
    Map<String, Object> changes = new LinkedHashMap<>(); changes.put("销售规格", Map.of());
    service.retainChangedVariants(before, after, changes);
    assertThat(json.valueToTree(changes).path("销售规格").path("after").size()).isEqualTo(2);
  }

  @Test void deletionKeepsDeletedVariantBeforeAndEmptyAfter() throws Exception {
    var before = snapshot(); var after = snapshot();
    for (String field : new String[]{"销售规格", "指导价", "层级价格"}) {
      ((com.fasterxml.jackson.databind.node.ArrayNode) after.get(field)).remove(0);
    }
    Map<String, Object> changes = new LinkedHashMap<>(); changes.put("销售规格", Map.of());
    service.retainChangedVariants(before, after, changes);
    var data = json.valueToTree(changes);
    assertThat(data.path("销售规格").path("before").size()).isEqualTo(1);
    assertThat(data.path("销售规格").path("after").size()).isZero();
    assertThat(data.path("指导价").path("before").size()).isEqualTo(1);
  }

}
