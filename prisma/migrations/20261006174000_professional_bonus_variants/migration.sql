-- Split the professional lead-magnet into separate variants for beginners and practicing massage therapists.
INSERT INTO "Setting" ("key", "value", "updatedAt")
VALUES
  ('client.bonus.professional.beginner', '{"fileId":null,"url":null}'::jsonb, CURRENT_TIMESTAMP),
  ('client.bonus.professional.practicing', '{"fileId":null,"url":null}'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;
