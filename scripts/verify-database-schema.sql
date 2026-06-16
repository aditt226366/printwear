WITH required_tables(table_name) AS (
  VALUES
    ('Company'),
    ('AppUser'),
    ('CompanyFeature'),
    ('CompanyIntegration'),
    ('ApiUsageLog'),
    ('BillingSnapshot'),
    ('BulkMessageJob'),
    ('BulkMessageRecipient'),
    ('Campaign'),
    ('CampaignRecipient'),
    ('AdDraft'),
    ('AiWorkflow'),
    ('WorkflowExecutionLog')
),
required_migrations(migration_name) AS (
  VALUES
    ('20260615170000_company_users_billing'),
    ('20260615190000_multi_tenant_company_isolation'),
    ('20260616170000_company_integrations')
),
existing_tables AS (
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
),
existing_migrations AS (
  SELECT migration_name
  FROM "_prisma_migrations"
)
SELECT
  'tables' AS check_type,
  rt.table_name AS name,
  (et.table_name IS NOT NULL) AS exists
FROM required_tables rt
LEFT JOIN existing_tables et ON et.table_name = rt.table_name
UNION ALL
SELECT
  'migrations' AS check_type,
  rm.migration_name AS name,
  (em.migration_name IS NOT NULL) AS exists
FROM required_migrations rm
LEFT JOIN existing_migrations em ON em.migration_name = rm.migration_name
ORDER BY check_type, name;

SELECT COUNT(*) AS company_count FROM "Company";
SELECT COUNT(*) AS user_count FROM "AppUser";
