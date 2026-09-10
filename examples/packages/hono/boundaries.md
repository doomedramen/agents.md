# Hono boundaries

- Keep request parsing and transport adapters separate from business services.
- Define middleware ownership for authentication, validation, and error conversion.
- Make runtime-specific APIs explicit so handlers remain portable where intended.
