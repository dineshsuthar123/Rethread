SET search_path TO rethread,public;
CREATE TABLE sandbox_credit_allowance(id int PRIMARY KEY CHECK(id=1),allocated_micros bigint NOT NULL CHECK(allocated_micros>=0),charged_micros bigint NOT NULL DEFAULT 0 CHECK(charged_micros>=0 AND charged_micros<=allocated_micros));
CREATE TABLE sandbox_credit_charges(id uuid PRIMARY KEY,job_id uuid REFERENCES jobs(id),maximum_micros bigint NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
