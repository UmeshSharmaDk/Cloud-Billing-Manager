-- Online payment (PayU) for a seat request. The superadmin still approves it.

ALTER TABLE capacity_requests ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid' NOT NULL;
ALTER TABLE capacity_requests ADD COLUMN IF NOT EXISTS payu_txnid text;
ALTER TABLE capacity_requests ADD COLUMN IF NOT EXISTS payu_payment_id text;
ALTER TABLE capacity_requests ADD COLUMN IF NOT EXISTS paid_at timestamp with time zone;
CREATE UNIQUE INDEX IF NOT EXISTS capacity_requests_payu_txnid_idx ON capacity_requests (payu_txnid);
