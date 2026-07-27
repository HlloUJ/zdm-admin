ALTER TABLE slab_varieties ADD COLUMN remark VARCHAR(255) AFTER color;

UPDATE slab_varieties
SET remark = '系统内置大板品种'
WHERE id = 1;
