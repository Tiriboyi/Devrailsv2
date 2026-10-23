## Migration rules (@@from@@ → @@to@@)
The old system lives in `@@legacyPath@@/`. Until an approved RFC says otherwise, **its behaviour is the specification.**
- Before porting a feature, write **characterization tests** that capture what the old system actually does: inputs, outputs, status codes, error shapes, edge cases. Prefer black-box HTTP or contract tests that can run against both systems.
- Track every endpoint, job and feature in `docs/migration/parity-matrix.md`: `not started → characterized → ported → verified`, or `intentional difference` (which needs its own approved RFC).
- Label every claim in `docs/migration/evidence-map.md` as **observed**, **tested**, **documented**, **assumed** or **decided**. Documentation is not proof of behaviour.
- Don't change the old system except to make it testable, and only under an RFC.
- Port in vertical slices (one endpoint or feature end to end), not layer by layer.
- Data migrations need a dry run, a row-count/checksum comparison and a rollback plan in the RFC.
