package com.zdm.platform.media;

public record MediaCleanupSummary(
    int scannedCount, int deletedCount, int failedCount, long releasedBytes, boolean skippedByLock) {}
