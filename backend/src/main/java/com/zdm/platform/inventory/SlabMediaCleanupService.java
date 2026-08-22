package com.zdm.platform.inventory;

import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Objects;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class SlabMediaCleanupService {
  private static final Logger LOGGER = LoggerFactory.getLogger(SlabMediaCleanupService.class);
  private final SlabInventoryMapper inventoryMapper;
  private final SlabImageStorageService storageService;

  public SlabMediaCleanupService(SlabInventoryMapper inventoryMapper, SlabImageStorageService storageService) {
    this.inventoryMapper = inventoryMapper;
    this.storageService = storageService;
  }

  public List<String> mediaUrls(SlabInventory inventory) {
    if (inventory == null) return List.of();
    return Arrays.asList(
            inventory.getMainImageUrl(), inventory.getScanImageUrl(), inventory.getDesignImageUrl(),
            inventory.getVideoUrl(), inventory.getVideoCoverUrl())
        .stream().filter(Objects::nonNull).filter(value -> !value.isBlank()).distinct().toList();
  }

  public void cleanupAfterCommit(Collection<String> urls) {
    List<String> candidates = normalized(urls);
    if (candidates.isEmpty()) return;
    if (!TransactionSynchronizationManager.isSynchronizationActive()) {
      candidates.forEach(this::cleanupIfUnreferenced);
      return;
    }
    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
      @Override
      public void afterCommit() {
        candidates.forEach(SlabMediaCleanupService.this::cleanupIfUnreferenced);
      }
    });
  }

  public boolean cleanupIfUnreferenced(String url) {
    if (url == null || url.isBlank() || inventoryMapper.countMediaReferences(url) > 0) return false;
    try {
      return storageService.delete(url);
    } catch (RuntimeException exception) {
      LOGGER.warn("清理未引用的大板媒体失败: {}", url, exception);
      return false;
    }
  }

  private List<String> normalized(Collection<String> urls) {
    if (urls == null) return List.of();
    return new LinkedHashSet<>(urls).stream()
        .filter(Objects::nonNull).filter(value -> !value.isBlank()).toList();
  }
}
