package com.zdm.platform.catalog;

public record ProductAttributeDeleteResult(
    String deletionMode,
    long attributeValueCount) {}
