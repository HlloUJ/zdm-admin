ALTER TABLE slab_varieties
  DROP INDEX uk_slab_varieties_code,
  DROP COLUMN code;

ALTER TABLE store_levels
  DROP INDEX uk_store_levels_code,
  DROP COLUMN code;
