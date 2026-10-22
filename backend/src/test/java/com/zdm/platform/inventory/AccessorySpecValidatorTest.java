package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class AccessorySpecValidatorTest {
  @Test
  void rejectsDuplicateCombinationsAndUnknownValues() {
    AccessoryProduct product = new AccessoryProduct();
    product.setSpecDimensions(List.of(new AccessorySpecDimension("attribute_1", "尺寸", List.of("大", "小"))));
    AccessoryProductVariant first = variant("大");
    product.setVariants(List.of(first, variant("大")));
    assertThatThrownBy(() -> AccessorySpecValidator.validate(product)).hasMessageContaining("组合重复");
    product.setVariants(List.of(first, variant("未知")));
    assertThatThrownBy(() -> AccessorySpecValidator.validate(product)).hasMessageContaining("不属于");
    product.setVariants(List.of(first, variant("小")));
    AccessorySpecValidator.validate(product);
  }

  private AccessoryProductVariant variant(String value) {
    AccessoryProductVariant variant = new AccessoryProductVariant();
    variant.setDisplayMode("layered");
    variant.setSalesAttributes(Map.of("attribute_1", value));
    return variant;
  }
}
