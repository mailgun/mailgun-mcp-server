# Changelog

## 1.1.0

### Breaking (runtime)

- **Dropped Node 18 support.** The minimum required Node.js version is now **20.12.0**.
  Node 18 reached end-of-life on April 30, 2025, and current dev dependencies
  (vitest 4.x / rolldown) require `node:util.styleText` which was introduced in
  Node 20.12.

### Maintenance

- Convert the codebase to Typescript
- Switched to vitest for testing
