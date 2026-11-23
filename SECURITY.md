# Security Policy

## Reporting a vulnerability

If you find a security problem in barakoPress, report it privately:

1. **Do not open a public GitHub issue.**
2. Report it the way the [barakoCMS security policy](https://github.com/BaryoDev/barakoCMS/security/policy)
   says; that contact takes problems in barakoPress too.
3. Include a description, steps to reproduce, and the impact you see.

A problem in the API (authorisation, tokens, rate limits) belongs to
[barakoCMS](https://github.com/BaryoDev/barakoCMS/security/policy).

## Response timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 1 week
- **Fix**: depends on severity

## Supported versions

Only the latest minor release gets security fixes. A fix ships as a new patch release of that
minor. There is no backport line for older minors, so upgrading to the latest is the way to get a fix.

## How we check

- Every workflow action is pinned by commit SHA, and CI fails on one that is not.
- CodeQL runs with the extended security queries on the code and on the workflow files.
- A secret scan runs over the tree and the history on every change, and proves it can fail.
- The dependency audit runs on every change and nightly on master.
