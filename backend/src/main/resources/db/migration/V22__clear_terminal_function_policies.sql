UPDATE roles
SET function_permissions = ''
WHERE category = 'terminal-policy'
  AND code IN ('TERMINAL_STORE_POLICY', 'TERMINAL_SUPPLIER_POLICY');
