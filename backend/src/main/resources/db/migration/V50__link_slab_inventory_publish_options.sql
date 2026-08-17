ALTER TABLE slab_inventory
  ADD COLUMN texture_id BIGINT NULL AFTER variety_id,
  ADD COLUMN color_id BIGINT NULL AFTER texture_id,
  ADD COLUMN grade_id BIGINT NULL AFTER color_id,
  ADD KEY idx_slab_inventory_texture_id (texture_id),
  ADD KEY idx_slab_inventory_color_id (color_id),
  ADD KEY idx_slab_inventory_grade_id (grade_id),
  ADD CONSTRAINT fk_slab_inventory_texture
    FOREIGN KEY (texture_id) REFERENCES slab_textures (id),
  ADD CONSTRAINT fk_slab_inventory_color
    FOREIGN KEY (color_id) REFERENCES slab_colors (id),
  ADD CONSTRAINT fk_slab_inventory_grade
    FOREIGN KEY (grade_id) REFERENCES slab_grades (id);
