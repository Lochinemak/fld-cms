-- Members of the system tenant only manage tenants, so the memberships they hold elsewhere are
-- disabled. They are kept, with everything recorded against them, for the tenant to hand over.
UPDATE "tenant_members"
SET "status" = 'DISABLED', "updated_at" = now()
WHERE "tenant_id" <> 1
  AND "status" = 'ACTIVE'
  AND "user_id" IN (SELECT "user_id" FROM "tenant_members" WHERE "tenant_id" = 1);
