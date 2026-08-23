package com.zdm.platform.media;

import java.time.LocalDateTime;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MediaCleanupWorker {
  private final MediaAssetMapper assetMapper;
  private final MediaCleanupTaskMapper taskMapper;
  private final MediaReferenceMapper referenceMapper;
  private final MediaStorageService storageService;

  public MediaCleanupWorker(
      MediaAssetMapper assetMapper,
      MediaCleanupTaskMapper taskMapper,
      MediaReferenceMapper referenceMapper,
      MediaStorageService storageService) {
    this.assetMapper = assetMapper;
    this.taskMapper = taskMapper;
    this.referenceMapper = referenceMapper;
    this.storageService = storageService;
  }

  @Async
  @Transactional
  public void processAsync(Long taskId) {
    process(taskId);
  }

  @Transactional
  public CleanupResult process(Long taskId) {
    if (taskMapper.claim(taskId) == 0) {
      return CleanupResult.ofSkipped();
    }
    MediaCleanupTask task = taskMapper.selectById(taskId);
    MediaAsset asset = assetMapper.selectByIdForUpdate(task.getMediaId());
    if (asset == null || "deleted".equals(asset.getStatus())) {
      complete(task);
      return CleanupResult.ofSkipped();
    }
    if (referenceMapper.countByMediaId(asset.getId()) > 0) {
      asset.setStatus("active");
      asset.setPendingDeleteAt(null);
      assetMapper.updateById(asset);
      complete(task);
      return CleanupResult.ofSkipped();
    }

    try {
      asset.setStatus("pending_delete");
      asset.setPendingDeleteAt(LocalDateTime.now());
      assetMapper.updateById(asset);
      long releasedBytes = storageService.delete(asset.getStorageKey());
      asset.setStatus("deleted");
      asset.setDeletedAt(LocalDateTime.now());
      assetMapper.updateById(asset);
      complete(task);
      return CleanupResult.ofDeleted(releasedBytes);
    } catch (RuntimeException exception) {
      fail(task, exception);
      return CleanupResult.ofFailed();
    }
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
