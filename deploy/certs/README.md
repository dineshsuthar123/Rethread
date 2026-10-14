# Supabase database trust anchors

The public CA bundle `supabase-root-ca.pem` contains the production 2021 and
2025 trust anchors shipped by the official Supabase CLI at commit
`28dad9c763b2ea3f61439acc0f09b0fa5131a7c1`:

- [2021 certificate](https://github.com/supabase/cli/blob/28dad9c763b2ea3f61439acc0f09b0fa5131a7c1/apps/cli-go/internal/gen/types/templates/prod-ca-2021.crt)
  — SHA-256 DER `807025ad50d4ed219d2c9c7d299c004f824eb00cf7f65afef607d07b72e6cafa`;
  expires 2031-04-26.
- [2025 certificate](https://github.com/supabase/cli/blob/28dad9c763b2ea3f61439acc0f09b0fa5131a7c1/apps/cli-go/internal/gen/types/templates/prod-ca-2025.crt)
  — SHA-256 DER `5f9b77951a7aa1303f9b58eea9bfa89e358cfdc15f9786ff10d4930a722c9ae2`;
  expires 2035-09-01.

These are public provider certificates, not credentials or private keys. Verify
updates against the provider's official source/dashboard before replacing them.
Use them only for the database client with `sslmode=verify-full` and
`sslrootcert`; do not disable certificate or hostname verification. The container
path is `/app/deploy/certs/supabase-root-ca.pem`; the Actions worker uses the
checked-out file via `PGSSLROOTCERT`.
