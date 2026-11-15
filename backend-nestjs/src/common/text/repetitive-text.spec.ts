import { hasRepetitiveText } from './repetitive-text';

describe('degenerate speech and generation detection', () => {
  it.each([
    'జనేచ '.repeat(24) + 'జనే',
    'ZENAGE के बारे में बोलिये '.repeat(8),
    'ZENAGE त्वचा के लिए है। ' + 'नियमित नुकसान सुविधा के लिए '.repeat(12),
    'support skin health '.repeat(12),
  ])('rejects repeated output: %s', value => {
    expect(hasRepetitiveText(value)).toBe(true);
  });
  it.each([
    'ZENAGE के बारे में बोलिये ZENAGE के बारे में बोलिये',
    'ZENAGE గురించి చెప్పండి',
    'ZENAGE contains amino acids, peptides, antioxidants, vitamins and minerals.',
    'त्वचा की नमी, त्वचा का लचीलापन और त्वचा की सामान्य संरचना।',
  ])('preserves ordinary speech and lists: %s', value => {
    expect(hasRepetitiveText(value)).toBe(false);
  });
});
