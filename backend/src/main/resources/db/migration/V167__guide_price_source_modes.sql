-- Existing guide-price amounts, coefficients and SKU ownership stay unchanged.
ALTER TABLE finished_product_guide_prices
    ADD COLUMN price_source VARCHAR(16) NOT NULL DEFAULT 'manual',
    ADD CONSTRAINT chk_finished_guide_price_source CHECK (price_source IN ('auto', 'manual'));
ALTER TABLE accessory_product_guide_prices
    ADD COLUMN price_source VARCHAR(16) NOT NULL DEFAULT 'manual',
    ADD CONSTRAINT chk_accessory_guide_price_source CHECK (price_source IN ('auto', 'manual'));
