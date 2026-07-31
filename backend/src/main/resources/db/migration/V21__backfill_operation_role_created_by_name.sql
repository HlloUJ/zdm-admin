UPDATE roles
SET created_by_name = '韩健'
WHERE category = 'operation-platform'
  AND name IN ('超级管理员', '管理员', '运营')
  AND (created_by_name IS NULL OR created_by_name = '');
