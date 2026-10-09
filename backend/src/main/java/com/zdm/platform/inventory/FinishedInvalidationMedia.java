package com.zdm.platform.inventory;

import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaHistoryService;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Snapshot media is retained by ID; display URLs are generated only when reading. */
@Service
public class FinishedInvalidationMedia {
  private final JdbcTemplate jdbc;
  private final MediaAssetService assets;
  private final MediaHistoryService history;
  public FinishedInvalidationMedia(JdbcTemplate jdbc, MediaAssetService assets, MediaHistoryService history) {
    this.jdbc = jdbc; this.assets = assets; this.history = history;
  }
  public void capture(ObjectNode snapshot, Long productId, String domain, Long recordId) {
    Map<String, Long> references = new LinkedHashMap<>();
    jdbc.queryForList("SELECT field_key,media_id FROM media_references WHERE business_domain='FINISHED_PRODUCT' AND business_id=? ORDER BY field_key", productId)
        .forEach(row -> references.put((String) row.get("field_key"), ((Number) row.get("media_id")).longValue()));
    ObjectNode media = snapshot.putObject("_retainedMedia");
    references.forEach(media::put);
    snapshot.put("detail", jdbc.queryForObject("SELECT detail FROM finished_products WHERE id=?", String.class, productId));
    snapshot.remove(List.of("imageUrl", "imageUrls", "mainImageUrl", "mainImageUrls", "videoUrl"));
    history.retain(domain, recordId, references);
  }
  public void render(ObjectNode snapshot, boolean store) {
    var media = snapshot.path("_retainedMedia");
    var images = snapshot.putArray(store ? "imageUrls" : "mainImageUrls");
    media.fields().forEachRemaining(entry -> {
      if (entry.getKey().startsWith("mainImage")) { images.add(assets.publicUrl(entry.getValue().asLong())); }
    });
    if (!images.isEmpty()) { snapshot.set(store ? "imageUrl" : "mainImageUrl", images.get(0)); }
    if (media.has("video")) { snapshot.put("videoUrl", assets.publicUrl(media.path("video").asLong())); }
    snapshot.put("detail", new FinishedProductDetailContent(assets).render(snapshot.path("detail").asText("")));
    snapshot.remove("_retainedMedia");
  }
}
