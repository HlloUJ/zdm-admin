package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

class FinishedSourceMessageTest {
  @ParameterizedTest
  @CsvSource(delimiter = '，', value = {
      "供应链已下架该商品，该商品已被供应链下架",
      "供应链已将该商品删除至回收站，该商品已被供应链删除至回收站",
      "供应链已彻底删除该商品，该商品已被供应链彻底删除",
      "运营端已下架该商品，该商品已被运营管理平台下架",
      "运营端已将该商品删除至回收站，该商品已被运营管理平台删除至回收站",
      "运营端已彻底删除该商品，该商品已被运营管理平台彻底删除"
  })
  void unifiesNewAndPersistedReasonsWithoutChangingSourceIdentity(String historical, String expected) {
    assertThat(FinishedSourceMessage.normalize(historical)).isEqualTo(expected);
    assertThat(FinishedSourceMessage.normalize(historical + "，请彻底删除后重新选择")).isEqualTo(expected);
    assertThat(FinishedSourceMessage.normalize(expected + "，请彻底删除后重新获取")).isEqualTo(expected);
    FinishedProduct product = new FinishedProduct();
    product.setSourceStatus("selling");
    product.setOperationsInvalidatedReason(historical + "，请彻底删除后重新获取");
    assertThat(product.getSourceMessage()).isEqualTo(expected);
    assertThat(product.isSourceUnavailable()).isTrue();
  }
}
