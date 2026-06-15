# Markdown Twin

Markdown Twin is a VS Code extension for translating Markdown documents while you write.

It helps you share documents with teammates who use another language without repeatedly copying content into an external translation tool. You can review and share translated Markdown directly inside VS Code.

![Markdown Twin main preview](media/images/readme-top-preview.png)

## Features

- Preview Markdown files in a translated language.
- Compare the original and translated text in bilingual view.
- Switch the translated preview to a Markdown-like source view.
- Use multiple Markdown tabs and target-language-specific preview panels.
- Copy or export translated Markdown.
- Keep the preview close to VS Code's built-in Markdown preview.

## Preview

Translation results are shown in a dedicated preview. You can switch between translation-only view, bilingual view, and translated source view.

![Translation only](media/images/readme-translation-only.png)
![Bilingual view](media/images/readme-translated-bilingual.png)
![Translated source](media/images/readme-translated-source.png)

## Getting Started

1. Open a Markdown file.
2. Click **Markdown Twin** in the status bar.
3. Configure the translation provider, API key, and output language from the Quick Pick menu.
4. Select **Toggle Translation** to open the translated preview.
5. Click the flag icon in the editor title to translate with the current output language.

## Translation Providers

Markdown Twin supports the following providers.
Get an API key from your provider and configure it with `Markdown Twin: Set / Change API Key`.
Azure Translator also requires the `markdownTwin.azureRegion` setting.

- Azure Translator
- Google Cloud Translation
- DeepL
- Papago

## Supported Languages

### Translation Languages

- Japanese / English / Korean
- Simplified Chinese / Traditional Chinese
- Spanish / French / German / Italian / Portuguese
- Russian / Vietnamese / Thai / Indonesian
- Arabic / Hindi

Provider-specific language code differences are handled internally by Markdown Twin.

### Display Languages

- English
- Japanese
- Korean
- Simplified Chinese
- Traditional Chinese

If your VS Code display language is not supported, Markdown Twin falls back to English.

<details>
<summary>Privacy, Security, And Known Limitations</summary>

**Privacy And Security**

Markdown Twin does not collect telemetry. When translation is enabled, the text selected for translation is sent to the configured translation provider. Review the privacy policy and terms of your selected provider before using this extension with confidential documents.

API keys are stored in VS Code SecretStorage and are not written to the workspace.

**Known Limitations**

- Translation quality, supported languages, rate limits, and pricing depend on the selected translation provider.
- Very large Markdown documents may take longer to translate.
- Code blocks are excluded from translation, but surrounding prose can still be changed by provider responses.
- Offline use is limited to cached translations from the current VS Code session.

</details>

## License

MIT
