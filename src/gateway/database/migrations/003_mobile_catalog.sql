CREATE TABLE mobile_operations (
 connection_id TEXT NOT NULL, request_id TEXT NOT NULL, payload_hash TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'processing', result JSONB, product_id TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(connection_id,request_id)
);
CREATE TABLE mobile_images (
 id UUID PRIMARY KEY, connection_id TEXT NOT NULL, content BYTEA NOT NULL,
 mime TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE bling_webhook_events (
 event_id TEXT PRIMARY KEY, company_id TEXT NOT NULL, event TEXT NOT NULL,
 received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bling_webhook_company_idx ON bling_webhook_events(company_id,received_at);
CREATE TABLE mobile_companies (connection_id TEXT PRIMARY KEY, company_id TEXT NOT NULL);
