// GENERATED FILE — DO NOT EDIT.
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


import 'package:meta/meta.dart';


/// Thrown when wire data does not match the contract this file was generated
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
      "field '$field' should be $expected, but was ${got == null ? 'absent' : got.runtimeType}",
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
/// as `5.0`. A fractional value is still a contract break and is rejected.
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
  return _bad(f, 'one of ${allowed.join(', ')}', v);
}

String? _optOneOf(Map<String, dynamic> j, String f, List<String> allowed) {
  final v = _optStr(j, f);
  if (v == null || allowed.contains(v)) return v;
  return _bad(f, 'one of ${allowed.join(', ')} or absent', v);
}

List<T>? _optTypedList<T>(Map<String, dynamic> j, String f) {
  final raw = _optList(j, f);
  if (raw == null) return null;
  return List<T>.generate(raw.length, (i) => _item<T>(raw, i, f));
}


// Id: scalar alias (string), no class emitted.

/// Stable failure codes the UI may branch on.
enum ErrorCode {
  invalid('invalid'),
  unauthorized('unauthorized'),
  notFound('not_found'),
  forbidden('forbidden'),
  cancelled('cancelled'),
  upstream('upstream'),
  internal('internal'),
  ;

  const ErrorCode(this.wire);

  /// The exact string on the wire.
  final String wire;

  static ErrorCode fromWire(String value, [String field = 'errorCode']) =>
      tryFromWire(value) ??
      _bad(field, 'one of ${ErrorCode.values.map((e) => e.wire).join(', ')}', value);

  /// Null rather than an exception for an unrecognised value.
  static ErrorCode? tryFromWire(String value) {
    for (final e in ErrorCode.values) {
      if (e.wire == value) return e;
    }
    return null;
  }
}

@immutable
class ApiError {
  const ApiError({
    required this.code,
    required this.message,
    this.detail,
  });

  factory ApiError.fromJson(Map<String, dynamic> json) => ApiError(
        code: ErrorCode.fromWire(_reqStr(json, 'code'), 'code'),
        message: _reqStr(json, 'message'),
        detail: _optMap(json, 'detail'),
      );

  /// Stable failure codes the UI may branch on.
  final ErrorCode code;
  /// Safe to display. Never contains secrets.
  final String message;
  final Map<String, dynamic>? detail;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'code': code.wire,
        'message': message,
        if (detail != null) 'detail': detail,
      };
}

@immutable
class HealthResponse {
  const HealthResponse({
    required this.ok,
    required this.version,
    required this.uptime,
    required this.protocol,
  });

  factory HealthResponse.fromJson(Map<String, dynamic> json) => HealthResponse(
        ok: _reqBool(json, 'ok'),
        version: _reqStr(json, 'version'),
        uptime: _reqNum(json, 'uptime'),
        protocol: _reqInt(json, 'protocol'),
      );

  final bool ok;
  final String version;
  final double uptime;
  final int protocol;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'ok': ok,
        'version': version,
        'uptime': uptime,
        'protocol': protocol,
      };
}

@immutable
class EchoRequest {
  const EchoRequest({
    required this.message,
    this.delayMs,
    this.failAfter,
  });

  factory EchoRequest.fromJson(Map<String, dynamic> json) => EchoRequest(
        message: _reqStr(json, 'message'),
        delayMs: _optInt(json, 'delayMs'),
        failAfter: _optInt(json, 'failAfter'),
      );

  final String message;
  final int? delayMs;
  final int? failAfter;

  Map<String, dynamic> toJson() => <String, dynamic>{
        'message': message,
        if (delayMs != null) 'delayMs': delayMs,
        if (failAfter != null) 'failAfter': failAfter,
      };
}

@immutable
class StreamStart extends StreamEvent {
  const StreamStart({
    required this.type,
    required this.messageId,
  });

  factory StreamStart.fromJson(Map<String, dynamic> json) => StreamStart(
        type: _reqStr(json, 'type'),
        messageId: _reqStr(json, 'messageId'),
      );

  final String type;
  /// Sortable 26-character identifier (ULID layout, Crockford base32).
  final String messageId;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'messageId': messageId,
      };
}

@immutable
class StreamDelta extends StreamEvent {
  const StreamDelta({
    required this.type,
    required this.text,
  });

  factory StreamDelta.fromJson(Map<String, dynamic> json) => StreamDelta(
        type: _reqStr(json, 'type'),
        text: _reqStr(json, 'text'),
      );

  final String type;
  final String text;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'text': text,
      };
}

@immutable
class StreamDone extends StreamEvent {
  const StreamDone({
    required this.type,
    required this.reason,
    required this.chars,
  });

  factory StreamDone.fromJson(Map<String, dynamic> json) => StreamDone(
        type: _reqStr(json, 'type'),
        reason: _reqOneOf(json, 'reason', const <String>['complete', 'interrupted', 'length']),
        chars: _reqInt(json, 'chars'),
      );

  final String type;
  final String reason;
  final int chars;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'reason': reason,
        'chars': chars,
      };
}

@immutable
class StreamError extends StreamEvent {
  const StreamError({
    required this.type,
    required this.error,
  });

  factory StreamError.fromJson(Map<String, dynamic> json) => StreamError(
        type: _reqStr(json, 'type'),
        error: ApiError.fromJson(_reqMap(json, 'error')),
      );

  final String type;
  final ApiError error;

  @override
  Map<String, dynamic> toJson() => <String, dynamic>{
        'type': type,
        'error': error.toJson(),
      };
}

/// Discriminated on `type`. Exactly one terminal event per stream.
@immutable
sealed class StreamEvent {
  const StreamEvent();

  factory StreamEvent.fromJson(Map<String, dynamic> json) {
    final type = _reqStr(json, 'type');
    switch (type) {
      case 'start':
        return StreamStart.fromJson(json);
      case 'delta':
        return StreamDelta.fromJson(json);
      case 'done':
        return StreamDone.fromJson(json);
      case 'error':
        return StreamError.fromJson(json);
      default:
        return _bad('type', 'a known StreamEvent variant', type);
    }
  }

  Map<String, dynamic> toJson();
}
