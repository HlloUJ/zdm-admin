package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ProductAttributeVersionTest {
  private final ObjectMapper json = new ObjectMapper();
  private final ProductAttributeVersionService versions = new ProductAttributeVersionService(null, json, null);
  private JsonNode read(String value) throws Exception { return json.readTree(value); }
  private JsonNode definition() throws Exception {
    return read("""
        [{"attributeId":53,"name":"数字商品属性","attributeRole":"product","valueType":"number","requiredFlag":true},
         {"attributeId":57,"name":"历史选项","attributeRole":"sales","valueType":"select","requiredFlag":true,"options":[{"value":"旧选项"}]}]
        """);
  }
  private JsonNode product(String value, String sales, Long id) throws Exception {
    var product = json.createObjectNode();
    product.set("attributes", read("[{\"attributeId\":53,\"value\":\"" + value + "\"}]"));
    var variant = product.putArray("variants").addObject();
    if (id != null) { variant.put("id", id); }
    variant.putObject("salesAttributes").put("attribute_57", sales);
    return product;
  }
  @Test void newValuesUseBoundTypesAndOptions() throws Exception {
    assertThatCode(() -> versions.validate(definition(), product("12.3", "旧选项", null), null)).doesNotThrowAnyException();
    assertThatThrownBy(() -> versions.validate(definition(), product("文本", "旧选项", null), null)).hasMessageContaining("数字");
    assertThatThrownBy(() -> versions.validate(definition(), product("12", "最新版本选项", null), null)).hasMessageContaining("绑定版本");
  }
  @Test void onlyUnchangedStoredValuesReceiveCompatibility() throws Exception {
    var previous = product("历史文本", "历史无效选项", 8L);
    assertThatCode(() -> versions.validate(definition(), previous.deepCopy(), previous)).doesNotThrowAnyException();
    var spaced = product(" 历史文本 ", "历史无效选项", 8L);
    assertThat(versions.unchangedProductAttributes(spaced, spaced.deepCopy())).containsEntry(53L, " 历史文本 ");
    assertThatThrownBy(() -> versions.validate(definition(), product("另一段文本", "历史无效选项", 8L), previous)).hasMessageContaining("数字");
    assertThatThrownBy(() -> versions.validate(definition(), product("历史文本", "历史无效选项", null), previous)).hasMessageContaining("有效选项");
    assertThatThrownBy(() -> versions.validate(definition(), product("历史文本", "历史无效选项", 99L), previous)).hasMessageContaining("有效选项");
    assertThatCode(() -> versions.validate(definition(), product("12", "旧选项", 8L), previous)).doesNotThrowAnyException();
    assertThatThrownBy(() -> versions.validate(definition(), previous, product("12", "旧选项", 8L))).hasMessageContaining("数字");
  }
  @Test void requiredDeletionAndUnknownVersionFieldsAreRejected() throws Exception {
    var previous = product("12", "旧选项", 8L);
    var removed = product("", "旧选项", 8L);
    assertThatThrownBy(() -> versions.validate(definition(), removed, previous)).hasMessageContaining("请填写");
    var unknown = product("12", "旧选项", 8L);
    ((com.fasterxml.jackson.databind.node.ObjectNode)unknown.path("variants").get(0).path("salesAttributes")).put("attribute_58", "新版本字段");
    assertThatThrownBy(() -> versions.validate(definition(), unknown, previous)).hasMessageContaining("绑定版本");
    var alias = product("12", "旧选项", 8L);
    ((com.fasterxml.jackson.databind.node.ObjectNode)alias.path("variants").get(0).path("salesAttributes")).put("attribute_00057", "值");
    assertThatThrownBy(() -> versions.validate(definition(), alias, previous)).hasMessageContaining("绑定版本");
  }
  @Test void historicallyMissingRequiredFieldsRemainMissingUntilEdited() throws Exception {
    var previous = read("{\"attributes\":[],\"variants\":[{\"id\":8,\"salesAttributes\":{}}]}");
    assertThatCode(() -> versions.validate(definition(), previous.deepCopy(), previous)).doesNotThrowAnyException();
    var spaced = product(" 历史文本 ", "历史无效选项", 8L);
    assertThat(versions.unchangedProductAttributes(spaced, spaced.deepCopy())).containsEntry(53L, " 历史文本 ");
    assertThatThrownBy(() -> versions.validate(definition(), previous, null)).hasMessageContaining("请填写");
  }
  @Test void versionIdentityAndMissingBindingCannotBeBypassed() throws Exception {
    assertThatCode(() -> ProductAttributeVersionService.requireBinding(34L, 2, 34L, 2, definition())).doesNotThrowAnyException();
    assertThatThrownBy(() -> ProductAttributeVersionService.requireBinding(35L, 2, 34L, 2, definition())).hasMessageContaining("不能切换");
    assertThatThrownBy(() -> ProductAttributeVersionService.requireBinding(null, null, null, null, null)).hasMessageContaining("尚未绑定");
  }
  @Test void bothSourceModelsKeepTheirDefinitionIndependentOfExternalMutation() throws Exception {
    var definition = definition();
    var finished = new FinishedProduct(); var accessory = new AccessoryProduct();
    finished.setAttributeTemplateSnapshot(definition); accessory.setAttributeTemplateSnapshot(definition);
    ((com.fasterxml.jackson.databind.node.ObjectNode)definition.get(0)).put("name", "新名称");
    assertThat(finished.getAttributeTemplateSnapshot().get(0).path("name").asText()).isEqualTo("数字商品属性");
    assertThat(accessory.getAttributeTemplateSnapshot().get(0).path("name").asText()).isEqualTo("数字商品属性");
    assertThat(ProductAttributeVersionService.usedNames(finished.getAttributeTemplateSnapshot(), product("12", "旧选项", 8L).path("variants"))).containsOnlyKeys("attribute_57");
  }
  @Test void twoDecimalPrecisionAppliesToNewValuesWithoutTakingLegacySkuExemptions() throws Exception {
    var numeric = definition().deepCopy();
    ((com.fasterxml.jackson.databind.node.ObjectNode)numeric.get(1)).put("valueType", "number");
    var previous = product("1.234", "2.345", 8L);
    assertThatCode(() -> versions.validate(numeric, previous.deepCopy(), previous)).doesNotThrowAnyException();
    assertThatThrownBy(() -> versions.validate(numeric, product("1.234", "2.34", 8L), null)).hasMessageContaining("两位小数");
    assertThatThrownBy(() -> versions.validate(numeric, product("1.234", "2.345", null), previous)).hasMessageContaining("两位小数");
    assertThatThrownBy(() -> versions.validate(numeric, product("1.234", "3.456", 8L), previous)).hasMessageContaining("两位小数");
    assertThatCode(() -> versions.validate(numeric, product("-1.20", "0.00", null), null)).doesNotThrowAnyException();
  }

}
