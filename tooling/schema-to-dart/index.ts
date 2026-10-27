/**
 * TypeBox -> Dart codegen.
 *
 * INVARIANT 10 (MAP.txt): Dart types are GENERATED from `@rudra/contracts`.
 * Elysia's Eden only types TypeScript clients, so without this the Dart side is
 * hand-written DTOs that drift silently — exactly the failure we left Python to
 * avoid (PLAN.MD §3).
 *
 * Two modes:
 *   `bun run codegen`         writes the Dart files
 *   `bun run codegen:check`   exits non-zero if the committed output differs
 *
 * `--check` is what CI runs. It is the mechanism that makes the invariant real:
 * change a schema without regenerating and the build fails.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { SCHEMAS } from '@rudra/contracts';

const OUT_DIR = resolve(import.meta.dir, '../../app/lib/api/generated');
const OUT_FILE = join(OUT_DIR, 'models.dart');

const HEADER = `// GENERATED FILE — DO NOT EDIT.
//
// Source: packages/contracts/src/*.ts  (TypeBox schemas, listed in SCHEMAS)
// Regenerate: bun run codegen
// Verify:     bun run codegen:check   <- CI runs this; drift fails the build.
//
// Hand-editing this file is the drift PLAN.MD §3 exists to prevent.

// ignore_for_file: prefer_single_quotes, unnecessary_this, lines_longer_than_80_chars
// ignore_for_file: sort_constructors_first, always_put_required_named_parameters_first
// Which typed readers are used depends on which contracts exist, so some of
// them are legitimately unreferenced in any given generation.
// ignore_for_file: unused_element
`;

/**
 * The typed-reader prelude, emitted verbatim into the generated file.
 *
 * **Why `fromJson` does not use `as`.** A raw cast on wire data turns a
 * backend that disagrees with the app into a `TypeError` thrown from inside an
 * `async*` body — an unhandled stream error with a message naming Dart types,
 * not the field at fault. These readers raise one exception type, carrying the
 * field name and what was expected, so a mismatch names itself and both call
 * sites (`sse.dart`, `client.dart`) have exactly one thing to catch.
 *
 * The readers are deliberately liberal where JSON is ambiguous and strict
 * everywhere else: `5.0` is accepted for an integer field because JSON has one
 * number type, but a string is never coerced to a number, since that hides a
 * real contract break.
 */
