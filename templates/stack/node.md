### Stack rules: Node.js / TypeScript
- Use the project's existing module system, test runner and linter; don't introduce a second one.
- Validate all external input at the boundary (request bodies, query strings, headers, env vars).
- Always `await` or return promises; no floating promises; handle rejections.
- Keep business logic out of route handlers: handlers parse and validate, services decide, repositories persist.
- Parameterised queries only; never build SQL from strings.
- Pin versions through the lockfile and run `npm audit` before adding a package.
- Tests: unit tests next to the logic they cover or in `test/`; integration tests hit real HTTP routes with a test database where practical.
