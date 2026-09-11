package com.zdm.platform.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import java.time.OffsetDateTime;

public record TemplateVersion(
    Long id, Long categoryId, Integer versionNo, String state, int revision, JsonNode content, String createdByName,
    String publishedByName, String changeNote, OffsetDateTime createdAt, OffsetDateTime publishedAt, Long createdByAccountId) {}
