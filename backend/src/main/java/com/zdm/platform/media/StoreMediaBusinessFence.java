package com.zdm.platform.media;

import java.util.Map;
import org.springframework.stereotype.Component;

/** Locks the explicitly registered store-owned media domains; upstream/shared media behavior is unchanged. */
@Component
public class StoreMediaBusinessFence {
  private static final Map<String, String> TABLES = com.zdm.platform.storeexit.StoreExitMediaDomains.PARENTS;
  private final com.zdm.platform.storeexit.StoreExitTargetService targets;
  public StoreMediaBusinessFence(com.zdm.platform.storeexit.StoreExitTargetService targets) { this.targets = targets; }
  public void requireParent(String domain, Long id) {
    String table = TABLES.get(domain);
    if (table != null && !targets.lockParent(table, id)) {
      throw new IllegalArgumentException("门店业务对象已不存在，不能重新写入媒体引用");
    }
  }
}
