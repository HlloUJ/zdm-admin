ALTER TABLE markup_configurations
  ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER markup_rate;

CREATE TEMPORARY TABLE markup_configuration_order AS
SELECT
  id,
  ROW_NUMBER() OVER (PARTITION BY product_type ORDER BY created_at DESC, id DESC) AS order_position
FROM markup_configurations;

UPDATE markup_configurations configuration
JOIN markup_configuration_order ordered_configuration
  ON ordered_configuration.id = configuration.id
SET configuration.sort_order = ordered_configuration.order_position;

DROP TEMPORARY TABLE markup_configuration_order;

ALTER TABLE markup_configurations
  DROP INDEX idx_markup_configurations_type_status_created,
  ADD CONSTRAINT chk_markup_configurations_sort CHECK (sort_order > 0),
  ADD KEY idx_markup_configurations_type_status_sort
    (product_type, status, sort_order, id);
