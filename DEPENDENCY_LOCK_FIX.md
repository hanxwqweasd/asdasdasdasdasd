# Dependency lock fix 4.3.2

The previous lockfile referenced package archives that were not published to npm:

- `thread-stream-4.3.0.tgz`
- `split2-4.3.0.tgz`
- `@fastify/error-4.3.0.tgz`

Release 4.3.2 pins the published 4.2.0 releases, adds an npm override for the transitive `thread-stream` dependency, and includes a regression test for the resolved tarball URLs.
