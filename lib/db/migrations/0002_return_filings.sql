-- GST returns an admin has marked as filed for a client, shown on the clients board.

CREATE TABLE IF NOT EXISTS return_filings (
    id serial PRIMARY KEY,
    business_id integer NOT NULL,
    period text NOT NULL,
    form text NOT NULL,
    arn text,
    filed_by integer NOT NULL,
    filed_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS return_filings_business_period_form_idx ON return_filings (business_id, period, form);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gst_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON return_filings TO gst_app;
    GRANT USAGE, SELECT ON SEQUENCE return_filings_id_seq TO gst_app;
  END IF;
END $$;
