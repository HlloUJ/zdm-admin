INSERT INTO platform_clients (code, name, status)
VALUES
  ('store', '门店端', 'enabled'),
  ('factory', '工厂端', 'enabled'),
  ('installer', '安装端', 'enabled'),
  ('supplier', '供应商端', 'enabled')
ON DUPLICATE KEY UPDATE
  name = VALUES(name),
  status = VALUES(status);
