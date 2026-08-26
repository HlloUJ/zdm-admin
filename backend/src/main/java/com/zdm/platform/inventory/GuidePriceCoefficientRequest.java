package com.zdm.platform.inventory;

import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;

public record GuidePriceCoefficientRequest(
    @NotNull @DecimalMin("1.0000") @Digits(integer = 3, fraction = 4) BigDecimal priceCoefficient) {}
