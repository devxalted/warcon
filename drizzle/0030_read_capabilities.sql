-- Split three reads out of the monolithic 'server.view'.
--
-- 'server.view' granted the config document, the reserved-slot roster and the automation rules
-- along with everything else, so every role could read all three. The config document is the
-- serious one: on a WARDOGS server it carries the RCON password in plain text, so any viewer could
-- read it and then talk to the RCON port directly, bypassing roles, bans and the audit trail.
--
-- Raising the floor must not take a tab away from a role that could already edit what is behind it,
-- so anyone holding the matching manage capability gains the matching read here. Roles that only
-- ever looked (viewer, operator) lose access, which is the point.
UPDATE "org_roles"
   SET "capabilities" = "capabilities" || '["config.read"]'::jsonb,
       "updated_at" = now()
 WHERE "capabilities" @> '["config.apply"]'::jsonb
   AND NOT "capabilities" @> '["config.read"]'::jsonb;--> statement-breakpoint

UPDATE "org_roles"
   SET "capabilities" = "capabilities" || '["slots.read"]'::jsonb,
       "updated_at" = now()
 WHERE "capabilities" @> '["slots.manage"]'::jsonb
   AND NOT "capabilities" @> '["slots.read"]'::jsonb;--> statement-breakpoint

UPDATE "org_roles"
   SET "capabilities" = "capabilities" || '["automation.read"]'::jsonb,
       "updated_at" = now()
 WHERE "capabilities" @> '["automation.manage"]'::jsonb
   AND NOT "capabilities" @> '["automation.read"]'::jsonb;
