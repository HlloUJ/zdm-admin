package com.zdm.platform.media;

import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class MediaAuditService {
  private final MediaAssetMapper assetMapper;
  private final MediaReferenceMapper referenceMapper;
  private final MediaStorageService storageService;

  public MediaAuditService(
      MediaAssetMapper assetMapper,
      MediaReferenceMapper referenceMapper,
      MediaStorageService storageService) {
    this.assetMapper = assetMapper;
    this.referenceMapper = referenceMapper;
    this.storageService = storageService;
  }

  public MediaAuditSummary audit() {
    List<String> registered = assetMapper.selectRegisteredStorageKeys();
    List<String> physical = storageService.listManagedFiles().stream()
        .map(MediaStorageService.StoredFile::storageKey)
        .sorted()
        .toList();
    Set<String> registeredSet = new HashSet<>(registered);
    Set<String> physicalSet = new HashSet<>(physical);
    List<String> unregistered = physical.stream()
        .filter(storageKey -> !registeredSet.contains(storageKey))
        .toList();
    List<String> missing = registered.stream()
        .filter(storageKey -> !physicalSet.contains(storageKey))
        .sorted()
        .toList();
    return new MediaAuditSummary(
        registered.size(),
        referenceMapper.countAll(),
        physical.size(),
        unregistered,
        missing,
        assetMapper.selectUnreferencedStorageKeys());
  }
}
