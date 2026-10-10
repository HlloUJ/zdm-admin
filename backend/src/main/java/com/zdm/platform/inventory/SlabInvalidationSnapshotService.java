package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.zdm.platform.media.MediaAssetService;
import com.zdm.platform.media.MediaHistoryService;
import java.util.LinkedHashMap;
import java.util.Map;
import org.springframework.stereotype.Service;

/** Retains the operations view at invalidation, without copying or owning source files. */
@Service
public class SlabInvalidationSnapshotService {
  private static final String DOMAIN = "SLAB_OPERATIONS_INVALIDATION";
  private final ObjectMapper json;
  private final MediaHistoryService history;
  private final MediaAssetService assets;
  public SlabInvalidationSnapshotService(ObjectMapper json, MediaHistoryService history, MediaAssetService assets) {
    this.json = json; this.history = history; this.assets = assets;
  }
  public String capture(SlabInventory item) {
    Map<String, Long> media = new LinkedHashMap<>();
    media.put("mainImage", item.getMainImageMediaId());
    media.put("scanImage", item.getScanImageMediaId());
    media.put("designImage", item.getDesignImageMediaId());
    media.put("video", item.getVideoMediaId());
    media.put("videoCover", item.getVideoCoverMediaId());
    history.retain(DOMAIN, item.getId(), media);
    ObjectNode snapshot = json.valueToTree(item);
    snapshot.remove(java.util.List.of("mainImageUrl", "scanImageUrl", "designImageUrl", "videoUrl", "videoCoverUrl",
        "sourceUnavailable", "sourceMessage", "operationsSnapshotMissing", "offShelfRecords", "sourceOffShelfRecords"));
    try { return json.writeValueAsString(snapshot); }
    catch (JsonProcessingException error) { throw new IllegalStateException("大板失效快照保存失败", error); }
  }
  public SlabInventory render(SlabInventory current) {
    if (current.getOperationsInvalidatedSnapshot() == null) { return current; }
    try {
      SlabInventory frozen = json.readValue(current.getOperationsInvalidatedSnapshot(), SlabInventory.class);
      frozen.setCreatedByAccountId(current.getCreatedByAccountId());
      frozen.setOperationsInvalidatedSnapshot(current.getOperationsInvalidatedSnapshot());
      frozen.setOperationsInvalidatedAt(current.getOperationsInvalidatedAt());
      frozen.setOperationsInvalidatedReason(current.getOperationsInvalidatedReason());
      frozen.setOperationsDeleted(current.getOperationsDeleted());
      frozen.setSourceStatus(current.getSourceStatus());
      frozen.setSourceBlockReason(current.getSourceBlockReason());
      // Off-shelf history is append-only and scoped to the reading client.
      frozen.setOffShelfRecords(current.getOffShelfRecords());
      frozen.setSourceOffShelfRecords(current.getSourceOffShelfRecords());
      frozen.setMainImageUrl(url(frozen.getMainImageMediaId()));
      frozen.setScanImageUrl(url(frozen.getScanImageMediaId()));
      frozen.setDesignImageUrl(url(frozen.getDesignImageMediaId()));
      frozen.setVideoUrl(url(frozen.getVideoMediaId()));
      frozen.setVideoCoverUrl(url(frozen.getVideoCoverMediaId()));
      return frozen;
    } catch (JsonProcessingException error) { throw new IllegalStateException("大板失效快照读取失败", error); }
  }
  private String url(Long id) { return id == null ? null : assets.publicUrl(id); }
  public void release(Long id) { history.release(DOMAIN, id); }
}