const READERS = `/// Thrown when wire data does not match the contract this file was generated
/// from.
///
/// Distinct from [FormatException] on purpose: a FormatException means the bytes
/// were not JSON, while this means the JSON was well-formed but disagreed with
/// the contract — a version skew between app and backend, not a corrupt socket.
@immutable
class WireTypeError implements Exception {
  const WireTypeError(this.message);

  /// Names the offending field and what was expected. Safe to show a person.
  final String message;

  @override
  String toString() => 'WireTypeError: $message';
}

Never _bad(String field, String expected, Object? got) => throw WireTypeError(
      "field '$field' should be $expected, but was \${got == null ? 'absent' : got.runtimeType}",
    );

String _reqStr(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is String) return v;
  return _bad(f, 'a string', v);
}

String? _optStr(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is String) return v;
  return _bad(f, 'a string or absent', v);
}

bool _reqBool(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is bool) return v;
  return _bad(f, 'a boolean', v);
}

bool? _optBool(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is bool) return v;
  return _bad(f, 'a boolean or absent', v);
}

/// JSON has a single number type, so an integer field may legitimately arrive
/// as \`5.0\`. A fractional value is still a contract break and is rejected.
int _reqInt(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is int) return v;
  if (v is num && v == v.roundToDouble() && v.isFinite) return v.toInt();
  return _bad(f, 'an integer', v);
}

int? _optInt(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is int) return v;
  if (v is num && v == v.roundToDouble() && v.isFinite) return v.toInt();
  return _bad(f, 'an integer or absent', v);
}

double _reqNum(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is num && v.isFinite) return v.toDouble();
  return _bad(f, 'a finite number', v);
}

double? _optNum(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is num && v.isFinite) return v.toDouble();
  return _bad(f, 'a finite number or absent', v);
}

Map<String, dynamic> _reqMap(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is Map) return Map<String, dynamic>.from(v);
  return _bad(f, 'an object', v);
}

Map<String, dynamic>? _optMap(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is Map) return Map<String, dynamic>.from(v);
  return _bad(f, 'an object or absent', v);
}

List<dynamic> _reqList(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v is List) return v;
  return _bad(f, 'an array', v);
}

List<dynamic>? _optList(Map<String, dynamic> j, String f) {
  final v = j[f];
  if (v == null) return null;
  if (v is List) return v;
  return _bad(f, 'an array or absent', v);
}

/// Element reader for a typed list. The index is part of the message, because
/// "one of 400 items was wrong" is not actionable on its own.
T _item<T>(List<dynamic> list, int index, String field) {
  final v = list[index];
  if (v is T) return v;
  return _bad('$field[$index]', '$T', v);
}

List<T> _reqTypedList<T>(Map<String, dynamic> j, String f) {
  final raw = _reqList(j, f);
  return List<T>.generate(raw.length, (i) => _item<T>(raw, i, f));
}

/// Reader for an inline string union — a set of literals the contract spells
/// out without naming, so no Dart enum is emitted for it.
///
/// It still validates membership. Without this the field is "some string", and
/// a caller switching on it needs a default case that can only guess.
String _reqOneOf(Map<String, dynamic> j, String f, List<String> allowed) {
  final v = _reqStr(j, f);
  if (allowed.contains(v)) return v;
  return _bad(f, 'one of \${allowed.join(', ')}', v);
}

String? _optOneOf(Map<String, dynamic> j, String f, List<String> allowed) {
  final v = _optStr(j, f);
  if (v == null || allowed.contains(v)) return v;
  return _bad(f, 'one of \${allowed.join(', ')} or absent', v);
}

List<T>? _optTypedList<T>(Map<String, dynamic> j, String f) {
  final raw = _optList(j, f);
  if (raw == null) return null;
  return List<T>.generate(raw.length, (i) => _item<T>(raw, i, f));
}
`;

type Json = Record<string, unknown>;

function isObjectSchema(s: Json): boolean {
   return s['type'] === 'object' && typeof s['properties'] === 'object';
}

function isStringUnion(s: Json): boolean {
   const any = s['anyOf'];
   return (
      Array.isArray(any) &&
      any.length > 0 &&
      any.every((m) => typeof (m as Json)['const'] === 'string')
   );
}

function isTaggedUnion(s: Json): boolean {
   const any = s['anyOf'];
   if (!Array.isArray(any) || any.length === 0) return false;
   return any.every((m) => {
      const props = (m as Json)['properties'] as Json | undefined;
      const tag = props?.['type'] as Json | undefined;
      return typeof tag?.['const'] === 'string';
   });
}

function schemaId(s: Json, fallback: string): string {
   const id = s['$id'];
   return typeof id === 'string' && id !== '' ? id : fallback;
}

/**
 * Ids of every schema we emit a class for.
 *
 * TypeBox inlines a referenced schema rather than emitting a `$ref`, but it
 * preserves the `$id`. So a nested object that we also generate top-level can be
 * recognised here and typed as that class instead of a loose map.
 */
const namedSchemas = new Set<string>();

/** `StreamEvent` -> `StreamEvent`; `ErrorCode` stays as given. */
function className(id: string): string {
   return id.charAt(0).toUpperCase() + id.slice(1);
}

/** snake/camel -> lowerCamel Dart field name. */
function fieldName(key: string): string {
   const camel = key.replace(/[_-]([a-z0-9])/g, (_, c: string) => c.toUpperCase());
   return camel.charAt(0).toLowerCase() + camel.slice(1);
}

