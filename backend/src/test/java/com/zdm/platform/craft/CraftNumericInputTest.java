package com.zdm.platform.craft;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.validation.Validation;
import org.junit.jupiter.api.Test;

class CraftNumericInputTest {
  @Test
  void widthSupportsZeroAndTwoDecimalsWithoutAcceptingNegativeOrScientificInput() {
    try (var factory = Validation.buildDefaultValidatorFactory()) {
      var validator = factory.getValidator();
      var craft = new Craft();
      for (String value : new String[]{"", "0", "0.00", "12.50", "9007199254740993.12"}) {
        craft.setWidth(value);
        assertThat(validator.validateProperty(craft, "width")).isEmpty();
      }
      for (String value : new String[]{"-1", "1.234", "1e2", "12a3", "."}) {
        craft.setWidth(value);
        assertThat(validator.validateProperty(craft, "width")).isNotEmpty();
      }
    }
  }
}
