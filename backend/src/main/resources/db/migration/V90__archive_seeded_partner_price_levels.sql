ALTER TABLE slab_markup_configurations
  ADD COLUMN legacy_seeded TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

ALTER TABLE finished_markup_configurations
  ADD COLUMN legacy_seeded TINYINT(1) NOT NULL DEFAULT 0 AFTER status;

UPDATE slab_markup_configurations
SET legacy_seeded = 1,
    status = 'disabled'
WHERE created_by_account_id = 1
  AND created_by_name = '韩健'
  AND (
    (name = '1级合伙人价格' AND price_coefficient = 1.1000)
    OR (name = '2级合伙人价格' AND price_coefficient = 1.2000)
    OR (name = '3级合伙人价格' AND price_coefficient = 1.3000)
  );

UPDATE finished_markup_configurations
SET legacy_seeded = 1,
    status = 'disabled'
WHERE created_by_account_id = 1
  AND created_by_name = '韩健'
  AND (
    (name = '1级合伙人价格' AND price_coefficient = 1.1000)
    OR (name = '2级合伙人价格' AND price_coefficient = 1.2000)
    OR (name = '3级合伙人价格' AND price_coefficient = 1.3000)
  );