/** Map a property schema to a Dart type. Unknown shapes degrade to dynamic. */
function dartType(prop: Json, required: boolean): string {
   const nullableSuffix = required ? '' : '?';
   const ref = prop['$ref'];
   if (typeof ref === 'string') {
      return className(ref.split('/').pop() ?? 'dynamic') + nullableSuffix;
   }
   if (typeof prop['const'] === 'string') return `String${nullableSuffix}`;
   if (isStringUnion(prop)) {
      // TypeBox inlines a referenced union but keeps its $id, so a named union
      // becomes the generated enum rather than a bare String.
      const id = prop['$id'];
      if (typeof id === 'string' && id !== '') return `${className(id)}${nullableSuffix}`;
      return `String${nullableSuffix}`;
   }

   switch (prop['type']) {
      case 'string':
         return `String${nullableSuffix}`;
      case 'integer':
         return `int${nullableSuffix}`;
      case 'number':
         return `double${nullableSuffix}`;
      case 'boolean':
         return `bool${nullableSuffix}`;
      case 'array': {
         const items = (prop['items'] ?? {}) as Json;
         return `List<${dartType(items, true)}>${nullableSuffix}`;
      }
      case 'object': {
         const id = prop['$id'];
         if (typeof id === 'string' && namedSchemas.has(id)) {
            return `${className(id)}${nullableSuffix}`;
         }
         // An open record (Record<string, unknown>) stays a loose map.
         return `Map<String, dynamic>${nullableSuffix}`;
      }
      default:
         return `dynamic`;
   }
}

/**
 * The expression that reads one field out of a json map.
 *
 * Every branch goes through a `_req*`/`_opt*` reader from [READERS] rather than
 * a cast, so wrong data raises a `WireTypeError` naming the field instead of a
 * bare `TypeError`. See the comment on [READERS].
 */
function fromJsonExpr(key: string, prop: Json, required: boolean): string {
   const k = `'${key}'`;
   const r = (fn: string) => `${fn}(json, ${k})`;
   // A nested named schema is read as a map first, then handed to its own
   // fromJson, which applies the same discipline one level down.
   const nested = (cls: string) =>
      required
         ? `${cls}.fromJson(${r('_reqMap')})`
         : `json[${k}] == null ? null : ${cls}.fromJson(${r('_reqMap')})`;

   const ref = prop['$ref'];
   if (typeof ref === 'string') {
      return nested(className(ref.split('/').pop() ?? ''));
   }
   if (isStringUnion(prop)) {
      const id = prop['$id'];
      if (typeof id === 'string' && id !== '') {
         const cls = className(id);
         return required
            ? `${cls}.fromWire(${r('_reqStr')}, ${k})`
            : `json[${k}] == null ? null : ${cls}.fromWire(${r('_reqStr')}, ${k})`;
      }
      // An inline union the contract did not name, so there is no enum to map
      // onto. It is still a closed set, and membership is still checked —
      // otherwise the field degrades to "some string" and every caller needs a
      // default case it can only guess at.
      const allowed = (prop['anyOf'] as Json[]).map((m) => `'${String(m['const'])}'`).join(', ');
      return `${required ? '_reqOneOf' : '_optOneOf'}(json, ${k}, const <String>[${allowed}])`;
   }
   if (prop['type'] === 'number') {
      return r(required ? '_reqNum' : '_optNum');
   }
   if (prop['type'] === 'integer') {
      return r(required ? '_reqInt' : '_optInt');
   }
   if (prop['type'] === 'boolean') {
      return r(required ? '_reqBool' : '_optBool');
   }
   if (prop['type'] === 'string') {
      return r(required ? '_reqStr' : '_optStr');
   }
   if (prop['type'] === 'array') {
      const items = (prop['items'] ?? {}) as Json;
      const itemType = dartType(items, true);
      return r(required ? `_reqTypedList<${itemType}>` : `_optTypedList<${itemType}>`);
   }
   if (prop['type'] === 'object') {
      const id = prop['$id'];
      if (typeof id === 'string' && namedSchemas.has(id)) {
         return nested(className(id));
      }
      return r(required ? '_reqMap' : '_optMap');
   }
   // No `type` at all: the contract left it open, so the value stays dynamic
   // and there is nothing to check.
   return `json[${k}]`;
}

