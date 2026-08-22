package com.zdm.platform.media;

import java.util.List;

public record MediaAuditSummary(
    int registeredCount,
    long referenceCount,
    int physicalFileCount,
    List<String> unregisteredPhysicalFiles,
    List<String> missingPhysicalFiles,
    List<String> unreferencedRegisteredFiles) {
  public MediaAuditSummary {
    unregisteredPhysicalFiles = List.copyOf(unregisteredPhysicalFiles);
    missingPhysicalFiles = List.copyOf(missingPhysicalFiles);
    unreferencedRegisteredFiles = List.copyOf(unreferencedRegisteredFiles);
  }
}
