ALTER TABLE slab_inventory
  MODIFY COLUMN length_mm DECIMAL(12, 2) NULL,
  MODIFY COLUMN width_mm DECIMAL(12, 2) NULL,
  MODIFY COLUMN thickness_mm DECIMAL(12, 2) NULL,
  ADD COLUMN tolerance_mm DECIMAL(12, 2) NULL AFTER thickness_mm,
  ADD COLUMN corner1_length_mm DECIMAL(12, 2) NULL AFTER tolerance_mm,
  ADD COLUMN corner1_width_mm DECIMAL(12, 2) NULL AFTER corner1_length_mm,
  ADD COLUMN corner2_length_mm DECIMAL(12, 2) NULL AFTER corner1_width_mm,
  ADD COLUMN corner2_width_mm DECIMAL(12, 2) NULL AFTER corner2_length_mm,
  ADD COLUMN corner3_length_mm DECIMAL(12, 2) NULL AFTER corner2_width_mm,
  ADD COLUMN corner3_width_mm DECIMAL(12, 2) NULL AFTER corner3_length_mm,
  ADD COLUMN corner4_length_mm DECIMAL(12, 2) NULL AFTER corner3_width_mm,
  ADD COLUMN corner4_width_mm DECIMAL(12, 2) NULL AFTER corner4_length_mm;
