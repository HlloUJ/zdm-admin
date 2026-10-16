ALTER TABLE store_customers
  ADD COLUMN nationality VARCHAR(2) NOT NULL DEFAULT '' AFTER name,
  ADD COLUMN phone_region VARCHAR(2) NOT NULL DEFAULT '' AFTER phone,
  ADD COLUMN calling_code VARCHAR(4) NOT NULL DEFAULT '' AFTER phone_region;
