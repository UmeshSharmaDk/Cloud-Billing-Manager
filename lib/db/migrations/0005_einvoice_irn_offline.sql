-- E-invoice details the IRP returns for an invoice: IRN, acknowledgement and signed QR.
-- And client_ref: the id the Android app gives an invoice made offline, so a resend after a lost reply cannot create it twice.

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_ack_no text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_ack_date text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS irn_signed_qr text;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS client_ref text;
CREATE UNIQUE INDEX IF NOT EXISTS invoices_business_client_ref_unique ON invoices (business_id, client_ref);
