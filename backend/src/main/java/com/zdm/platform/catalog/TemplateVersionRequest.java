package com.zdm.platform.catalog;

import com.fasterxml.jackson.databind.JsonNode;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record TemplateVersionRequest(@NotNull Integer revision, @NotNull JsonNode content,
    @Size(max = 500) String changeNote) {}
