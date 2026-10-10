package com.zdm.platform.account;

import java.util.List;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Explicit business-service helper; never changes operation-log snapshots. */
@Component
public class CreatorNames {
  @Autowired
  private JdbcTemplate jdbc;

  public <T extends NamedCreatorOwned> T attach(T record) {
    if (record != null) { attachAll(java.util.List.of(record)); }
    return record;
  }

  public <T extends NamedCreatorOwned> List<T> attachAll(List<T> records) {
    var ids = records.stream().map(NamedCreatorOwned::getCreatedByAccountId)
        .filter(java.util.Objects::nonNull).distinct().toList();
    Map<Long, String> names = new HashMap<>();
    if (!ids.isEmpty()) {
      String placeholders = String.join(",", Collections.nCopies(ids.size(), "?"));
      jdbc.query("SELECT id,display_name FROM accounts WHERE id IN (" + placeholders + ")",
          rs -> { names.put(rs.getLong("id"), rs.getString("display_name")); }, ids.toArray());
    }
    records.forEach(record -> record.setCreatedByName(names.get(record.getCreatedByAccountId())));
    return records;
  }
}
