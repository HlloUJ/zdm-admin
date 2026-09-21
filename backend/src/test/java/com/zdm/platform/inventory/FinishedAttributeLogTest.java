package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.media.MediaHistoryService;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FinishedAttributeLogTest {
  private final ObjectMapper json = new ObjectMapper();
  private FinishedOperationLog saved;

  private FinishedOperationLogService service() {
    CurrentIdentityProvider identities = mock(CurrentIdentityProvider.class);
    when(identities.require()).thenReturn(new CurrentIdentity(1L, 1L, 1L, 1L,
        "supply-chain", null, null, "测试人员", "all", List.of(), List.of()));
    return new FinishedOperationLogService(null, json, identities, mock(MediaHistoryService.class)) {
      @Override public boolean save(FinishedOperationLog log) {
        saved = log;
        log.setId(1L);
        return true;
      }
    };
  }

  private Map<String, Object> snapshot(String attributes) throws Exception {
    Map<String, Object> result = new LinkedHashMap<>();
    result.put("商品属性", json.readTree(attributes));
    result.put("状态", "warehouse");
    result.put("媒体", List.of());
    return result;
  }

  private static final String ORIGINAL = """
      [{"attributeId":1,"attributeName":"材质","value":"石材"},
       {"attributeId":2,"attributeName":"颜色","value":"白"},
       {"attributeId":3,"attributeName":"尺寸","value":"大"}]
      """;

  @Test void persistsOnlyAddedModifiedAndRemovedAttributes() throws Exception {
    var before = snapshot(ORIGINAL);
    var after = snapshot("""
        [{"attributeId":2,"attributeName":"颜色","value":"黑"},
         {"attributeId":1,"attributeName":"材质","value":"石材"},
         {"attributeId":4,"attributeName":"纹理","value":"直纹"}]
        """);
    service().record(new FinishedProduct(), before, after);
    JsonNode change = json.readTree(saved.getChangeDetails()).path("商品属性");
    assertThat(change.path("before")).isEqualTo(json.readTree("""
        [{"attributeId":2,"attributeName":"颜色","value":"白"},
         {"attributeId":3,"attributeName":"尺寸","value":"大"}]
        """));
    assertThat(change.path("after")).isEqualTo(json.readTree("""
        [{"attributeId":2,"attributeName":"颜色","value":"黑"},
         {"attributeId":4,"attributeName":"纹理","value":"直纹"}]
        """));
    assertThat(change.path("changeTypes")).isEqualTo(json.readTree("""
        {"2":"MODIFY","3":"REMOVE","4":"ADD"}
        """));
    assertThat(saved.getChangeDetails()).doesNotContain("材质");
    assertThat(((JsonNode) before.get("商品属性")).size()).isEqualTo(3);
  }

  @Test void reorderingAloneDoesNotCreateLog() throws Exception {
    var before = snapshot(ORIGINAL);
    var after = snapshot("""
        [{"attributeId":3,"attributeName":"尺寸","value":"大"},
         {"attributeId":1,"attributeName":"材质","value":"石材"},
         {"attributeId":2,"attributeName":"颜色","value":"白"}]
        """);
    after.put("字段顺序", Map.of("product", List.of("3", "1", "2"), "sales", List.of()));
    service().record(new FinishedProduct(), before, after);
    assertThat(saved).isNull();
  }

  @Test void unchangedAttributesAreOmittedWhenAnotherFieldChanges() throws Exception {
    var before = snapshot(ORIGINAL); var after = snapshot(ORIGINAL);
    before.put("商品名称", "旧商品"); after.put("商品名称", "新商品");
    service().record(new FinishedProduct(), before, after);
    assertThat(json.readTree(saved.getChangeDetails()).has("商品属性")).isFalse();
  }

  @Test void creationAndPurgeKeepCompleteSnapshots() throws Exception {
    var snapshot = snapshot(ORIGINAL);
    var service = service();
    service.record(new FinishedProduct(), null, snapshot);
    assertThat(saved.getOperationType()).isEqualTo("CREATE");
    assertThat(json.readTree(saved.getChangeDetails()).path("商品属性").path("after"))
        .isEqualTo(snapshot.get("商品属性"));
    service.record(new FinishedProduct(), snapshot, null);
    assertThat(saved.getOperationType()).isEqualTo("PURGE");
    assertThat(json.readTree(saved.getChangeDetails()).path("商品属性").path("before"))
        .isEqualTo(snapshot.get("商品属性"));
  }

  @Test void editsFreezeLatestOrderForBothComparisonSides() throws Exception {
    var before = snapshot(ORIGINAL);
    var after = snapshot(ORIGINAL.replace("石材", "木材"));
    var oldOrder = Map.of("product", List.of("1", "2", "3"), "sales", List.of("a", "b"));
    var newOrder = Map.of("product", List.of("3", "1", "2"), "sales", List.of("b", "a"));
    before.put("字段顺序", oldOrder);
    after.put("字段顺序", newOrder);
    service().record(new FinishedProduct(), before, after);
    var recorded = json.readTree(saved.getChangeDetails()).path("字段顺序");
    assertThat(recorded.path("before")).isEqualTo(json.valueToTree(newOrder));
    assertThat(recorded.path("after")).isEqualTo(json.valueToTree(newOrder));
    assertThat(before.get("字段顺序")).isEqualTo(oldOrder);
  }

  @Test void removingAllAttributesKeepsOldValuesAndEmptyAfter() throws Exception {
    service().record(new FinishedProduct(), snapshot(ORIGINAL), snapshot("[]"));
    var change = json.readTree(saved.getChangeDetails()).path("商品属性");
    assertThat(change.path("before").size()).isEqualTo(3);
    assertThat(change.path("after").size()).isZero();
    assertThat(change.path("changeTypes").path("1").asText()).isEqualTo("REMOVE");
  }
}
