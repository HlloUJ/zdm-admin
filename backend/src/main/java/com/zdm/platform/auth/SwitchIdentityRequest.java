package com.zdm.platform.auth;

import jakarta.validation.constraints.NotNull;

public record SwitchIdentityRequest(@NotNull Long identityId) {}
