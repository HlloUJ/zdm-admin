package com.zdm.platform.media;

import java.time.LocalDateTime;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class MediaCleanupService {
  private final MediaAssetMapper assetMapper;
  private final MediaCleanupTaskMapper taskMapper;
  private final MediaCleanupWorker worker;

  public MediaCleanupService(
      MediaAssetMapper assetMapper,
      MediaCleanupTaskMapper taskMapper,
      MediaCleanupWorker worker) {
    this.assetMapper = assetMapper;
    this.taskMapper = taskMapper;
    this.worker = worker;
  }

  public void enqueueAfterCommit(Collection<Long> mediaIds, String reason) {
    List<Long> candidates = normalize(mediaIds);
    if (candidates.isEmpty()) {
      return;
    }
    Runnable enqueue = () -> candidates.forEach(mediaId -> enqueue(mediaId, "realtime", reason, true));
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      enqueue.run();
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
      @Override
      public void afterCommit() {
        enqueue.run();
      }
    });
  }

  public Long enqueue(Long mediaId, String triggerType, String reason, boolean async) {
    MediaAsset asset = assetMapper.selectById(mediaId);
    if (asset == null || "deleted".equals(asset.getStatus()) || taskMapper.countOpenByMediaId(mediaId) > 0) {
      return null;
    }
    MediaCleanupTask task = new MediaCleanupTask();
    task.setMediaId(mediaId);
    task.setTriggerType(triggerType);
    task.setReason(reason);
    task.setRetryCount(0);
    task.setNextRetryAt(LocalDateTime.now());
    task.setStatus("pending");
    taskMapper.insert(task);
    if (async) {
      worker.processAsync(task.getId());
    }
    return task.getId();
  }

  private List<Long> normalize(Collection<Long> mediaIds) {
    if (mediaIds == null) {
      return List.of();
    }
    return new LinkedHashSet<>(mediaIds).stream().filter(Objects::nonNull).toList();
  }
}
