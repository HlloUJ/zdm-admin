package com.zdm.platform.media;

import java.time.LocalDateTime;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Async;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class MediaCleanupScheduler {
  private static final String LOCK_NAME = "zdm_platform_media_cleanup";
  private static final int BATCH_SIZE = 1000;

  private final JdbcTemplate jdbcTemplate;
  private final MediaAssetMapper assetMapper;
  private final MediaCleanupRunMapper runMapper;
  private final MediaCleanupService cleanupService;
  private final MediaCleanupTaskMapper taskMapper;
  private final MediaCleanupWorker worker;

  public MediaCleanupScheduler(
      JdbcTemplate jdbcTemplate,
      MediaAssetMapper assetMapper,
      MediaCleanupRunMapper runMapper,
      MediaCleanupService cleanupService,
      MediaCleanupTaskMapper taskMapper,
      MediaCleanupWorker worker) {
    this.jdbcTemplate = jdbcTemplate;
    this.assetMapper = assetMapper;
    this.runMapper = runMapper;
    this.cleanupService = cleanupService;
    this.taskMapper = taskMapper;
    this.worker = worker;
  }

  @Scheduled(cron = "${zdm.media.cleanup-cron:0 0 0 * * *}", zone = "${zdm.media.time-zone:Asia/Shanghai}")
  public void runNightlyCleanup() {
    runCleanup("scheduled");
  }

  @Scheduled(fixedDelayString = "${zdm.media.retry-delay-ms:60000}")
  public void retryFailedCleanup() {
    taskMapper.selectReady(LocalDateTime.now(), 100).forEach(task -> worker.processAsync(task.getId()));
  }

  @Async
  @EventListener(ApplicationReadyEvent.class)
  public void compensateMissedRun() {
    LocalDateTime lastSuccess = runMapper.selectLastSuccessfulFinish();
    if (lastSuccess == null || lastSuccess.isBefore(LocalDateTime.now().minusHours(24))) {
      runCleanup("startup_compensation");
    }
  }

  public MediaCleanupSummary runCleanup(String triggerType) {
    if (!acquireLock()) {
      return new MediaCleanupSummary(0, 0, 0, 0L, true);
    }
    MediaCleanupRun run = startRun(triggerType);
    int scanned = 0;
    int deleted = 0;
    int failed = 0;
    long releasedBytes = 0L;
    try {
      Set<Long> candidates = new LinkedHashSet<>();
      assetMapper.selectExpiredTemporary(LocalDateTime.now().minusHours(24), BATCH_SIZE)
          .forEach(asset -> candidates.add(asset.getId()));
      assetMapper.selectUnreferenced(BATCH_SIZE).forEach(asset -> candidates.add(asset.getId()));
      scanned = candidates.size();
      candidates.forEach(mediaId -> cleanupService.enqueue(mediaId, triggerType, "定时检查发现无有效引用", false));

      List<MediaCleanupTask> tasks = taskMapper.selectReady(LocalDateTime.now(), BATCH_SIZE);
      for (MediaCleanupTask task : tasks) {
        MediaCleanupWorker.CleanupResult result = worker.process(task.getId());
        if (result.deleted()) {
          deleted++;
        }
        if (result.failed()) {
          failed++;
        }
        releasedBytes += result.releasedBytes();
      }
      finishRun(run, scanned, deleted, failed, releasedBytes, failed == 0 ? "success" : "partial");
      return new MediaCleanupSummary(scanned, deleted, failed, releasedBytes, false);
    } catch (RuntimeException exception) {
      finishRun(run, scanned, deleted, failed + 1, releasedBytes, "failed");
      throw exception;
    } finally {
      releaseLock();
    }
  }

  private boolean acquireLock() {
    Integer acquired = jdbcTemplate.queryForObject("SELECT GET_LOCK(?, 0)", Integer.class, LOCK_NAME);
    return Integer.valueOf(1).equals(acquired);
  }

  private void releaseLock() {
    try {
      jdbcTemplate.queryForObject("SELECT RELEASE_LOCK(?)", Integer.class, LOCK_NAME);
    } catch (RuntimeException ignored) {
      // The run result is already persisted; a lost connection releases the MySQL advisory lock.
    }
  }

  private MediaCleanupRun startRun(String triggerType) {
    MediaCleanupRun run = new MediaCleanupRun();
    run.setTriggerType(triggerType);
    run.setScannedCount(0);
    run.setDeletedCount(0);
    run.setFailedCount(0);
    run.setReleasedBytes(0L);
    run.setStartedAt(LocalDateTime.now());
    run.setStatus("running");
    runMapper.insert(run);
    return run;
  }

  private void finishRun(
      MediaCleanupRun run,
      int scanned,
      int deleted,
      int failed,
      long releasedBytes,
      String status) {
    run.setScannedCount(scanned);
    run.setDeletedCount(deleted);
    run.setFailedCount(failed);
    run.setReleasedBytes(releasedBytes);
    run.setFinishedAt(LocalDateTime.now());
    run.setStatus(status);
    runMapper.updateById(run);
  }
}
