// Drift guard: src/types.ts against the SDK surface copy (refreshed by scripts/sync-sdk-surface.mjs).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SURFACE = JSON.parse(readFileSync(resolve(ROOT, 'test/fixtures/sdk-surface.json'), 'utf8'));
const TYPES_FILE = resolve(ROOT, 'src/types.ts');

/** Surface object -> the type that describes it; `own` skips members inherited from `Error`. */
const OBJECT_TYPES = {
  bp: { type: 'Brewpage' },
  'bp.state': { type: 'StateFn' },
  State: { type: 'State' },
  Collection: { type: 'Collection' },
  Storage: { type: 'PageStorage' },
  StateError: { type: 'StateError', own: true },
  LocalState: { type: 'LocalState' },
  LocalCollection: { type: 'LocalCollection' },
};
const OPTION_TYPES = { 'Collection.list': 'ListOptions', 'Collection.stats': 'StatsOptions', 'Collection.onStats': 'StatsOptions' };
const ENUM_TYPES = { 'ListOptions.order': 'ListOrder' };
const KINDS = { value: 'property', getter: 'property', accessor: 'property', method: 'method', class: 'class' };
const TOKEN = /\b(?:bp|brewpage)\s*\.\s*(?:state|storage)\b/;
const ENTRIES = ['index', 'react', 'vue', 'elements'];

const program = ts.createProgram([TYPES_FILE], {
  target: ts.ScriptTarget.ES2022,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
  strict: true,
  noEmit: true,
  types: [],
});
const checker = program.getTypeChecker();
const source = program.getSourceFile(TYPES_FILE);
const exported = new Map(checker.getExportsOfModule(checker.getSymbolAtLocation(source)).map((s) => [s.name, s]));

function typeOf(name) {
  const symbol = exported.get(name);
  assert.ok(symbol, `src/types.ts must export ${name}`);
  return checker.getDeclaredTypeOfSymbol(symbol);
}

function byName(a, b) {
  return a.name < b.name ? -1 : 1;
}

function longest(signatures) {
  return signatures.reduce((best, s) => (s.parameters.length > best.parameters.length ? s : best));
}

function memberOf(symbol) {
  const type = checker.getTypeOfSymbol(symbol);
  const construct = type.getConstructSignatures();
  const call = type.getCallSignatures();
  if (construct.length) return { name: symbol.name, kind: 'class', params: longest(construct).parameters.map((p) => p.name) };
  if (call.length) return { name: symbol.name, kind: 'method', params: longest(call).parameters.map((p) => p.name) };
  return { name: symbol.name, kind: 'property' };
}

function ownMembers(declared) {
  return [...declared.symbol.members.values()].filter((s) => !(s.flags & ts.SymbolFlags.TypeParameter));
}

function typedMembers({ type, own }) {
  const declared = typeOf(type);
  const symbols = own ? ownMembers(declared) : checker.getPropertiesOfType(declared);
  return symbols.map(memberOf).sort(byName);
}

function surfaceMembers(members) {
  return members
    .map((m) => (m.params ? { name: m.name, kind: KINDS[m.kind], params: m.params } : { name: m.name, kind: KINDS[m.kind] }))
    .sort(byName);
}

function keysOf(name) {
  return checker.getPropertiesOfType(typeOf(name)).map((s) => s.name);
}

function optionalOf(name) {
  return checker
    .getPropertiesOfType(typeOf(name))
    .filter((s) => s.flags & ts.SymbolFlags.Optional)
    .map((s) => s.name);
}

function literalsOf(name) {
  return typeOf(name).types.map((t) => t.value);
}

function typedShapes() {
  const shapes = {};
  for (const [name, shape] of Object.entries(SURFACE.shapes)) {
    const declared = typeOf(name);
    const entry = {};
    if (shape.array) {
      entry.array = declared.getBaseTypes().some((base) => checker.isArrayType(base));
      entry.keys = ownMembers(declared).map((s) => s.name);
    } else entry.keys = keysOf(name);
    if (shape.optional) entry.optional = optionalOf(name);
    shapes[name] = entry;
  }
  return shapes;
}

function typedCallbacks() {
  const callbacks = {};
  for (const path of Object.keys(SURFACE.callbacks)) {
    const [owner, method] = path.split('.');
    const signature = longest(checker.getTypeOfSymbol(checker.getPropertyOfType(typeOf(owner), method)).getCallSignatures());
    const fn = longest(checker.getTypeOfSymbol(signature.parameters.at(-1)).getCallSignatures());
    const returned = signature.getReturnType();
    callbacks[path] = {
      args: fn.parameters.map((p) => checker.typeToString(checker.getTypeOfSymbol(p))),
      returns: returned.getCallSignatures().length ? 'function' : 'undefined',
    };
  }
  return callbacks;
}

function windowGlobals() {
  const names = [];
  const visit = (node) => {
    if (ts.isInterfaceDeclaration(node) && node.name.text === 'Window') names.push(...node.members.map((m) => m.name.text));
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names.sort();
}

test('GIVEN the SDK surface copy WHEN the package types are read THEN every object, option, enum, shape, callback and code matches', () => {
  // GIVEN
  const expected = {
    globals: [...SURFACE.globals].sort(),
    objects: Object.fromEntries(Object.entries(SURFACE.objects).map(([name, o]) => [name, surfaceMembers(o.members)])),
    options: SURFACE.options,
    enums: SURFACE.enums,
    shapes: SURFACE.shapes,
    callbacks: SURFACE.callbacks,
    codes: SURFACE.codes,
  };

  // WHEN
  const actual = {
    globals: windowGlobals(),
    objects: Object.fromEntries(Object.entries(OBJECT_TYPES).map(([name, spec]) => [name, typedMembers(spec)])),
    options: Object.fromEntries(Object.entries(OPTION_TYPES).map(([path, name]) => [path, keysOf(name)])),
    enums: Object.fromEntries(Object.entries(ENUM_TYPES).map(([path, name]) => [path, literalsOf(name)])),
    shapes: typedShapes(),
    callbacks: typedCallbacks(),
    codes: literalsOf('StateErrorCode').sort(),
  };

  // THEN
  assert.deepStrictEqual(actual, expected, 'src/types.ts drifted from test/fixtures/sdk-surface.json: update the types');
});

test('GIVEN the built entries WHEN their text is read THEN each calls the SDK through the literal global chain', () => {
  // GIVEN
  const expected = Object.fromEntries(ENTRIES.map((entry) => [entry, true]));

  // WHEN
  const actual = Object.fromEntries(ENTRIES.map((entry) => [entry, TOKEN.test(readFileSync(resolve(ROOT, `dist/${entry}.js`), 'utf8'))]));

  // THEN
  assert.deepStrictEqual(actual, expected, 'every built entry must hold brewpage.state or brewpage.storage as plain property access');
});
