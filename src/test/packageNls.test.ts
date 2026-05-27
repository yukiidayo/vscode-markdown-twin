import * as fs from 'fs';
import * as path from 'path';

describe('package.nls localization files', () => {
  const root = path.join(__dirname, '..', '..');
  const base = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
  const localizedFiles = [
    'package.nls.ja.json',
    'package.nls.ko.json',
    'package.nls.zh-cn.json',
    'package.nls.zh-tw.json',
  ];

  it('keeps localized manifest keys aligned with the default manifest strings', () => {
    const baseKeys = Object.keys(base).sort();

    for (const file of localizedFiles) {
      const localized = JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
      expect(Object.keys(localized).sort()).toEqual(baseKeys);
    }
  });
});
