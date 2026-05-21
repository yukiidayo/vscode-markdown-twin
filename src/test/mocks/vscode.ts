// VSCode Mock for Jest Tests

export const StatusBarAlignment = {
  Left: 1,
  Right: 2
};

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
};

class MockStatusBarItem {
  text: string = '';
  tooltip: string = '';
  command: string = '';
  show = jest.fn();
  hide = jest.fn();
  dispose = jest.fn();
}

class MockSecretStorage {
  private store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async store_val(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

export const window = {
  createStatusBarItem: jest.fn(() => new MockStatusBarItem()),
  createOutputChannel: jest.fn(() => ({
    appendLine: jest.fn(),
    dispose: jest.fn()
  })),
  showErrorMessage: jest.fn(),
  showInformationMessage: jest.fn(),
  showInputBox: jest.fn(),
  showQuickPick: jest.fn(),
  activeTextEditor: undefined as any
};

const mockConfig = {
  get: jest.fn((key: string) => {
    if (key === 'provider') return 'google-cloud';
    if (key === 'sourceLanguage') return 'Japanese (日本語)';
    if (key === 'targetLanguage') return 'Korean (한국어)';
    if (key === 'batchSize') return 10;
    if (key === 'defaultMode') return 'Translation Only';
    return undefined;
  }),
  update: jest.fn()
};

export const workspace = {
  getConfiguration: jest.fn(() => mockConfig),
  onDidChangeTextDocument: jest.fn(() => ({ dispose: jest.fn() }))
};

export const commands = {
  registerCommand: jest.fn(() => ({ dispose: jest.fn() })),
  executeCommand: jest.fn()
};

export class Disposable {
  static from(...disposables: { dispose(): any }[]): Disposable {
    return new Disposable();
  }
  dispose() {}
}

export const Uri = {
  parse: jest.fn((val: string) => ({
    toString: () => val,
    fsPath: val,
    scheme: 'file'
  })),
  file: jest.fn((val: string) => ({
    toString: () => `file://${val}`,
    fsPath: val,
    scheme: 'file'
  }))
};
