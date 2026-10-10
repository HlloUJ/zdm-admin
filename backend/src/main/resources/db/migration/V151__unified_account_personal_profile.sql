-- Personal information belongs to one account; organization relationships retain only their own metadata.
DELIMITER //
CREATE PROCEDURE validate_unified_account_profile()
BEGIN
  IF EXISTS (SELECT 1 FROM employees e LEFT JOIN accounts a ON a.id=e.account_id
      WHERE a.id IS NULL OR NOT (e.name <=> a.display_name) OR NOT (e.phone <=> a.phone))
    OR EXISTS (SELECT 1 FROM supply_chain_admin_profiles p
      JOIN account_identities i ON i.id=p.identity_id JOIN accounts a ON a.id=i.account_id
      WHERE NOT (p.name <=> a.display_name)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve account and identity personal profile differences before migration';
  END IF;
  IF EXISTS (SELECT account_id FROM (
      SELECT account_id,NULLIF(gender,'') AS gender FROM employees
      UNION ALL
      SELECT i.account_id,NULLIF(p.gender,'') FROM supply_chain_admin_profiles p
        JOIN account_identities i ON i.id=p.identity_id
    ) profiles GROUP BY account_id HAVING COUNT(DISTINCT gender)>1)
    OR EXISTS (SELECT 1 FROM employees WHERE gender IS NOT NULL AND gender NOT IN ('','male','female')) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='Resolve conflicting or invalid account genders before migration';
  END IF;
END//
DELIMITER ;
CALL validate_unified_account_profile();
DROP PROCEDURE validate_unified_account_profile;

ALTER TABLE accounts ADD COLUMN gender VARCHAR(10) NULL AFTER display_name,
  ADD CONSTRAINT chk_accounts_gender CHECK (gender IS NULL OR gender IN ('male','female'));
UPDATE accounts a JOIN (
  SELECT account_id,MAX(gender) AS gender FROM (
    SELECT account_id,NULLIF(gender,'') AS gender FROM employees
    UNION ALL
    SELECT i.account_id,NULLIF(p.gender,'') FROM supply_chain_admin_profiles p
      JOIN account_identities i ON i.id=p.identity_id
  ) profiles GROUP BY account_id
) profile ON profile.account_id=a.id SET a.gender=profile.gender;

ALTER TABLE employees DROP INDEX idx_employees_phone,
  DROP COLUMN name, DROP COLUMN gender, DROP COLUMN phone;
ALTER TABLE supply_chain_admin_profiles DROP CHECK chk_supply_admin_profile_gender,
  DROP COLUMN name, DROP COLUMN gender;
