import * as vscode from 'vscode';
import { TranslationManager } from '../translationManager';

describe('TranslationManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists mode changes to the defaultMode setting', async () => {
    const manager = new TranslationManager({} as any);

    await manager.toggleMode();

    expect(vscode.workspace.getConfiguration('markdownTwin').update).toHaveBeenCalledWith(
      'defaultMode',
      'Bilingual',
      vscode.ConfigurationTarget.Global
    );

    await manager.toggleMode();

    expect(vscode.workspace.getConfiguration('markdownTwin').update).toHaveBeenCalledWith(
      'defaultMode',
      'Translation Only',
      vscode.ConfigurationTarget.Global
    );
  });

  it('can generate clean translated markdown even when the current mode is bilingual', async () => {
    const manager = new TranslationManager({} as any);
    const document = {
      uri: vscode.Uri.file('/workspace/requirements.md'),
      getText: () => '原文です。',
    } as any;

    (manager as any).cache
      .ensureDocumentCache(document.uri, 'ko')
      .set('原文です。', 'Translated sentence.');

    await manager.toggleMode();

    const bilingual = manager.generateTranslatedMarkdown(document, 'ko');
    const cleanSource = manager.generateTranslatedMarkdown(document, 'ko', 'translation-only');

    expect(bilingual.text).toContain('mt-bilingual-original');
    expect(cleanSource.text).toBe('Translated sentence.');
  });
});
