package com.zdm.platform.inventory;

/**
 * @deprecated 商品发布后价格归商品所有，价格配置不得再回填历史商品。
 */
@Deprecated(forRemoval = true)
public class PriceConfigurationBackfillService {
  public int backfillSlabs(SlabMarkupConfiguration configuration) {
    return 0;
  }

  public int backfillFinishedProducts(FinishedMarkupConfiguration configuration) {
    return 0;
  }
}
