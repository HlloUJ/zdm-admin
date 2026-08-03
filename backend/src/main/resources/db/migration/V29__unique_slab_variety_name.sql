UPDATE slab_varieties SET name = TRIM(name);

ALTER TABLE slab_varieties
ADD CONSTRAINT uk_slab_varieties_name UNIQUE (name);
