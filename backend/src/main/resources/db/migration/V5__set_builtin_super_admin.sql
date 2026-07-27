UPDATE tenants
SET contact_name = '超级管理员',
    contact_phone = '15926626945'
WHERE id = 1;

UPDATE accounts
SET phone = '15926626945',
    display_name = '超级管理员',
    status = 'enabled'
WHERE id = 1;

UPDATE employees
SET name = '超级管理员',
    phone = '15926626945',
    status = 'enabled'
WHERE id = 1;

UPDATE roles
SET name = '超级管理员',
    code = 'SUPER_ADMIN',
    data_scope = 'all',
    status = 'enabled',
    remark = '系统内置超管角色'
WHERE id = 1;
