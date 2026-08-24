UPDATE slab_markup_configurations
SET legacy_seeded = 0,
    status = 'enabled'
WHERE legacy_seeded = 1;

UPDATE finished_markup_configurations
SET legacy_seeded = 0,
    status = 'enabled'
WHERE legacy_seeded = 1;
