ALTER TABLE tenants
  DROP INDEX uk_tenants_name,
  ADD UNIQUE KEY uk_tenants_contact_phone (contact_phone);
