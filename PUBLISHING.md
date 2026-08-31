# Publishing `@jobmate/commute` to npm

The package is published manually because its generated matrix files are
intentionally ignored by Git and exist only in a prepared local checkout.

## First-time setup

Create and secure the npm account, verify its email, enable two-factor
authentication, then sign in from the repository:

```sh
npm login
npm whoami
```

The signed-in account must be allowed to publish `@jobmate/commute`. Never put
an npm token in this repository or commit a user-level `.npmrc`.

## License and data

The original package software is licensed under MIT. Anyone may use, modify,
and redistribute it, including commercially, provided copies or substantial
portions retain Jobmate's copyright and license notice.

The embedded datasets have separate terms and attribution requirements. Keep
`packages/commute/DATA_SOURCES.md` in every release and refresh the Swiss GTFS
snapshot in line with its source terms.

## Prepare and verify

```sh
npm ci
npm run commute:package:data
npm run commute:package:verify
```

The data command is only needed when `packages/commute/data` does not already
contain the intended release artifacts. The verifier tests and typechecks the
package, builds it, installs the exact tarball in an isolated temporary
project, checks the notices, and performs real lookups against both matrices.

To retain a tarball for manual inspection:

```sh
npm run commute:package:pack
```

## Preview and publish

```sh
npm run commute:package:publish -- --dry-run
npm run commute:package:publish
```

Review the dry run before executing the second command. Publication is
irreversible for that name/version pair. The command publishes only the
`packages/commute` workspace with public access.

Verify the registry copy afterward:

```sh
npm view @jobmate/commute name version dist.tarball dist.unpackedSize
npm install @jobmate/commute
```

For later releases, refresh the data when appropriate, increment the semantic
version, and repeat verification and the dry run:

```sh
npm version patch --workspace packages/commute --no-git-tag-version
npm run commute:package:verify
npm run commute:package:publish -- --dry-run
npm run commute:package:publish
```
