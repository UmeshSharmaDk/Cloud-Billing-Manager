-- A business's e-invoice system (IRP) API login, for generating IRNs from the app.
-- Secrets are sealed by the application before they are stored.

CREATE TABLE IF NOT EXISTS irp_credentials (
    business_id integer PRIMARY KEY,
    base_url text NOT NULL,
    gstin text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    public_key text NOT NULL,
    auth_token text,
    sek text,
    token_expiry timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gst_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON irp_credentials TO gst_app;
  END IF;
END $$;
