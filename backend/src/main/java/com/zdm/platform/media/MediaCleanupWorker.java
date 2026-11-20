package com.zdm.platform.media;

import java.time.LocalDateTime;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

@Service
public class MediaCleanupWorker {
  private static final org.slf4j.Logger LOG = org.slf4j.LoggerFactory.getLogger(MediaCleanupWorker.class);
  private final MediaAssetMapper assetMapper;
  private final MediaCleanupTaskMapper taskMapper;
  private final MediaDeletionQuarantine quarantine;
  private final MediaRetentionService retention;
  private final org.springframework.transaction.support.TransactionTemplate transactions;
  private final org.springframework.transaction.support.TransactionTemplate independent;

  public MediaCleanupWorker(MediaAssetMapper assetMapper, MediaCleanupTaskMapper taskMapper,
      MediaDeletionQuarantine quarantine, MediaRetentionService retention,
      org.springframework.transaction.PlatformTransactionManager manager) {
    this.retention = retention;
    this.assetMapper = assetMapper;
    this.taskMapper = taskMapper;
    this.quarantine = quarantine;
    transactions = new org.springframework.transaction.support.TransactionTemplate(manager);
    independent = new org.springframework.transaction.support.TransactionTemplate(manager);
    independent.setPropagationBehavior(org.springframework.transaction.TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  @Async
  public void processAsync(Long taskId) { process(taskId); }

  public CleanupResult process(Long taskId) {
    boolean outer = org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive();
    try {
      boolean ready = Boolean.TRUE.equals(transactions.execute(status -> stage(taskId, outer)));
      if (!ready || outer) { return CleanupResult.ofSkipped(); }
      return independent.execute(status -> finish(taskId));
    } catch (RuntimeException exception) {
      if (outer) { throw exception; }
      recordFailure(taskId, exception);
      return CleanupResult.ofFailed();
    }
  }

  private boolean stage(Long taskId, boolean outer) {
    if (taskMapper.claim(taskId) == 0) { return false; }
    MediaCleanupTask task = taskMapper.selectById(taskId);
    MediaAsset asset = assetMapper.selectByIdForUpdate(task.getMediaId());
    if (asset == null) { throw new IllegalStateException("媒体登记缺失，不能证明删除完成"); }
    if ("deleted".equals(asset.getStatus())) {
      if (!quarantine.hasRecord(asset)) {
        // A previously completed legacy task is not a new deletion proof for a failed task.
        throw new IllegalStateException("媒体隔离凭证缺失，待核查");
      }
    } else {
      quarantine.restore(asset);
      MediaRetentionPolicy.Decision decision = retention.evaluate(asset);
      if (!decision.eligible() || !retention.deletionEnabled()) {
        complete(task);
        return false;
      }
      org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
          new org.springframework.transaction.support.TransactionSynchronization() {
            @Override public void afterCompletion(int status) {
              if (status == STATUS_ROLLED_BACK) { restoreAfterRollback(asset.getId()); }
            }
          });
      quarantine.stage(asset);
      asset.setStatus("deleted");
      asset.setPendingDeleteAt(LocalDateTime.now());
      asset.setDeletedAt(LocalDateTime.now());
      assetMapper.updateById(asset);
    }
    task.setStatus("pending");
    task.setNextRetryAt(LocalDateTime.now());
    taskMapper.updateById(task);
    if (outer) {
      org.springframework.transaction.support.TransactionSynchronizationManager.registerSynchronization(
          new org.springframework.transaction.support.TransactionSynchronization() {
            @Override public void afterCommit() {
              try { independent.execute(status -> finish(taskId)); }
              catch (RuntimeException exception) { recordFailure(taskId, exception); }
            }
          });
    }
    return true;
  }

  private CleanupResult finish(Long taskId) {
    if (taskMapper.claim(taskId) == 0) { return CleanupResult.ofSkipped(); }
    MediaCleanupTask task = taskMapper.selectById(taskId);
    MediaAsset asset = assetMapper.selectByIdForUpdate(task.getMediaId());
    if (asset == null || !"deleted".equals(asset.getStatus())) {
      throw new IllegalStateException("媒体删除提交状态不可确认");
    }
    long bytes = quarantine.finish(asset);
    complete(task);
    return CleanupResult.ofDeleted(bytes);
  }

  private void restoreAfterRollback(Long mediaId) {
    try {
      independent.executeWithoutResult(status -> {
        MediaAsset asset = assetMapper.selectByIdForUpdate(mediaId);
        if (asset != null && !"deleted".equals(asset.getStatus())) { quarantine.restore(asset); }
      });
    } catch (RuntimeException exception) {
      LOG.error("Media rollback restoration pending for {}", mediaId, exception);
    }
  }

  private void recordFailure(Long taskId, RuntimeException exception) {
    independent.executeWithoutResult(status -> {
      // Do not overwrite a success committed by another worker.
      MediaCleanupTask task = taskMapper.selectByIdForUpdate(taskId);
      if (task != null && !"success".equals(task.getStatus())) { fail(task, exception); }
    });
  }

  private void complete(MediaCleanupTask task) {
    task.setStatus("success");
    task.setLastError(null);
    task.setNextRetryAt(null);
    taskMapper.updateById(task);
  }

  private void fail(MediaCleanupTask task, RuntimeException exception) {
    int retryCount = task.getRetryCount() == null ? 1 : task.getRetryCount() + 1;
    task.setRetryCount(retryCount);
    task.setStatus("failed");
    task.setLastError(limitMessage(exception.getMessage()));
    task.setNextRetryAt(LocalDateTime.now().plusMinutes(Math.min(60L, retryCount * 5L)));
    taskMapper.updateById(task);
  }

  private String limitMessage(String message) {
    if (message == null || message.isBlank()) {
      return "媒体文件删除失败";
    }
    return message.length() <= 500 ? message : message.substring(0, 500);
  }

  public record CleanupResult(boolean deleted, boolean failed, long releasedBytes) {
    static CleanupResult ofDeleted(long releasedBytes) {
      return new CleanupResult(true, false, releasedBytes);
    }

    static CleanupResult ofFailed() {
      return new CleanupResult(false, true, 0L);
    }

    static CleanupResult ofSkipped() {
      return new CleanupResult(false, false, 0L);
    }
  }
}
