// Deterministic YAML of the exported JSON; integers beyond 2^53 keep their exact JSON digits.
export const YAML_HEADER = '# Generated from backend public JSON; do not hand-edit.\n';

export function contractYaml(yaml, jsonText) {
  const exact = new Map();
  const spec = JSON.parse(jsonText, (key, value, context) => {
    if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
      if (!context?.source) throw new Error('Node with JSON.parse source access is required for exact integers');
      exact.set(String(value), context.source);
    }
    return value;
  });
  let out = yaml.dump(spec, { sortKeys: true, noRefs: true, lineWidth: 120 });
  for (const [rounded, digits] of exact) {
    const pattern = rounded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<=(?:: |- ))${pattern}$`, 'gm'), digits);
  }
  return YAML_HEADER + out;
}
