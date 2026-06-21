const ALIAS_MAP: Record<string, string> = {
  "jakarta barat": "Administrasi Jakarta Barat",
  "jakbar": "Administrasi Jakarta Barat",
  "jakarta pusat": "Administrasi Jakarta Pusat",
  "jakpus": "Administrasi Jakarta Pusat",
  "jakarta selatan": "Administrasi Jakarta Selatan",
  "jaksel": "Administrasi Jakarta Selatan",
  "jakarta timur": "Administrasi Jakarta Timur",
  "jaktim": "Administrasi Jakarta Timur",
  "jakarta utara": "Administrasi Jakarta Utara",
  "jakut": "Administrasi Jakarta Utara",
  "kepulauan seribu": "Administrasi Kepulauan Seribu",
  "pulau seribu": "Administrasi Kepulauan Seribu",
};

const NORMALIZE_MAP: Record<string, string> = {
  "kota ": "",
  "kabupaten ": "",
  "administrasi ": "Administrasi ",
};

export function resolveAlias(input: string): string {
  const lower = input.toLowerCase().trim();
  if (ALIAS_MAP[lower]) {
    return ALIAS_MAP[lower];
  }
  return input.trim();
}

export function normalizeAdministrative(name: string): string {
  let result = name.trim();
  for (const [pattern, replacement] of Object.entries(NORMALIZE_MAP)) {
    const lowerResult = result.toLowerCase();
    if (lowerResult.startsWith(pattern)) {
      result = replacement + result.slice(pattern.length);
      break;
    }
  }
  return result;
}
