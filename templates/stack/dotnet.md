### Stack rules: C# / .NET
- Clean Architecture boundaries: Domain has no dependencies; Application depends only on Domain; Infrastructure and API depend inward.
- Data access goes through repositories and the Unit of Work; no `DbContext` in endpoints or Application services.
- Nullable reference types on; treat warnings as errors in new projects.
- Pass `CancellationToken` through async calls; never use `.Result` or `.Wait()`.
- Validate requests at the API boundary; return `ProblemDetails` for errors; don't leak exception details.
- Configuration through the options pattern; secrets from user-secrets locally and a secret store in production, never `appsettings.json`.
- Check new packages with `dotnet list package --vulnerable` and prefer Microsoft or well-maintained libraries.
- Tests: xUnit (or the existing framework), one test project per production project under `tests/`; integration tests use `WebApplicationFactory`.
