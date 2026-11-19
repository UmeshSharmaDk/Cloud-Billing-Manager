-- An invoice that repeats every month, and an admin's choice to require
-- two-factor sign-in for every user they manage.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS repeat_monthly boolean DEFAULT false NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS require_team_mfa boolean DEFAULT false NOT NULL;

-- Weekly emailed payment reminders for overdue invoices, when the business turns them on.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS auto_reminders boolean DEFAULT false NOT NULL;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_reminded_at timestamp with time zone;
