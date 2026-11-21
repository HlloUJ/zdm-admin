package com.zdm.platform.media;

import com.zdm.platform.storeexit.StoreExitMediaDomains;
import com.zdm.platform.storeexit.StoreExitRecoveryState;
import com.zdm.platform.storeexit.StoreExitTargetService;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/** Preview ownership follows the history's business parent, never the original file's uploader. */
@Service
public class MediaPreviewReferenceService {
  private final JdbcTemplate jdbc;
  private final StoreExitRecoveryState recovery;
  private final StoreExitTargetService targets;

  public MediaPreviewReferenceService(JdbcTemplate jdbc, StoreExitRecoveryState recovery, StoreExitTargetService targets) {
    this.jdbc = jdbc; this.recovery = recovery; this.targets = targets;
  }

  /** Applied inside EXISTS before the candidate LIMIT, so blocked histories do not fill the queue. */
  public String eligibleHistorySql() {
    var domains = StoreExitMediaDomains.PARENTS.entrySet().stream().sorted(Map.Entry.comparingByKey()).toList();
    String shared = "r.business_domain NOT IN ('" + domains.stream().map(Map.Entry::getKey).collect(Collectors.joining("','")) + "')";
    try { recovery.requireCatalogAvailable(); }
    catch (IllegalStateException unavailable) { return "(" + shared + ")"; }
    Set<Long> blocked = recovery.blockedStoreIds();
    String restriction = blocked.isEmpty() ? "" : " AND s.id NOT IN (" + blocked.stream().sorted().map(String::valueOf).collect(Collectors.joining(",")) + ")";
    List<String> eligible = new ArrayList<>(); eligible.add(shared);
    for (var domain : domains) {
      String join = "store_customer_followups".equals(domain.getValue())
          ? " JOIN store_customers c ON c.id=p.customer_id JOIN stores s ON s.id=c.store_id"
          : " JOIN stores s ON s.id=p.store_id";
      eligible.add("(r.business_domain='" + domain.getKey() + "' AND EXISTS (SELECT 1 FROM " + domain.getValue()
          + " p" + join + " WHERE p.id=r.business_id" + restriction + "))");
    }
    return "(" + String.join(" OR ", eligible) + ")";
  }

  private record History(long id, String domain, Long businessId, Long storeId) { }

  /** Hold roots and existing business parents until the outer preview transaction ends. */
  @Transactional(propagation = Propagation.MANDATORY)
  public List<Long> lockHistoryReferences(Long mediaId) {
    var rows = jdbc.query("SELECT r.id,r.business_domain,r.business_id FROM media_references r WHERE r.media_id=? AND r.reference_kind='HISTORY' AND "
        + eligibleHistorySql() + " ORDER BY r.id", (rs, index) -> new History(rs.getLong(1), rs.getString(2), rs.getLong(3), null), mediaId);
    List<History> histories = new ArrayList<>();
    for (var row : rows) {
      String table = StoreExitMediaDomains.PARENTS.get(row.domain());
      Long owner = table == null ? null : targets.parentStoreId(table, row.businessId());
      if (table == null || owner != null) { histories.add(new History(row.id(), row.domain(), row.businessId(), owner)); }
    }
    Set<Long> writable = Set.copyOf(targets.lockStores(histories.stream().map(History::storeId).filter(java.util.Objects::nonNull).toList()));
    List<Long> allowed = new ArrayList<>();
    for (var row : histories) {
      if (row.storeId() == null || writable.contains(row.storeId())
          && targets.lockExistingParent(StoreExitMediaDomains.PARENTS.get(row.domain()), row.businessId(), row.storeId())) {
        allowed.add(row.id());
      }
    }
    return List.copyOf(allowed);
  }
}
