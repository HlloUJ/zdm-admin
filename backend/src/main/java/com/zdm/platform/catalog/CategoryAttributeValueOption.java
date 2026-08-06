package com.zdm.platform.catalog;

public record CategoryAttributeValueOption(
    Long id,
    String value,
    String code,
    String status,
    boolean selected) {}
