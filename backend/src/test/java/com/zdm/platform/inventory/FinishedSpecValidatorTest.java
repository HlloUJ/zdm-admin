package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class FinishedSpecValidatorTest {
  @Test
  void rejectsDuplicateCombinationsAndUnknownValues() {
    FinishedProduct product = new FinishedProduct();
    product.setSpecDimensions(List.of(new FinishedSpecDimension("attribute_1", "尺寸", List.of("大", "小"))));
    FinishedProductVariant first = variant("大");
    product.setVariants(List.of(first, variant("大")));
    assertThatThrownBy(() -> FinishedSpecValidator.validate(product)).hasMessageContaining("组合重复");
    product.setVariants(List.of(first, variant("未知")));
    assertThatThrownBy(() -> FinishedSpecValidator.validate(product)).hasMessageContaining("不属于");
    product.setVariants(List.of(first, variant("小")));
    FinishedSpecValidator.validate(product);
  }

  private FinishedProductVariant variant(String value) {
    FinishedProductVariant variant = new FinishedProductVariant();
    variant.setDisplayMode("layered");
    variant.setSalesAttributes(Map.of("attribute_1", value));
    return variant;
  }
}
