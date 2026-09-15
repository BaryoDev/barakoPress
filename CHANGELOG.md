# Changelog

## 0.4.0 (unreleased)

- One `PRESS_SECRET` keys every tenant's webhook key and every share session, with one rule of at least 32 characters. `REVALIDATE_SECRET` and `PRESS_PREVIEW_SECRET` are read only while it is unset, and every key derives byte for byte as before, so keys already in tenants' workflows keep verifying. A `REVALIDATE_SECRET` shorter than 32 characters logs a warning rather than refusing, until 1.0.0. (#50)
- A `HoldingMessage` site setting is the line the default holding page shows under the name and tagline, in place of the fixed "Coming soon.". Unset shows no line. (#46)