function emitStringUnion(id: string, schema: Json): string {
   const name = className(id);
   const members = (schema['anyOf'] as Json[]).map((m) => String(m['const']));
   const lines: string[] = [];
   const doc =
      typeof schema['description'] === 'string'
         ? schema['description']
         : `One of: ${members.join(', ')}`;
   lines.push(`/// ${doc}`);
   lines.push(`enum ${name} {`);
   for (const m of members) {
      lines.push(`  ${fieldName(m)}('${m}'),`);
   }
   lines.push(`  ;`);
   lines.push('');
   lines.push(`  const ${name}(this.wire);`);
   lines.push('');
   lines.push(`  /// The exact string on the wire.`);
   lines.push(`  final String wire;`);
   lines.push('');
   // Strict, and raising the same exception type as every other reader: an
   // unknown member means app and backend disagree. Mapping it to an arbitrary
   // member would be a lie the UI would then act on. Callers that would rather
   // degrade than fail use `tryFromWire`.
   lines.push(`  static ${name} fromWire(String value, [String field = '${fieldName(id)}']) =>`);
   lines.push(`      tryFromWire(value) ??`);
   lines.push(
      `      _bad(field, 'one of \${${name}.values.map((e) => e.wire).join(', ')}', value);`,
   );
   lines.push('');
   lines.push(`  /// Null rather than an exception for an unrecognised value.`);
   lines.push(`  static ${name}? tryFromWire(String value) {`);
   lines.push(`    for (final e in ${name}.values) {`);
   lines.push(`      if (e.wire == value) return e;`);
   lines.push(`    }`);
   lines.push(`    return null;`);
   lines.push(`  }`);
   lines.push('}');
   return lines.join('\n');
}

function emitClass(id: string, schema: Json, unionParent?: string): string {
   const name = className(id);
   const props = schema['properties'] as Json;
   const requiredList = (schema['required'] as string[] | undefined) ?? [];
   const keys = Object.keys(props);

   const lines: string[] = [];
   const description = schema['description'];
   if (typeof description === 'string') lines.push(`/// ${description}`);
   lines.push(`@immutable`);
   lines.push(`class ${name}${unionParent === undefined ? '' : ` extends ${unionParent}`} {`);

   // Constructor
   lines.push(`  const ${name}({`);
   for (const key of keys) {
      const required = requiredList.includes(key);
      lines.push(`    ${required ? 'required ' : ''}this.${fieldName(key)},`);
   }
   lines.push(`  });`);
   lines.push('');

   // fromJson — a factory counts as a constructor, so it comes before fields.
   lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) => ${name}(`);
   for (const key of keys) {
      const prop = props[key] as Json;
      const required = requiredList.includes(key);
      lines.push(`        ${fieldName(key)}: ${fromJsonExpr(key, prop, required)},`);
   }
   lines.push(`      );`);
   lines.push('');

   // Fields
   for (const key of keys) {
      const prop = props[key] as Json;
      const required = requiredList.includes(key);
      const doc = prop['description'];
      if (typeof doc === 'string') lines.push(`  /// ${doc}`);
      lines.push(`  final ${dartType(prop, required)} ${fieldName(key)};`);
   }
   lines.push('');

   // toJson — omits absent optionals rather than sending nulls.
   if (unionParent !== undefined) lines.push(`  @override`);
   lines.push(`  Map<String, dynamic> toJson() => <String, dynamic>{`);
   for (const key of keys) {
      const prop = props[key] as Json;
      const required = requiredList.includes(key);
      const f = fieldName(key);
      const propId = prop['$id'];
      const isEnum = isStringUnion(prop) && typeof propId === 'string';
      const isNamedObject =
         prop['type'] === 'object' && typeof propId === 'string' && namedSchemas.has(propId);
      const bang = required ? '' : '!';
      const value = isEnum ? `${f}${bang}.wire` : isNamedObject ? `${f}${bang}.toJson()` : f;
      if (required) {
         lines.push(`        '${key}': ${value},`);
      } else {
         lines.push(`        if (${f} != null) '${key}': ${value},`);
      }
   }
   lines.push(`      };`);
   lines.push('}');
   return lines.join('\n');
}

/**
 * A `type`-discriminated union becomes a sealed class plus one subclass per
 * member, so Dart's exhaustive `switch` covers every stream event. Forget a
 * case after adding an event and the Dart compiler says so.
 */
