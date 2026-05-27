# Changelog

All notable changes to Markdown Twin will be documented in this file.

## 0.3.0 - 2026-05-28

### Added

- Added Simplified Chinese and Traditional Chinese as translation languages.
- Added Simplified Chinese and Traditional Chinese UI localization.
- Added provider-specific language code mapping for Chinese variants.
- Added consistency tests for language settings, provider mappings, and localization files.

### Changed

- Improved Markdown preview/source rendering compatibility with VS Code behavior.
- Improved source and preview synchronization behavior.
- Refactored webview scripts and preview panel internals for maintainability.
- Normalized SVG assets to UTF-8 without BOM.

### Security

- Documented that API keys are stored using VS Code SecretStorage.
- Documented that translated content is sent to the selected translation provider.
