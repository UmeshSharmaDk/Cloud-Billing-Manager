-- Book a demo requests from the public site, and date indexes for reports.
-- Written to be safe to run on a database that already has these objects.

CREATE TABLE IF NOT EXISTS demo_requests (
    id serial PRIMARY KEY,
    name text NOT NULL,
    phone text NOT NULL,
    email text,
    city text,
    business_type text NOT NULL,
    client_count integer,
    message text,
    status text DEFAULT 'new' NOT NULL,
    source_ip text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS demo_requests_created_at_idx ON demo_requests (created_at);

CREATE INDEX IF NOT EXISTS invoices_business_date_idx ON invoices (business_id, invoice_date);
CREATE INDEX IF NOT EXISTS purchases_business_date_idx ON purchases (business_id, invoice_date);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gst_app') THEN
    GRANT SELECT, INSERT, UPDATE ON demo_requests TO gst_app;
    GRANT USAGE, SELECT ON SEQUENCE demo_requests_id_seq TO gst_app;
  END IF;
END $$;