function emitTaggedUnion(id: string, schema: Json): string {
   const name = className(id);
   const members = schema['anyOf'] as Json[];
   const lines: string[] = [];

   const description = schema['description'];
   if (typeof description === 'string') lines.push(`/// ${description}`);
   lines.push(`@immutable`);
   lines.push(`sealed class ${name} {`);
   lines.push(`  const ${name}();`);
   lines.push('');
   lines.push(`  factory ${name}.fromJson(Map<String, dynamic> json) {`);
   lines.push(`    final type = _reqStr(json, 'type');`);
   lines.push(`    switch (type) {`);
   for (const member of members) {
      const mid = schemaId(member, '');
      const tag = String(((member['properties'] as Json)['type'] as Json)['const']);
      lines.push(`      case '${tag}':`);
      lines.push(`        return ${className(mid)}.fromJson(json);`);
   }
   lines.push(`      default:`);
   lines.push(`        return _bad('type', 'a known ${name} variant', type);`);
   lines.push(`    }`);
   lines.push(`  }`);
   lines.push('');
   lines.push(`  Map<String, dynamic> toJson();`);
   lines.push('}');
   return lines.join('\n');
}

function generate(): string {
   const parts: string[] = [HEADER, `import 'package:meta/meta.dart';\n`, READERS];

   // Collect every id we will emit a class for, so nested occurrences of those
   // schemas can be typed as the class rather than a map.
   for (const raw of SCHEMAS) {
      const s = raw as unknown as Json;
      const id = schemaId(s, '');
      if (id !== '' && isObjectSchema(s)) namedSchemas.add(id);
   }

   // Members of a tagged union are emitted as subclasses of it, so collect the
   // mapping first.
   const unionOf = new Map<string, string>(); // member $id -> union class
   for (const raw of SCHEMAS) {
      const s = raw as unknown as Json;
      if (!isTaggedUnion(s) || isStringUnion(s)) continue;
      const unionName = className(schemaId(s, ''));
      for (const member of s['anyOf'] as Json[]) {
         const mid = schemaId(member, '');
         if (mid !== '') unionOf.set(mid, unionName);
      }
   }

   for (const raw of SCHEMAS) {
      const s = raw as unknown as Json;
      const id = schemaId(s, '');
      if (id === '') {
         throw new Error('Every schema in SCHEMAS needs a $id. Found one without.');
      }

      if (isStringUnion(s)) {
         parts.push(emitStringUnion(id, s));
         continue;
      }
      if (isTaggedUnion(s) && !isObjectSchema(s)) {
         parts.push(emitTaggedUnion(id, s));
         continue;
      }
      if (isObjectSchema(s)) {
         parts.push(emitClass(id, s, unionOf.get(id)));
         continue;
      }
      // A bare scalar alias (like Id) needs no Dart type; it is just a String.
      const kind = typeof s['type'] === 'string' ? s['type'] : 'unknown';
      parts.push(`// ${className(id)}: scalar alias (${kind}), no class emitted.`);
   }

   return `${parts.join('\n\n')}\n`;
}

function main(): void {
   const check = globalThis.process.argv.includes('--check');
   const next = generate();

   if (check) {
      if (!existsSync(OUT_FILE)) {
         globalThis.process.stderr.write(
            `codegen:check FAILED — ${OUT_FILE} does not exist.\nRun: bun run codegen\n`,
         );
         globalThis.process.exit(1);
      }
      const current = readFileSync(OUT_FILE, 'utf8').replace(/\r\n/g, '\n');
      if (current !== next) {
         globalThis.process.stderr.write(
            'codegen:check FAILED — generated Dart is out of date.\n' +
               'A contract changed without regenerating the Dart models (INVARIANT 10).\n' +
               'Run: bun run codegen\n',
         );
         globalThis.process.exit(1);
      }
      globalThis.process.stderr.write('codegen:check ok — Dart models match the contracts.\n');
      return;
   }

   mkdirSync(dirname(OUT_FILE), { recursive: true });
   writeFileSync(OUT_FILE, next, 'utf8');
   globalThis.process.stderr.write(`wrote ${OUT_FILE}\n`);
}

if (import.meta.main) {
   main();
}

export { generate };
