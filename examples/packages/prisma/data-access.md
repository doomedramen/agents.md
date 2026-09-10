# Prisma data access

- Keep Prisma calls behind the service or repository boundary chosen by the project.
- Review transaction boundaries and query selection when changing business operations.
- Treat generated client changes as reviewed build artifacts, not as a place for hand edits.
