# Acme Internal Asset Portal - Security Evaluation Lab - This is intentionally vulnerable

## Summary

Acme Corp runs an internal asset portal used by IT operations to track laptops, servers, and service owners. The app recently added two enterprise features:

1. Header-based SSO support from a reverse proxy.
2. A webhook diagnostics tool for admins to test outbound integrations.

Security has concerns that the rollout was rushed. This is the source code, Docker setup, and a few log files from a recent incident review.

## High-Level Architecture

- `app/` - Express-based internal asset management portal
- `mock-metadata/` - Internal-only metadata/config service reachable only on the Docker network
- `logs/` - Sample application and reverse-proxy style logs for incident investigation tasks

## Run the Lab

```bash
docker compose up --build
```

Then open:

- App: `http://localhost:3000`
- Metadata service is **not** published to the host; it is only reachable from inside Docker.

## Accounts

These are for local lab setup only:

- `analyst@acme.local` / `Winter2026!`
- `admin@acme.local` / `AdminPass2026!`
- Local Docker-only lab.
- No outbound internet dependencies beyond image pulls.
- No weaponized exploit automation included.
